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
 * Deploy on    : Vendor Bill (transaction)
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

            var billRec = context.newRecord;
            var billId = billRec.id;
            var billNumber = billRec.getValue({ fieldId: 'tranid' });
            var billDate = billRec.getValue({ fieldId: 'trandate' });

            var lineCount = billRec.getLineCount({ sublistId: 'expense' });

            log.audit('START', 'Bill: ' + billNumber + ' | Lines: ' + lineCount);

            var clientMap = {};

            for (var i = 0; i < lineCount; i++) {

                var clientId = billRec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'customer',
                    line: i
                });

                var isBillable = billRec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'isbillable',
                    line: i
                });

                if (!clientId || !isBillable) continue;

                var amount = billRec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    line: i
                });

                var account = billRec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account',
                    line: i
                });

                if (!clientMap[clientId]) {
                    clientMap[clientId] = [];
                }

                clientMap[clientId].push({
                    amount: amount,
                    account: account
                });
            }

            log.debug('GROUPED DATA', JSON.stringify(clientMap));

            for (var clientId in clientMap) {

                if (invoiceExists(clientId, billId)) {
                    log.audit('SKIP', 'Already exists for client: ' + clientId);
                    continue;
                }

                var inv = record.create({
                    type: record.Type.INVOICE,
                    isDynamic: true
                });

                inv.setValue({ fieldId: 'entity', value: clientId });
                inv.setValue({ fieldId: 'trandate', value: billDate });
                inv.setValue({ fieldId: 'custbody_vendor_inv_no', value: billId });

                var lines = clientMap[clientId];


                for (var j = 0; j < lines.length; j++) {

                    inv.selectNewLine({ sublistId: 'item' });

                    inv.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        value: 1 // ⚠️ Replace with valid service item ID
                    });

                    inv.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'amount',
                        value: lines[j].amount
                    });

                    inv.commitLine({ sublistId: 'item' });

                    log.debug('LINE ADDED',
                        'Client: ' + clientId +
                        ' | Amount: ' + lines[j].amount
                    );
                }

                var invoiceId = inv.save();

                log.audit('INVOICE CREATED',
                    'Client: ' + clientId +
                    ' | Invoice ID: ' + invoiceId
                );
            }

        } catch (e) {
            log.error('ERROR', e.message);
        }
    }

    function invoiceExists(clientId, billId) {

        var result = search.create({
            type: search.Type.INVOICE,
            filters: [
                ['entity', 'anyof', clientId], 'AND',
                ['custbody_vendor_inv_no', 'anyof', billId], 'AND',
                ['mainline', 'is', 'T']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    return { afterSubmit: afterSubmit };
});