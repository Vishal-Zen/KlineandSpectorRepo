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
 * Version      : 3.0
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

            var recId = rec.id;
            var recDate = rec.getValue({ fieldId: 'trandate' });
            var currency = rec.getValue({ fieldId: 'currency' });

            // ── Determine which sublist holds expense lines ──────────────────
            // Vendor Bill & Check → 'expense'
            // Expense Report      → 'expense' sublist also exists but
            //                       fields are named differently
            var sublistId = 'expense';

            // For expense reports the customer/billable fields differ
            var customerField = (recType === 'expensereport') ? 'customer'   : 'customer';
            var billableField  = (recType === 'expensereport') ? 'isbillable' : 'isbillable';
            var amountField    = (recType === 'expensereport') ? 'amount'     : 'amount';
            var memoField      = (recType === 'expensereport') ? 'memo'       : 'memo';

            var lineCount = rec.getLineCount({ sublistId: sublistId });
            log.debug('Line Count', lineCount);

            // ── If expense sublist returned -1 try 'expline' (ER fallback) ──
            if (lineCount < 0) {
                sublistId = 'expline';
                lineCount = rec.getLineCount({ sublistId: sublistId });
                log.debug('Fallback sublistId / Line Count', sublistId + ' / ' + lineCount);
            }

            var clientLineMap = {};

            for (var i = 0; i < lineCount; i++) {

                var clientId = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: customerField,
                    line: i
                });

                var isBillable = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: billableField,
                    line: i
                });

                log.debug('Line ' + i, 'ClientId: ' + clientId + ' | isBillable: ' + isBillable);

                if (!clientId || !isBillable) continue;

                var amount = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: amountField,
                    line: i
                });

                var memo = rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: memoField,
                    line: i
                });

                log.debug('Line ' + i + ' memo / amount', memo + ' / ' + amount);

                if (!clientLineMap[clientId]) {
                    clientLineMap[clientId] = [];
                }

                clientLineMap[clientId].push({
                    amount: Number(amount),
                    memo: normalize(memo),
                    sourceType: recType,   // carry source type for matching hint
                    sourceId: recId
                });
            }

            log.debug('Client Map', JSON.stringify(clientLineMap));

            for (var clientId in clientLineMap) {
                if (invoiceExists(clientId, recId)) {
                    log.debug('Invoice already exists', 'ClientId: ' + clientId + ' RecId: ' + recId);
                    continue;
                }

                createInvoice(clientId, clientLineMap[clientId], recId, recDate, currency, recType);
            }

        } catch (e) {
            log.error('ERROR in afterSubmit', e.message + '\n' + e.stack);
        }
    }

    // ── Check if an invoice already exists for this client + source bill ────
    function invoiceExists(clientId, recId) {
        var result = search.create({
            type: search.Type.INVOICE,
            filters: [
                ['entity',              'anyof', clientId], 'AND',
                ['custbody_vendor_inv_no', 'anyof', recId], 'AND',
                ['mainline',            'is',    'T'],      'AND',
                ['voided',              'is',    'F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    // ── Create invoice and apply matching billable-expense lines ─────────────
    function createInvoice(clientId, lines, recId, recDate, currency, sourceType) {

        var inv = record.create({
            type: record.Type.INVOICE,
            isDynamic: true
        });

        inv.setValue({ fieldId: 'entity',   value: clientId });
        inv.setValue({ fieldId: 'trandate', value: recDate  });
        inv.setValue({ fieldId: 'currency', value: currency });
        inv.setValue({ fieldId: 'custbody_vendor_inv_no', value: recId });

        // ── expcost = billable expenses sublist on the invoice ───────────────
        var expCount = inv.getLineCount({ sublistId: 'expcost' });
        log.debug('expcost line count for client ' + clientId, expCount);

        if (expCount <= 0) {
            // ----------------------------------------------------------------
            // expcost is empty — this is the core issue for expense reports.
            //
            // NetSuite only auto-populates expcost when there are OPEN
            // billable expense lines already approved and linked to this
            // customer.  For expense reports the approval status matters:
            //   • Draft / Pending Approval  → lines not yet available
            //   • Approved for Posting      → lines should appear
            //
            // Log a warning and bail — invoice cannot be built yet.
            // ----------------------------------------------------------------
            log.audit(
                'SKIPPED — no expcost lines',
                'ClientId: ' + clientId +
                ' | Source: ' + sourceType +
                ' | RecId: ' + recId +
                ' | Possible cause: expense report not yet approved, ' +
                'or billable flag not set on the ER lines.'
            );
            return;
        }

        // Deselect all lines first
        for (var i = 0; i < expCount; i++) {
            inv.selectLine({ sublistId: 'expcost', line: i });
            inv.setCurrentSublistValue({ sublistId: 'expcost', fieldId: 'apply', value: false });
            inv.commitLine({ sublistId: 'expcost' });
        }

        var usedLines = {};

        // Match & apply lines
        for (var i = 0; i < expCount; i++) {

            var invAmount = inv.getSublistValue({
                sublistId: 'expcost',
                fieldId: 'originalamount',
                line: i
            });

            var invMemo = normalize(inv.getSublistValue({
                sublistId: 'expcost',
                fieldId: 'memo',
                line: i
            }));

            // ── Also read the source transaction type on expcost ─────────────
            // 'type' field on expcost tells us if the line came from an
            // expensereport vs vendorbill — use this to narrow matching.
            var expcostType = inv.getSublistValue({
                sublistId: 'expcost',
                fieldId: 'type',
                line: i
            });

            log.debug('expcost line ' + i,
                'Amt: ' + invAmount +
                ' | Memo: ' + invMemo +
                ' | Type: ' + expcostType
            );

            var matched = false;

            for (var j = 0; j < lines.length; j++) {
                if (usedLines[j]) continue;

                var amountMatch = Number(lines[j].amount) === Number(invAmount);
                var memoMatch   = lines[j].memo === invMemo;

                // ── For expense reports, memo matching is unreliable because
                //    NetSuite may prefix the memo with the employee name or
                //    expense category.  Fall back to amount-only match when
                //    sourceType is expensereport and memo is blank on expcost.
                var looseMatch  = sourceType === 'expensereport' &&
                                  invMemo === '' &&
                                  amountMatch;

                if (amountMatch && memoMatch || looseMatch) {
                    matched    = true;
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