/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Script Name  : ue_bill_to_invoice.js
 * Description  : When a Vendor Bill is created, this script groups bill lines
 *                based on the client tagged at line level (custcol_client) and checks
 *                if an invoice already exists for that client linked to this
 *                bill, and if not, creates a customer Invoice with all
 *                matching lines marked as Billable Expense.
 *
 * Deploy on    : Vendor Bill, Check, Expense Report (transaction)
 * Event        : After Submit — Create 
 * Version      : 2.0
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
            var recNumber = rec.getValue({ fieldId: 'tranid' });
            var recDate = rec.getValue({ fieldId: 'trandate' });
            var currency = rec.getValue({ fieldId: 'currency' });

            var lineCount = rec.getLineCount({ sublistId: 'expense' });

            var clientLineMap = {};
            log.debug('Line Count', lineCount);

            for (var i = 0; i < lineCount; i++) {

                var clientId = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'customer',
                    line: i
                });

                var isBillable = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'isbillable',
                    line: i
                });

                if (!clientId || !isBillable) continue;

                var amount = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    line: i
                });

                var memo = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'memo',
                    line: i
                });

                log.debug('Bill/Check line memo', memo);

                if (!clientLineMap[clientId]) {
                    clientLineMap[clientId] = [];
                }

                clientLineMap[clientId].push({
                    amount: Number(amount),
                    memo: normalize(memo)
                });
            }

            log.debug('Client Map', JSON.stringify(clientLineMap));

            for (var clientId in clientLineMap) {

                if (invoiceExists(clientId, recId)) {
                    continue;
                }

                createInvoice(
                    clientId,
                    clientLineMap[clientId],
                    recId,
                    recDate,
                    currency
                );
            }

        } catch (e) {
            log.error('ERROR', e.message);
        }
    }

    function invoiceExists(clientId, recId) {

        var result = search.create({
            type: search.Type.INVOICE,
            filters: [
                ['entity', 'anyof', clientId], 'AND',
                ['custbody_vendor_inv_no', 'anyof', recId], 'AND',
                ['mainline', 'is', 'T'], 'AND',
                ['voided', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    function createInvoice(clientId, lines, recId, recDate, currency) {

        var inv = record.create({
            type: record.Type.INVOICE,
            isDynamic: true
        });

        inv.setValue({ fieldId: 'entity', value: clientId });
        inv.setValue({ fieldId: 'trandate', value: recDate });
        inv.setValue({ fieldId: 'currency', value: currency });

        inv.setValue({
            fieldId: 'custbody_vendor_inv_no',
            value: recId
        });

        var expCount = inv.getLineCount({ sublistId: 'expcost' });
        log.debug('Expense Sublist Line Count', expCount);

        if (expCount === 0) return;

        var usedLines = {};

        for (var i = 0; i < expCount; i++) {

            inv.selectLine({ sublistId: 'expcost', line: i });

            inv.setCurrentSublistValue({
                sublistId: 'expcost',
                fieldId: 'apply',
                value: false
            });

            inv.commitLine({ sublistId: 'expcost' });
        }

        for (var i = 0; i < expCount; i++) {

            var invAmount = inv.getSublistValue({
                sublistId: 'expcost',
                fieldId: 'originalamount',
                line: i
            });

            var invMemo = inv.getSublistValue({
                sublistId: 'expcost',
                fieldId: 'memo',
                line: i
            });

            log.debug('INVOICE LINE',' Memo: ' + invMemo);

            invMemo = normalize(invMemo);

            var matched = false;

            for (var j = 0; j < lines.length; j++) {

                if (usedLines[j]) continue;

                if (
                    Number(lines[j].amount) === Number(invAmount) &&
                    lines[j].memo === invMemo
                ) {
                    matched = true;
                    usedLines[j] = true;
                    break;
                }
            }

            log.debug('MATCH',
                'InvAmt: ' + invAmount +
                ' | InvMemo: ' + invMemo +
                ' | Matched: ' + matched
            );

            if (matched) {
                inv.selectLine({ sublistId: 'expcost', line: i });

                inv.setCurrentSublistValue({
                    sublistId: 'expcost',
                    fieldId: 'apply',
                    value: true
                });

                inv.commitLine({ sublistId: 'expcost' });
            }
        }

        var finalId = inv.save({
            enableSourcing: true,
            ignoreMandatoryFields: false
        });

        log.audit('INVOICE CREATED', finalId);
    }

    function normalize(val) {
        return (val || '').toString().trim().toLowerCase();
    }

    return {
        afterSubmit: afterSubmit
    };
});