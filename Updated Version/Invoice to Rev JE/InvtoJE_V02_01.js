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

            var rec = context.newRecord;
            var recordType = rec.type;
            var recordId = rec.id;

            log.debug('Record Type', recordType);
            log.debug('Record ID', recordId);

            var subsidiary = rec.getValue({ fieldId: 'subsidiary' });
            var totalAmount = rec.getValue({ fieldId: 'total' });

            var DR_ACCOUNT = null;
            var CR_ACCOUNT = null;
            var memoText = '';

            // Vendor Bill Logic
            if (recordType === record.Type.VENDOR_BILL) {

                DR_ACCOUNT = 820; // 2009
                CR_ACCOUNT = 830; // 1651

                memoText = 'Reversal JE for Vendor Bill ' + recordId;

                log.debug('Processing', 'Vendor Bill');

            }

            // Customer Invoice Logic
            else if (recordType === record.Type.INVOICE) {

                DR_ACCOUNT = 830; //1651
                CR_ACCOUNT = 833; //1751

                memoText = 'Reversal JE for Customer Invoice ' + recordId;

                log.debug('Processing', 'Customer Invoice');

            } 

            // Vendor Payment
            else if (recordType === record.Type.VENDOR_PAYMENT) {

                DR_ACCOUNT = 820; //2009
                CR_ACCOUNT = 1; //1000     
                
                memoText = 'Reversal JE for Vendor Payment ' + recordId;

                log.debug('Processing', 'Vendor Payment');
            }
            else {
                // Skip other record types
                return;
            }

            
            // Create Journal Entry
            
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
                value: memoText
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

            var jeId = jeRec.save();

            log.debug('Reversal JE Created', jeId);

        } catch (e) {
            log.error('Error', e);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});