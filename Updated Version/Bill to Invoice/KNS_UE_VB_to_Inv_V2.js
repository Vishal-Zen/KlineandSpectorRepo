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
define(['N/record','N/search','N/log'], function(record, search, log) {

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) {
                log.debug('SKIP', 'Not CREATE/EDIT event');
                return;
            }

            var billRec = context.newRecord;
            var billId = billRec.id;
            var billDate = billRec.getValue({ fieldId: 'trandate' });
            var currency = billRec.getValue({ fieldId: 'currency' });
            var lineCount = billRec.getLineCount({ sublistId: 'expense' });

            log.audit('START', 'Processing Bill: ' + billId + ' | Lines: ' + lineCount);

            var clientLineMap = {};

            for (var i = 0; i < lineCount; i++) {
                var clientId = billRec.getSublistValue({ sublistId: 'expense', fieldId: 'customer', line: i });
                var isBillable = billRec.getSublistValue({ sublistId: 'expense', fieldId: 'isbillable', line: i });
                var taxRef = billRec.getSublistValue({ sublistId: 'expense', fieldId: 'taxdetailsreference', line: i });

                if (!clientId || !isBillable) {
                    log.debug('SKIP LINE', 'Line ' + i + ' skipped (No client / not billable)');
                    continue;
                }

                var lineData = {
                    account: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'account', line: i }),
                    amount: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'amount', line: i }),
                    memo: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'memo', line: i }),
                    department: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'department', line: i }),
                    class: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'class', line: i }),
                    location: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'location', line: i }),
                    taxreference: taxRef
                };

                if (!clientLineMap[clientId]) {
                    clientLineMap[clientId] = [];
                }

                clientLineMap[clientId].push(lineData);
            }

            log.debug('GROUPED DATA', JSON.stringify(clientLineMap));

            for (var clientId in clientLineMap) {
                var lines = clientLineMap[clientId];

                try {
                    if (invoiceExists(clientId, billId)) {
                        log.audit('DUPLICATE', 'Invoice already exists for Client: ' + clientId);
                        continue;
                    }

                    var invoiceId = createInvoice(clientId, lines, billId, billDate, currency);

                    if (invoiceId) {
                        log.audit('SUCCESS', 'Invoice Created: ' + invoiceId + ' for Client: ' + clientId);
                    }

                } catch (e) {
                    log.error('CLIENT ERROR', 'Client: ' + clientId + ' | ' + e.message);
                }
            }

        } catch (e) {
            log.error('FATAL ERROR', e.message);
        }
    }

    function invoiceExists(clientId, billId) {
        var result = search.create({
            type: search.Type.INVOICE,
            filters: [
                ['entity','anyof',clientId],'AND',
                ['custbody_vendor_inv_no','anyof',billId],'AND',
                ['mainline','is','T'],'AND',
                ['voided','is','F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    function createInvoice(clientId, lines, billId, billDate, currency) {

        var inv = record.create({ type: record.Type.INVOICE, isDynamic: true });

        inv.setValue({ fieldId: 'entity', value: clientId });
        inv.setValue({ fieldId: 'trandate', value: billDate });
        inv.setValue({ fieldId: 'currency', value: currency });
        inv.setValue({ fieldId: 'custbody_vendor_inv_no', value: billId });
        inv.setValue({ fieldId: 'memo', value: 'Auto from Bill #' + billId });

        var invoiceId = inv.save({ enableSourcing: true, ignoreMandatoryFields: true });

        log.debug('DRAFT CREATED', invoiceId);

        var loadedInv = record.load({ type: record.Type.INVOICE, id: invoiceId, isDynamic: true });
        var expCount = loadedInv.getLineCount({ sublistId: 'expcost' });

        if (expCount === 0) {
            log.audit('NO LINES', 'Deleting invoice ' + invoiceId);
            record.delete({ type: record.Type.INVOICE, id: invoiceId });
            return null;
        }

        for (var i = 0; i < expCount; i++) {
            loadedInv.selectLine({ sublistId: 'expcost', line: i });

            var invTaxRef = loadedInv.getCurrentSublistValue({ sublistId: 'expcost', fieldId: 'taxdetailsreference' });

            if (invTaxRef) {
                invTaxRef = invTaxRef.replace('expcost_', '');
            }

            var matched = false;
            for (var j = 0; j < lines.length; j++) {
                if (lines[j].taxreference === invTaxRef) {
                    matched = true;
                    break;
                }
            }

            log.debug('MATCH CHECK', 'Line ' + i + ' | Match: ' + matched);

            loadedInv.setCurrentSublistValue({
                sublistId: 'expcost',
                fieldId: 'apply',
                value: matched
            });

            loadedInv.commitLine({ sublistId: 'expcost' });
        }

        var finalId = loadedInv.save({ enableSourcing: true, ignoreMandatoryFields: false });

        return finalId;
    }

    return { afterSubmit: afterSubmit };
});