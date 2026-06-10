/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Script Name: InvtoJE_V08
 * Script Record Name : ZEN | Transactions to Rev JE
 * Script ID : customscript_transaction_to_je
 * Deployed In : Invoice, Vendor Bill, Vendor Payment, Customer Payment
 */
define(['N/record', 'N/log'], function (record, log) {

     // Handles Invoice transaction type.

    function handleInvoice(rec) {
        var headerAccount = rec.getValue({ fieldId: 'account' });

        if (parseInt(headerAccount) !== 832) {
            log.debug('Skipped', 'Invoice Header Account not matched');
            return null;
        }

        var entity = rec.getValue({ fieldId: 'entity' });

        log.debug('Processing', 'Customer Invoice');

        return {
            DR_ACCOUNT:   830,    // 1651
            CR_ACCOUNT:   833,    // 1751
            memoText:     'Reversal JE for Customer Invoice ' + rec.id,
            debitEntity:  entity,
            creditEntity: entity
        };
    }

     //* Handles Vendor Bill transaction type.

    function handleVendorBill(rec) {
        var headerAccount = rec.getValue({ fieldId: 'account' });

        if (parseInt(headerAccount) !== 820) {
            log.debug('Skipped', 'Vendor Bill Header Account not matched');
            return null;
        }

        log.debug('Vendor Bill', 'Header Account matched, checking line accounts');

        var lineCount   = rec.getLineCount({ sublistId: 'expense' });
        var debitEntity = null;
        var hasValidLineAccount = false;

        for (var j = 0; j < lineCount; j++) {
            log.debug('Vendor Bill Line Count inside the loop', lineCount);

            var vbLineAccount = rec.getSublistValue({
                sublistId: 'expense',
                fieldId:   'account',
                line:       j
            });

            log.debug('Vendor Bill Line Account ID Line ' + j, vbLineAccount);

            if (parseInt(vbLineAccount) === 644) {
                hasValidLineAccount = true;

                debitEntity = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId:   'customer',
                    line:       j
                });

                break;
            }
        }

        if (!hasValidLineAccount) {
            log.debug('Skipped', 'Vendor Bill Line Account not matched');
            return null;
        }

        log.debug('Processing', 'Vendor Bill');

        return {
            DR_ACCOUNT:   820,    // 2009
            CR_ACCOUNT:   830,    // 1651
            memoText:     'Reversal JE for Vendor Bill ' + rec.id,
            debitEntity:  debitEntity,
            creditEntity: rec.getValue({ fieldId: 'entity' })
        };
    }


     // Handles Vendor Payment transaction type.
    function handleVendorPayment(rec) {
        var headerAccount = rec.getValue({ fieldId: 'account' });

        if (parseInt(headerAccount) !== 1) {
            log.debug('Skipped', 'Vendor Payment Header Account not matched');
            return null;
        }

        // ── Apply-tab check ──────────────────────────────────────────────
        // Loop through each applied Vendor Bill in the 'apply' sublist.
        // For every bill that is checked (apply = true), load it and check
        // whether any of its expense lines has account === 644.
        var applyLineCount = rec.getLineCount({ sublistId: 'apply' });
        var hasValidApplyLineAccount = false;

        log.debug('Vendor Payment Apply Line Count', applyLineCount);

        for (var i = 0; i < applyLineCount; i++) {

            var isApplied = rec.getSublistValue({
                sublistId: 'apply',
                fieldId:   'apply',
                line:       i
            });

            if (!isApplied) {
                continue; // Skip unchecked bills
            }

            var appliedBillId = rec.getSublistValue({
                sublistId: 'apply',
                fieldId:   'internalid',
                line:       i
            });

            log.debug('Vendor Payment Applied Bill ID', appliedBillId);

            // Load the applied Vendor Bill and check its expense lines
            var billRec       = record.load({ type: record.Type.VENDOR_BILL, id: appliedBillId });
            var billLineCount = billRec.getLineCount({ sublistId: 'expense' });

            for (var j = 0; j < billLineCount; j++) {

                var billLineAccount = billRec.getSublistValue({
                    sublistId: 'expense',
                    fieldId:   'account',
                    line:       j
                });

                log.debug('Vendor Payment Bill ' + appliedBillId + ' Line ' + j + ' Account', billLineAccount);

                if (parseInt(billLineAccount) === 644) {
                    hasValidApplyLineAccount = true;
                    break;
                }
            }

            if (hasValidApplyLineAccount) {
                break; // No need to check remaining bills
            }
        }

        if (!hasValidApplyLineAccount) {
            log.debug('Skipped', 'Vendor Payment — no applied Vendor Bill has line account 644');
            return null;
        }

        var entity = rec.getValue({ fieldId: 'entity' });

        log.debug('Processing', 'Vendor Payment');

        return {
            DR_ACCOUNT:   1,      // 1000
            CR_ACCOUNT:   820,    // 2009
            memoText:     'Reversal JE for Vendor Payment ' + rec.id,
            debitEntity:  entity,
            creditEntity: entity
        };
    }

     // Handles Customer Payment transaction type.
    function handleCustomerPayment(rec) {
        var headerAccount = rec.getValue({ fieldId: 'account' });

        if (parseInt(headerAccount) !== 1) {
            log.debug('Skipped', 'Customer Payment Header Account not matched');
            return null;
        }

        var customer = rec.getValue({ fieldId: 'customer' });

        log.debug('Processing', 'Customer Payment');

        return {
            DR_ACCOUNT:   833,    // 1751
            CR_ACCOUNT:   834,    // 4020
            memoText:     'Reversal JE for Customer Payment ' + rec.id,
            debitEntity:  customer,
            creditEntity: customer
        };
    }


     // Routes to the correct handler based on record type.
    function getJEParams(rec, recordType) {
        var handlers = {
            [record.Type.INVOICE]:          handleInvoice,
            [record.Type.VENDOR_BILL]:      handleVendorBill,
            [record.Type.VENDOR_PAYMENT]:   handleVendorPayment,
            [record.Type.CUSTOMER_PAYMENT]: handleCustomerPayment
        };

        var handler = handlers[recordType];

        if (!handler) {
            log.debug('Skipped', 'Unsupported record type: ' + recordType);
            return null;
        }

        return handler(rec);
    }

    // Journal Entry Builder

    function createJournalEntry(subsidiary, jeParams, totalAmount, recordType, recordId) {
        var jeRec = record.create({
            type:      record.Type.JOURNAL_ENTRY,
            isDynamic: true
        });

        jeRec.setValue({ fieldId: 'subsidiary', value: subsidiary });
        jeRec.setValue({ fieldId: 'memo',       value: jeParams.memoText });

        // Debit Line
        jeRec.selectNewLine({ sublistId: 'line' });
        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: jeParams.DR_ACCOUNT });

        if (jeParams.debitEntity) {
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'entity', value: jeParams.debitEntity });
        }

        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: totalAmount });
        jeRec.commitLine({ sublistId: 'line' });

        // Credit Line
        jeRec.selectNewLine({ sublistId: 'line' });
        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: jeParams.CR_ACCOUNT });

        if (jeParams.creditEntity) {
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'entity', value: jeParams.creditEntity });
        }

        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: totalAmount });
        jeRec.commitLine({ sublistId: 'line' });

        jeRec.setValue({ fieldId: 'custbody_source_trans_url', value: recordId });

        return jeRec.save();
    }

    // Entry Point

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
                return;
            }

            var rec        = context.newRecord;
            var recordType = rec.type;
            var recordId   = rec.id;

            log.debug('Record Type', recordType);
            log.debug('Record ID',   recordId);
            log.debug('Document Number', rec.getValue({ fieldId: 'tranid' }));

            var subsidiary  = rec.getValue({ fieldId: 'subsidiary' });
            var totalAmount = rec.getValue({ fieldId: 'total' });

            var jeParams = getJEParams(rec, recordType);

            if (!jeParams) {
                return;
            }

            // Create the Journal Entry
            var jeId = createJournalEntry(subsidiary, jeParams, totalAmount, recordType, recordId);

            // Write back the JE link to the source transaction
            record.submitFields({
                type:   recordType,
                id:     recordId,
                values: { custbody_rev_je_url: jeId },
                options: {
                    enableSourcing:        false,
                    ignoreMandatoryFields: true
                }
            });

            log.debug('Reversal JE Created', jeId);

        } catch (e) {
            log.error('Error Name',    e.name);
            log.error('Error Message', e.message);
            log.error('Error Stack',   e.stack);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});