/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Script Name  : ue_bill_to_invoice.js
 * Description  : When a Vendor Bill/Check/Expense Report is created/edited,
 *                groups billable lines by client and creates a Customer Invoice.
 *
 *                Vendor Bill / Check / Expense Report → invoice via expcost sublist
 *
 * Deploy on    : Vendor Bill, Check, Expense Report
 * Event        : After Submit — Create / Edit
 * Version      : 6.0
 */

define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            var rec     = context.newRecord;
            var recType = rec.type;
            log.debug('Record Type', recType);

            if (recType !== 'vendorbill' &&
                recType !== 'check' &&
                recType !== 'expensereport') {
                return;
            }

            var recId    = rec.id;
            var recDate  = rec.getValue({ fieldId: 'trandate' });
            var currency = rec.getValue({ fieldId: 'currency' });

            var sourceRec = rec;
            if (recType === 'expensereport') {
                sourceRec = record.load({
                    type: record.Type.EXPENSE_REPORT,
                    id: recId,
                    isDynamic: false
                });
                log.debug('Reloaded Expense Report', recId);
            }

            // Read expense lines 
            var sublistId = 'expense';
            var lineCount = sourceRec.getLineCount({ sublistId: sublistId });

            if (lineCount < 0) {
                sublistId = 'expline';
                lineCount = sourceRec.getLineCount({ sublistId: sublistId });
            }

            log.debug('Sublist / Line Count', sublistId + ' / ' + lineCount);

            var clientLineMap = {};

            for (var i = 0; i < lineCount; i++) {

                var clientId = sourceRec.getSublistValue({
                    sublistId: sublistId,
                    fieldId:   'customer',
                    line:      i
                });

                var isBillable = sourceRec.getSublistValue({
                    sublistId: sublistId,
                    fieldId:   'isbillable',
                    line:      i
                });

                log.debug('Line ' + i,
                    'ClientId: ' + clientId + ' | isBillable: ' + isBillable);

                if (!clientId || !isBillable) continue;

                var amount = Number(sourceRec.getSublistValue({
                    sublistId: sublistId,
                    fieldId:   'amount',
                    line:      i
                }));

                var memo = sourceRec.getSublistValue({
                    sublistId: sublistId,
                    fieldId:   'memo',
                    line:      i
                });

                log.debug('Line ' + i + ' detail',
                    'Memo: ' + memo + ' | Amount: ' + amount);

                if (!clientLineMap[clientId]) {
                    clientLineMap[clientId] = [];
                }

                clientLineMap[clientId].push({
                    amount:     amount,
                    memo:       normalize(memo),
                    sourceType: recType,
                    sourceId:   recId
                });
            }

            log.debug('Client Map', JSON.stringify(clientLineMap));

            for (var clientId in clientLineMap) {

                if (invoiceExists(clientId, recId)) {
                    log.debug('Invoice already exists',
                        'ClientId: ' + clientId + ' | RecId: ' + recId);
                    continue;
                }

                createInvoice(
                    clientId,
                    clientLineMap[clientId],
                    recId,
                    recDate,
                    currency,
                    recType
                );
            }

        } catch (e) {
            log.error('ERROR in afterSubmit', e.message + '\n' + e.stack);
        }
    }

    function invoiceExists(clientId, recId) {
        var result = search.create({
            type: search.Type.INVOICE,
            filters: [
                ['entity',                'anyof', clientId], 'AND',
                ['custbody_vendor_inv_no', 'anyof', recId],   'AND',
                ['mainline',              'is',    'T'],      'AND',
                ['voided',                'is',    'F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    // All record types -> match via expcost sublist
    function createInvoice(clientId, lines, recId, recDate, currency, sourceType) {

        var inv = record.create({
            type:      record.Type.INVOICE,
            isDynamic: true
        });

        inv.setValue({ fieldId: 'entity',                 value: clientId });
        inv.setValue({ fieldId: 'trandate',               value: recDate  });
        inv.setValue({ fieldId: 'currency',               value: currency });
        inv.setValue({ fieldId: 'custbody_vendor_inv_no', value: recId    });

        var expCount = inv.getLineCount({ sublistId: 'expcost' });
        log.debug('expcost line count for client ' + clientId, expCount);

        if (expCount <= 0) {
            log.audit('SKIPPED — no expcost lines',
                'ClientId: ' + clientId +
                ' | Source: ' + sourceType +
                ' | RecId: '  + recId +
                ' | If Expense Report: confirm status is Approved For Posting'
            );
            return;
        }

        // Deselect all lines first 
        for (var i = 0; i < expCount; i++) {
            inv.selectLine({ sublistId: 'expcost', line: i });
            inv.setCurrentSublistValue({
                sublistId: 'expcost',
                fieldId:   'apply',
                value:     false
            });
            inv.commitLine({ sublistId: 'expcost' });
        }

        var usedLines = {};

        // Match and apply
        for (var i = 0; i < expCount; i++) {

            var invAmount    = Number(inv.getSublistValue({
                sublistId: 'expcost',
                fieldId:   'originalamount',
                line:      i
            }));

            var invMemo      = normalize(inv.getSublistValue({
                sublistId: 'expcost',
                fieldId:   'memo',
                line:      i
            }));

            var expcostSrcId = inv.getSublistValue({
                sublistId: 'expcost',
                fieldId:   'doc',
                line:      i
            });

            log.debug('expcost line ' + i,
                'Amt: '       + invAmount +
                ' | Memo: '   + invMemo +
                ' | doc: '    + expcostSrcId
            );

            var matched = false;

            for (var j = 0; j < lines.length; j++) {
                if (usedLines[j]) continue;

                var sourceIdMatch   = String(expcostSrcId) === String(lines[j].sourceId);
                var amountMatch     = Number(lines[j].amount) === invAmount;
                var memoMatch       = lines[j].memo === invMemo;

                var looseMatch = sourceType === 'expensereport' &&
                                 invMemo === '' &&
                                 sourceIdMatch &&
                                 amountMatch;

                if ((sourceIdMatch && amountMatch) ||
                    (amountMatch && memoMatch)     ||
                    looseMatch) {
                    matched      = true;
                    usedLines[j] = true;
                    break;
                }
            }

            log.debug('MATCH result line ' + i,
                'InvAmt: '  + invAmount +
                ' | Memo: ' + invMemo +
                ' | Matched: ' + matched
            );

            if (matched) {
                inv.selectLine({ sublistId: 'expcost', line: i });
                inv.setCurrentSublistValue({
                    sublistId: 'expcost',
                    fieldId:   'apply',
                    value:     true
                });
                inv.commitLine({ sublistId: 'expcost' });
            }
        }

        var finalId = inv.save({
            enableSourcing:        true,
            ignoreMandatoryFields: false
        });

        log.audit('INVOICE CREATED',
            'InvoiceId: ' + finalId + ' | ClientId: ' + clientId + ' | Source: ' + sourceType);
    }

    function normalize(val) {
        return (val || '').toString().trim().toLowerCase();
    }

    return {
        afterSubmit: afterSubmit
    };
});