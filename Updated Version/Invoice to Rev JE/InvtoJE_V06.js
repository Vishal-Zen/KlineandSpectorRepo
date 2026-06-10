/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Script Name: InvtoJE_V05
 * Script Record Name : ZEN | Transactions to Rev JE
 * Script ID : customscript_transaction_to_je
 * Deployed In : Invoice, Vendor Bill, Vendor Payment, Customer Payment
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
            var debitEntity = null;
            var creditEntity = null;

            var DR_ACCOUNT = null;
            var CR_ACCOUNT = null;
            var memoText = '';

            var headerAccount = rec.getValue({ fieldId: 'account' });
            //var headerAccountText = '';


           /* if (
                recordType !== record.Type.INVOICE &&
                recordType !== record.Type.VENDOR_PAYMENT &&
                recordType !== record.Type.CUSTOMER_PAYMENT
            ) {
                headerAccountText = rec.getText({ fieldId: 'account' });
            } */

            var lineCount = recordType === record.Type.INVOICE
                ? rec.getLineCount({ sublistId: 'expcost' })
                : rec.getLineCount({ sublistId: 'expense' });

            log.debug('Line Count', lineCount);

            var sublistId = recordType === record.Type.INVOICE ? 'item' : 'expense';

            var hasValidLineAccount = false;

            log.debug('Document Number', rec.getValue({ fieldId: 'tranid' }));
            log.debug('Header Account ID', headerAccount);
            //log.debug('Header Account Name', headerAccountText);

            // Invoice Logic
            if (recordType === record.Type.INVOICE) {

                if (parseInt(headerAccount) !== 832) {
                    log.debug('Skipped', 'Invoice Header Account not matched');
                    return;
                }

                DR_ACCOUNT = 830; //1651
                CR_ACCOUNT = 833; //1751

                memoText = 'Reversal JE for Customer Invoice ' + recordId;
                debitEntity = rec.getValue({
                    fieldId: 'entity'
                });

                creditEntity = rec.getValue({
                    fieldId: 'entity'
                });

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

                    /* var vbLineAccountText = rec.getSublistText({
                        sublistId: sublistId,
                        fieldId: 'account',
                        line: j
                    }); */

                    log.debug('Vendor Bill Line Account ID Line ' + j, vbLineAccount);
                    //log.debug('Vendor Bill Line Account Name Line ' + j, vbLineAccountText);

                    if (parseInt(vbLineAccount) === 644) {

                        hasValidLineAccount = true;

                        debitEntity = rec.getSublistValue({
                            sublistId: 'expense',
                            fieldId: 'customer',
                            line: j
                        });

                        break;
                    }
                }

                if (!hasValidLineAccount) {
                    log.debug('Skipped', 'Vendor Bill Line Account not matched');
                    return;
                }

                DR_ACCOUNT = 820; //2009
                CR_ACCOUNT = 830; //1651

                memoText = 'Reversal JE for Vendor Bill ' + recordId;

                creditEntity = rec.getValue({
                    fieldId: 'entity'
                });

                log.debug('Processing', 'Vendor Bill');
            }

            // Vendor Payment
            else if (recordType === record.Type.VENDOR_PAYMENT) {


                if (parseInt(headerAccount) !== 1) {
                    log.debug('Skipped', 'Vendor Payment Header Account not matched');
                    return;
                }


                DR_ACCOUNT = 1; //1000
                CR_ACCOUNT = 820; //2009

                memoText = 'Reversal JE for Vendor Payment ' + recordId;

                debitEntity = rec.getValue({
                    fieldId: 'entity'
                });

                creditEntity = rec.getValue({
                    fieldId: 'entity'
                });

                log.debug('Processing', 'Vendor Payment');
            }

            // Customer Payment
            else if (recordType === record.Type.CUSTOMER_PAYMENT) {
                if (parseInt(headerAccount) !== 1) {
                    log.debug('Skipped', 'Customer Payment Header Account not matched');
                    return;
                }

                DR_ACCOUNT = 833; //1751
                CR_ACCOUNT = 834; //4020
                memoText = 'Reversal JE for Customer Payment ' + recordId;

                debitEntity = rec.getValue({
                    fieldId: 'customer'
                });

                creditEntity = rec.getValue({
                    fieldId: 'customer'
                });
                log.debug('Processing', 'Customer Payment');
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

            if (debitEntity) {

                jeRec.setCurrentSublistValue({
                    sublistId: 'line',
                    fieldId: 'entity',
                    value: debitEntity
                });

            }

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

            if (creditEntity) {

                jeRec.setCurrentSublistValue({
                    sublistId: 'line',
                    fieldId: 'entity',
                    value: creditEntity
                });

            }

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'credit',
                value: totalAmount
            });

            jeRec.commitLine({
                sublistId: 'line'
            });

            jeRec.setValue({
                fieldId: 'custbody_source_trans_url',
                value: recordId
            });

            var jeId = jeRec.save();

            record.submitFields({
                type: recordType,
                id: recordId,
                values: {
                    custbody_rev_je_url: jeId
                },
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });

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