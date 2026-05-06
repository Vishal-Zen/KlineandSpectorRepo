/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    function afterSubmit(context) {

        try {

            if (context.type !== context.UserEventType.CREATE) {
                return;
            }

            var vbRec = context.newRecord;
            var vendorBillId = vbRec.id;
            log.debug('Vendor Bill Created', 'ID: ' + vendorBillId);
            log.debug('Vendor Document Number', vbRec.getValue({ fieldId: 'tranid' }));
            
            var subsidiary = vbRec.getValue({ fieldId: 'subsidiary' });
            var totalAmount = vbRec.getValue({ fieldId: 'total' });

            var DR_ACCOUNT = 820; //2009 Invoices Payable 
            var CR_ACCOUNT = 830; //1651 Unbilled Soft Cost Contra

            var jeRec = record.create({
                type: record.Type.JOURNAL_ENTRY,
                isDynamic: true
            });

            jeRec.setValue({
                fieldId: 'subsidiary',
                value: subsidiary
            });

            jeRec.setValue({
                fieldId: 'memo',
                value: 'Reversal JE for Vendor Bill ' + vendorBillId
            });

            // Line 1 -> Debit
            jeRec.selectNewLine({ sublistId: 'line' });

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'account',
                value: DR_ACCOUNT
            });

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'debit',
                value: totalAmount
            });

            jeRec.commitLine({ sublistId: 'line' });

            // Line 2 -> Credit
            jeRec.selectNewLine({ sublistId: 'line' });

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'account',
                value: CR_ACCOUNT
            });

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'credit',
                value: totalAmount
            });

            jeRec.commitLine({ sublistId: 'line' });

            // Save JE
            var jeId = jeRec.save();

            log.debug('Reversal JE Created', jeId);

        } catch (e) {
            log.error('Error creating Reversal JE', e);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});