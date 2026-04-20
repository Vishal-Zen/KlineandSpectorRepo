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

            log.audit('SCRIPT START', 'Type: ' + context.type);

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            var rec = context.newRecord;
            var recType = rec.type;

            log.audit('Record Type', recType);

            if (recType !== 'vendorbill' && recType !== 'check' && recType !== 'expensereport') {
                return;
            }

            var recId = rec.id;
            var recNumber = rec.getValue({ fieldId: 'tranid' });
            var recDate = rec.getValue({ fieldId: 'trandate' });
            var currency = rec.getValue({ fieldId: 'currency' });

            log.debug('Header Info',
                'ID: ' + recId +
                ' | Tran#: ' + recNumber +
                ' | Date: ' + recDate +
                ' | Currency: ' + currency
            );

            var lineCount = rec.getLineCount({ sublistId: 'expense' });

            log.debug('Expense Line Count', lineCount);

            var clientLineMap = {};

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

                var amount = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    line: i
                });

                var memoRaw = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'memo',
                    line: i
                });

                var memo = normalize(memoRaw);

                log.debug('LINE READ',
                    'Line: ' + i +
                    ' | Client: ' + clientId +
                    ' | Billable: ' + isBillable +
                    ' | Amount: ' + amount +
                    ' | Raw Memo: ' + memoRaw +
                    ' | Normalized Memo: ' + memo
                );

                if (!clientId || !isBillable) continue;

                if (!clientLineMap[clientId]) {
                    clientLineMap[clientId] = [];
                }

                clientLineMap[clientId].push({
                    amount: Number(amount),
                    memo: memo
                });
            }

            log.debug('Client Map', JSON.stringify(clientLineMap));

            for (var clientId in clientLineMap) {

                log.audit('PROCESS CLIENT', clientId);

                if (invoiceExists(clientId, recId)) {
                    log.audit('SKIP', 'Invoice already exists for client: ' + clientId);
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
                ['mainline', 'is', 'T'],
                'AND',
                ['voided', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        log.debug('Invoice Exists Check',
            'Client: ' + clientId +
            ' | RecId: ' + recId +
            ' | Found: ' + (result && result.length)
        );

        return result && result.length > 0;
    }

    function createInvoice(clientId, lines, recId, recDate, currency) {

        log.audit('CREATE INVOICE START', 'Client: ' + clientId);

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

        log.debug('Invoice Expense Count', expCount);

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

            var invMemoRaw = inv.getSublistValue({
                sublistId: 'expcost',
                fieldId: 'memo',
                line: i
            });

            var invMemo = normalize(invMemoRaw);

            log.debug('INVOICE LINE',
                'Line: ' + i +
                ' | Amount: ' + invAmount +
                ' | Raw Memo: ' + invMemoRaw +
                ' | Normalized Memo: ' + invMemo
            );

            var matched = false;

            for (var j = 0; j < lines.length; j++) {

                if (usedLines[j]) continue;

                log.debug('COMPARE',
                    'Invoice Memo: ' + invMemo +
                    ' | Expense Memo: ' + lines[j].memo +
                    ' | Amount Compare: ' + invAmount + ' vs ' + lines[j].amount
                );

                if (
                    Number(lines[j].amount) === Number(invAmount) &&
                    invMemo.includes(lines[j].memo)
                ) {
                    matched = true;
                    usedLines[j] = true;
                    break;
                }
            }

            log.audit('MATCH RESULT',
                'Line: ' + i +
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

    function normalize(val, recType) {
        if (!val) return '';

        var text = val.toString().trim().toLowerCase();

        // ONLY for Expense Report fix NetSuite prefix issue
        if (recType === 'expensereport') {
            text = text.replace(/^:\s*/, ''); // remove only ": " from start
        }

        return text;
    }

    return {
        afterSubmit: afterSubmit
    };
});