/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    function afterSubmit(context) {

        try {

            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
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

            var headerAccount = rec.getValue({ fieldId: 'account' });
            var headerAccountText = rec.getText({ fieldId: 'account' });

            var lineCount = recordType === record.Type.INVOICE
                ? rec.getLineCount({ sublistId: 'expcost' })
                : rec.getLineCount({ sublistId: 'expense' });
                log.debug('Line Count', lineCount);

            var sublistId = recordType === record.Type.INVOICE ? 'item' : 'expense';

            var hasValidLineAccount = false;

            log.debug('Document Number', rec.getValue({ fieldId: 'tranid' }));
            log.debug('Header Account ID', headerAccount);
            log.debug('Header Account Name', headerAccountText);

            // Invoice Logic
            if (recordType === record.Type.INVOICE) {

                if (parseInt(headerAccount) !== 832) {
                    log.debug('Skipped', 'Invoice Header Account not matched');
                    return;
                }
                log.debug('Invoice If', 'Header Account matched, checking line accounts');

                for (var i = 0; i < lineCount; i++) {
                    log.debug(' Invoice Line ' + i + ' Account', 'Inside the loop for invoice lines');
                    var lineAccount = rec.getSublistValue({
                        sublistId: sublistId,
                        fieldId: 'account',
                        line: i
                    });

                    var lineAccountText = rec.getSublistText({
                        sublistId: sublistId,
                        fieldId: 'account',
                        line: i
                    });

                    log.debug('Invoice Line Account ID Line ' + i, lineAccount);
                    log.debug('Invoice Line Account Name Line ' + i, lineAccountText);

                    if (parseInt(lineAccount) === 644) {
                        hasValidLineAccount = true;
                        break;
                    }
                }

                if (!hasValidLineAccount) {
                    log.debug('Skipped', 'Invoice Line Account not matched');
                    return;
                }

                DR_ACCOUNT = 830;
                CR_ACCOUNT = 833;

                memoText = 'Reversal JE for Customer Invoice ' + recordId;

                log.debug('Processing', 'Customer Invoice');
            }

            // Vendor Bill Logic
            else if (recordType === record.Type.VENDOR_BILL) {

                if (parseInt(headerAccount) !== 820) {
                    log.debug('Skipped', 'Vendor Bill Header Account not matched');
                    return;
                }

                log.debug('Vendor Bill If', 'Header Account matched, checking line accounts');

                for (var j = 0; j < lineCount; j++) {

                    log.debug('Vendor Bill Line Count inside the loop', lineCount);

                    var vbLineAccount = rec.getSublistValue({
                        sublistId: sublistId,
                        fieldId: 'account',
                        line: j
                    });

                    var vbLineAccountText = rec.getSublistText({
                        sublistId: sublistId,
                        fieldId: 'account',
                        line: j
                    });

                    log.debug('Vendor Bill Line Account ID Line ' + j, vbLineAccount);
                    log.debug('Vendor Bill Line Account Name Line ' + j, vbLineAccountText);

                    if (parseInt(vbLineAccount) === 644) {
                        hasValidLineAccount = true;
                        break;
                    }
                }

                if (!hasValidLineAccount) {
                    log.debug('Skipped', 'Vendor Bill Line Account not matched');
                    return;
                }

                DR_ACCOUNT = 820;
                CR_ACCOUNT = 830;

                memoText = 'Reversal JE for Vendor Bill ' + recordId;

                log.debug('Processing', 'Vendor Bill');
            }

            // Vendor Payment
            else if (recordType === record.Type.VENDOR_PAYMENT) {

                DR_ACCOUNT = 820;
                CR_ACCOUNT = 1;

                memoText = 'Reversal JE for Vendor Payment ' + recordId;

                log.debug('Processing', 'Vendor Payment');
            }

            else {
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

            // Debit Line

            jeRec.selectNewLine({
                sublistId: 'line'
            });

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

            jeRec.commitLine({
                sublistId: 'line'
            });

            // Credit Line

            jeRec.selectNewLine({
                sublistId: 'line'
            });

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

            jeRec.commitLine({
                sublistId: 'line'
            });

            var jeId = jeRec.save();

            log.debug('Reversal JE Created', jeId);

        } catch (e) {

            log.error('Error Name', e.name);
            log.error('Error Message', e.message);
            log.error('Error Stack', e.stack);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});