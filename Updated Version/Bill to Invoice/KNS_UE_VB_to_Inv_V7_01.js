/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Script Name  : ue_bill_to_invoice.js
 * Description  : When a Vendor Bill/Check/Expense Report is created/edited,
 *                groups billable lines by client and creates a Customer Invoice.
 *
 * Deploy on    : Vendor Bill, Check, Expense Report (transaction)
 * Event        : After Submit — Create / Edit
 * Version      : 4.0
 */

define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            var rec = context.newRecord;
            var recType = rec.type;
            log.debug('Record Type', recType);

            if (recType !== 'vendorbill' && recType !== 'check' && recType !== 'expensereport') {
                return;
            }

            var recId     = rec.id;
            var recDate   = rec.getValue({ fieldId: 'trandate' });
            var currency  = rec.getValue({ fieldId: 'currency' });

            // ── Expense Report stores lines under 'expense' sublist ──────────
            // but the sublist fields differ slightly. Try 'expense' first,
            // fall back to 'expline' if getLineCount returns -1.
            var sublistId = 'expense';
            var lineCount = rec.getLineCount({ sublistId: sublistId });

            if (lineCount < 0) {
                sublistId = 'expline';
                lineCount = rec.getLineCount({ sublistId: sublistId });
            }

            log.debug('Sublist / Line Count', sublistId + ' / ' + lineCount);

            var clientLineMap = {};

            for (var i = 0; i < lineCount; i++) {

                var clientId = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: 'customer',
                    line: i
                });

                var isBillable = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: 'isbillable',
                    line: i
                });

                log.debug('Line ' + i, 'ClientId: ' + clientId + ' | isBillable: ' + isBillable);

                if (!clientId || !isBillable) continue;

                var amount = Number(rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: 'amount',
                    line: i
                }));

                var memo = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: 'memo',
                    line: i
                });

                // ── For expense report lines, capture the line unique ID ─────
                // This is the internal ID of the expense line itself, which
                // appears as 'id' on the expcost sublist — used for precise matching.
                var lineId = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: 'id',
                    line: i
                });

                // expenseaccount is used as a secondary matching field
                var expAccount = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: 'expenseaccount',
                    line: i
                });

                log.debug('Line ' + i + ' detail',
                    'Memo: ' + memo + ' | Amount: ' + amount +
                    ' | LineId: ' + lineId + ' | ExpAcct: ' + expAccount
                );

                if (!clientLineMap[clientId]) {
                    clientLineMap[clientId] = [];
                }

                clientLineMap[clientId].push({
                    amount: amount,
                    memo: normalize(memo),
                    lineId: lineId,
                    expAccount: expAccount,
                    sourceType: recType,
                    sourceId: recId
                });
            }

            log.debug('Client Map', JSON.stringify(clientLineMap));

            for (var clientId in clientLineMap) {
                if (invoiceExists(clientId, recId)) {
                    log.debug('Invoice already exists', 'ClientId: ' + clientId + ' | RecId: ' + recId);
                    continue;
                }
                createInvoice(clientId, clientLineMap[clientId], recId, recDate, currency, recType);
            }

        } catch (e) {
            log.error('ERROR in afterSubmit', e.message + '\n' + e.stack);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    function invoiceExists(clientId, recId) {
        var result = search.create({
            type: search.Type.INVOICE,
            filters: [
                ['entity',               'anyof', clientId], 'AND',
                ['custbody_vendor_inv_no','anyof', recId],   'AND',
                ['mainline',             'is',    'T'],      'AND',
                ['voided',               'is',    'F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    // ────────────────────────────────────────────────────────────────────────
    function createInvoice(clientId, lines, recId, recDate, currency, sourceType) {

        var inv = record.create({
            type: record.Type.INVOICE,
            isDynamic: true
        });

        inv.setValue({ fieldId: 'entity',                value: clientId });
        inv.setValue({ fieldId: 'trandate',              value: recDate  });
        inv.setValue({ fieldId: 'currency',              value: currency });
        inv.setValue({ fieldId: 'custbody_vendor_inv_no', value: recId   });

        var expCount = inv.getLineCount({ sublistId: 'expcost' });
        log.debug('expcost line count for client ' + clientId, expCount);

        if (expCount <= 0) {
            log.audit('SKIPPED — no expcost lines',
                'ClientId: ' + clientId + ' | Source: ' + sourceType + ' | RecId: ' + recId
            );
            return;
        }

        // ── Log ALL expcost fields on first line to discover field names ─────
        // (only on first run — remove after confirming field names)
        try {
            var firstLineFields = inv.getSublistFields({ sublistId: 'expcost' });
            log.debug('expcost available fields', JSON.stringify(firstLineFields));
        } catch(ex) {
            log.debug('expcost field list error', ex.message);
        }

        // ── Deselect all lines ───────────────────────────────────────────────
        for (var i = 0; i < expCount; i++) {
            inv.selectLine({ sublistId: 'expcost', line: i });
            inv.setCurrentSublistValue({ sublistId: 'expcost', fieldId: 'apply', value: false });
            inv.commitLine({ sublistId: 'expcost' });
        }

        var usedLines = {};

        // ── Match and apply ──────────────────────────────────────────────────
        for (var i = 0; i < expCount; i++) {

            var invAmount  = Number(inv.getSublistValue({ sublistId: 'expcost', fieldId: 'originalamount', line: i }));
            var invMemo    = normalize(inv.getSublistValue({ sublistId: 'expcost', fieldId: 'memo',           line: i }));

            // 'id' on expcost = the internal ID of the originating expense line
            var expcostLineId = inv.getSublistValue({ sublistId: 'expcost', fieldId: 'id',            line: i });
            var expcostAcct   = inv.getSublistValue({ sublistId: 'expcost', fieldId: 'expenseaccount', line: i });

            // 'doc' field holds the source transaction internal ID
            var expcostSourceId = inv.getSublistValue({ sublistId: 'expcost', fieldId: 'doc', line: i });

            log.debug('expcost line ' + i,
                'Amt: ' + invAmount +
                ' | Memo: ' + invMemo +
                ' | LineId: ' + expcostLineId +
                ' | SourceId(doc): ' + expcostSourceId +
                ' | Acct: ' + expcostAcct
            );

            var matched = false;

            for (var j = 0; j < lines.length; j++) {
                if (usedLines[j]) continue;

                // ── Primary match: source transaction ID + amount ────────────
                // This is the most reliable — the 'doc' field on expcost
                // should equal the recId of the bill/check/expense report.
                var sourceIdMatch = String(expcostSourceId) === String(lines[j].sourceId);
                var amountMatch   = Number(lines[j].amount) === invAmount;
                var memoMatch     = lines[j].memo === invMemo;

                // ── Line ID match (most precise for expense reports) ─────────
                var lineIdMatch   = lines[j].lineId &&
                                    String(lines[j].lineId) === String(expcostLineId);

                // ── Fallback: amount + memo (original behavior) ──────────────
                var amountMemoMatch = amountMatch && memoMatch;

                // ── Loose match for expense reports with blank memo ──────────
                var looseMatch = sourceType === 'expensereport' &&
                                 invMemo === '' && amountMatch && sourceIdMatch;

                if (lineIdMatch || (sourceIdMatch && amountMatch) || amountMemoMatch || looseMatch) {
                    matched      = true;
                    usedLines[j] = true;
                    break;
                }
            }

            log.debug('MATCH result line ' + i,
                'InvAmt: ' + invAmount +
                ' | InvMemo: ' + invMemo +
                ' | Matched: ' + matched
            );

            if (matched) {
                inv.selectLine({ sublistId: 'expcost', line: i });
                inv.setCurrentSublistValue({ sublistId: 'expcost', fieldId: 'apply', value: true });
                inv.commitLine({ sublistId: 'expcost' });
            }
        }

        var finalId = inv.save({
            enableSourcing: true,
            ignoreMandatoryFields: false
        });

        log.audit('INVOICE CREATED', 'InvoiceId: ' + finalId + ' | ClientId: ' + clientId);
    }

    function normalize(val) {
        return (val || '').toString().trim().toLowerCase();
    }

    return {
        afterSubmit: afterSubmit
    };
});