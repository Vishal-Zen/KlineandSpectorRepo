/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Script Name: InvtoJE_V12
 * Script Record Name : ZEN | Transactions to Rev JE
 * Script ID : customscript_transaction_to_je
 * Deployed In : Invoice, Vendor Bill, Vendor Payment, Customer Payment
 */
define(['N/record', 'N/log', 'N/query'], function (record, log, query) {

    /* ==========================================================
       ACCOUNT CONSTANTS
    ========================================================== */

    var ACCOUNT_1650 = 644; // Account Number 1650
    var ACCOUNT_2009 = 820; // Account Number 2009
    var ACCOUNT_1651 = 830; // Account Number 1651
    var ACCOUNT_1750 = 832; // Account Number 1750
    var ACCOUNT_1751 = 833; // Account Number 1751
    var ACCOUNT_4020 = 834; // Account Number 4020
    var ACCOUNT_1000 = 1;   // Account Number 1000

    /**
     * Handles Invoice transaction type.
     *
     * Validation:
     * Item lines must contain account 1650 (Internal ID 644)
     *
     * Reversal JE:
     * DR 1651 (830)
     * CR 1751 (833)
     *
     * Example:
     * Invoice
     * Line 1 -> Account 644 -> Amount 100
     * Line 2 -> Account 644 -> Amount 50
     *
     * Reversal JE:
     * DR 830 = 150
     * CR 833 = 100
     * CR 833 = 50
     */
    function handleInvoice(rec) {

        log.debug(
            'Customer Invoice',
            'Checking TransactionAccountingLine for Account 1650'
        );

        var customer = rec.getValue({
            fieldId: 'entity'
        });

        var invoiceId = rec.id;

        var creditLines = [];
        var debitTotal = 0;

        var results = query.runSuiteQL({
            query:
                "SELECT amount " +
                "FROM TransactionAccountingLine " +
                "WHERE transaction = ? " +
                "AND account = ?",
            params: [
                invoiceId,
                ACCOUNT_1650
            ]
        }).asMappedResults();

        log.debug(
            'TransactionAccountingLine Results',
            JSON.stringify(results)
        );

        for (var i = 0; i < results.length; i++) {

            var rowAmount = Math.abs(
                parseFloat(results[i].amount) || 0
            );

            creditLines.push({
                entity: customer,
                amount: rowAmount
            });

            debitTotal += rowAmount;

            log.debug(
                'Matching TAL Row',
                'Amount: ' + rowAmount
            );
        }

        if (creditLines.length === 0) {

            log.debug(
                'Skipped',
                'Customer Invoice - No TransactionAccountingLine rows found with Account 1650'
            );

            return null;
        }

        log.debug(
            'Customer Invoice Debit Total',
            debitTotal
        );

        return {

            // DR 1651
            DR_ACCOUNT: ACCOUNT_1651,

            // CR 1751
            CR_ACCOUNT: ACCOUNT_1751,

            memoText:
                'Reversal JE for Customer Invoice ' + invoiceId,

            debitEntity: customer,

            debitTotal: debitTotal,

            creditLines: creditLines
        };
    }

    /**
 * Handles Vendor Bill transaction type.
 *
 * Reversal JE:
 * DR 820 = 150
 * CR 830 = 100 (Client A)
 * CR 830 = 50  (Client B)
 */
    function handleVendorBill(rec) {

        log.debug(
            'Vendor Bill',
            'Checking expense lines for account 1650'
        );

        var vendor = rec.getValue({
            fieldId: 'entity'
        });

        var lineCount = rec.getLineCount({
            sublistId: 'expense'
        });

        var creditLines = [];
        var debitTotal = 0;

        for (var i = 0; i < lineCount; i++) {

            var expenseAccount = rec.getSublistValue({
                sublistId: 'expense',
                fieldId: 'account',
                line: i
            });

            log.debug(
                'Vendor Bill Expense Account Line ' + i,
                expenseAccount
            );

            if (parseInt(expenseAccount) === ACCOUNT_1650) {

                var lineClient = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'customer',
                    line: i
                });

                var lineAmount = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    line: i
                });

                log.debug(
                    'Vendor Bill Matching Line ' + i,
                    'Client: ' + lineClient +
                    ' Amount: ' + lineAmount
                );

                creditLines.push({
                    entity: lineClient,
                    amount: lineAmount
                });

                debitTotal += parseFloat(lineAmount) || 0;
            }
        }

        if (creditLines.length === 0) {

            log.debug(
                'Skipped',
                'Vendor Bill - No expense lines found with account 1650'
            );

            return null;
        }

        log.debug(
            'Vendor Bill Debit Total',
            debitTotal
        );

        return {

            // DR 2009
            DR_ACCOUNT: ACCOUNT_2009,

            // CR 1651
            CR_ACCOUNT: ACCOUNT_1651,

            memoText:
                'Reversal JE for Vendor Bill ' + rec.id,

            debitEntity: vendor,

            debitTotal: debitTotal,

            creditLines: creditLines
        };
    }

    /**
     * Handles Vendor Payment transaction type.
     *
     * Validation:
     * Applied Vendor Bill must contain
     * Expense Account = 2009 (Internal ID 820)
     *
     * Reversal JE:
     * DR 1000 (1)
     * CR 2009 (820)
     */

    function handleVendorPayment(rec) {

        var applyLineCount = rec.getLineCount({
            sublistId: 'apply'
        });

        var vendor = rec.getValue({
            fieldId: 'entity'
        });

        var creditLines = [];
        var debitTotal = 0;

        log.debug(
            'Vendor Payment Apply Count',
            applyLineCount
        );

        for (var i = 0; i < applyLineCount; i++) {

            var isApplied = rec.getSublistValue({
                sublistId: 'apply',
                fieldId: 'apply',
                line: i
            });

            if (!isApplied) {
                continue;
            }

            var billId = rec.getSublistValue({
                sublistId: 'apply',
                fieldId: 'internalid',
                line: i
            });

            log.debug(
                'Applied Vendor Bill',
                billId
            );

            var billRec = record.load({
                type: record.Type.VENDOR_BILL,
                id: billId
            });

            // Validate AP Account = 2009
            var apAccount = billRec.getValue({
                fieldId: 'account'
            });

            if (parseInt(apAccount) !== ACCOUNT_2009) {

                log.debug(
                    'Skipped Bill',
                    billId + ' - AP Account is not 2009'
                );

                continue;
            }

            var expenseLineCount = billRec.getLineCount({
                sublistId: 'expense'
            });

            var bill1650Total = 0;

            for (var j = 0; j < expenseLineCount; j++) {

                var expenseAccount = billRec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account',
                    line: j
                });

                if (parseInt(expenseAccount) !== ACCOUNT_1650) {
                    continue;
                }

                var expenseAmount = billRec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount',
                    line: j
                });

                bill1650Total +=
                    parseFloat(expenseAmount) || 0;

                log.debug(
                    '1650 Line Found',
                    'Bill: ' + billId +
                    ' Amount: ' + expenseAmount
                );
            }

            if (bill1650Total <= 0) {

                log.debug(
                    'Skipped Bill',
                    billId +
                    ' - No expense lines with account 1650'
                );

                continue;
            }

            creditLines.push({
                entity: vendor,
                amount: bill1650Total
            });

            debitTotal += bill1650Total;

            log.debug(
                'Valid Applied Bill',
                'Bill: ' + billId +
                ' | 1650 Total: ' + bill1650Total
            );
        }

        if (creditLines.length === 0) {

            log.debug(
                'Skipped',
                'Vendor Payment - No valid applied Vendor Bills found'
            );

            return null;
        }

        log.debug(
            'Vendor Payment Debit Total',
            debitTotal
        );

        return {

            // DR 1000
            DR_ACCOUNT: ACCOUNT_1000,

            // CR 2009
            CR_ACCOUNT: ACCOUNT_2009,

            memoText:
                'Reversal JE for Vendor Payment ' + rec.id,

            debitEntity: vendor,

            debitTotal: debitTotal,

            creditLines: creditLines
        };
    }

    /**
 * Handles Customer Payment transaction type.
 *
 * Validation:
 * AR Account must be 1750 (Internal ID 832)
 *
 * Reversal JE:
 * DR 1751 (833)
 * CR 4020 (834)
 */
    function handleCustomerPayment(rec) {

        log.debug(
            'Customer Payment',
            'Checking AR Account'
        );

        var araccount = rec.getValue({
            fieldId: 'aracct'
        });

        log.debug(
            'Customer Payment AR Account',
            araccount
        );

        if (parseInt(araccount) !== ACCOUNT_1750) {

            log.debug(
                'Skipped',
                'Customer Payment AR Account not matched'
            );

            return null;
        }

        var customer = rec.getValue({
            fieldId: 'customer'
        });

        var totalAmount = rec.getValue({
            fieldId: 'total'
        });

        log.debug(
            'Customer Payment Total Amount',
            totalAmount
        );

        return {

            // DR 1751
            DR_ACCOUNT: ACCOUNT_1751,

            // CR 4020
            CR_ACCOUNT: ACCOUNT_4020,

            memoText:
                'Reversal JE for Customer Payment ' + rec.id,

            debitEntity: customer,

            debitTotal: totalAmount,

            creditLines: [{
                entity: customer,
                amount: totalAmount
            }]
        };
    }

    /**
     * Returns JE Parameters based on transaction type.
     */
    function getJEParams(rec, recordType) {

        var handlers = {};

        handlers[record.Type.INVOICE] = handleInvoice;

        handlers[record.Type.VENDOR_BILL] = handleVendorBill;

        handlers[record.Type.VENDOR_PAYMENT] = handleVendorPayment;

        handlers[record.Type.CUSTOMER_PAYMENT] = handleCustomerPayment;

        var handler = handlers[recordType];

        if (!handler) {

            log.debug(
                'Skipped',
                'Unsupported Record Type: ' + recordType
            );

            return null;
        }

        return handler(rec);
    }

    // Journal Entry Builder

    /**
     * Creates Journal Entry.
     */
    function createJournalEntry(
        subsidiary,
        jeParams,
        totalAmount,
        recordType,
        recordId
    ) {

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
            value: jeParams.memoText
        });

        // Debit Line

        jeRec.selectNewLine({
            sublistId: 'line'
        });

        jeRec.setCurrentSublistValue({
            sublistId: 'line',
            fieldId: 'account',
            value: jeParams.DR_ACCOUNT
        });

        if (jeParams.debitEntity) {

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'entity',
                value: jeParams.debitEntity
            });
        }

        jeRec.setCurrentSublistValue({
            sublistId: 'line',
            fieldId: 'debit',
            value: jeParams.debitTotal
        });

        jeRec.commitLine({
            sublistId: 'line'
        });

        log.debug(
            'JE Debit Line',
            'Account: ' +
            jeParams.DR_ACCOUNT +
            ' Amount: ' +
            jeParams.debitTotal
        );

        // Credit Lines

        for (var i = 0; i < jeParams.creditLines.length; i++) {

            var creditLine = jeParams.creditLines[i];

            jeRec.selectNewLine({
                sublistId: 'line'
            });

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'account',
                value: jeParams.CR_ACCOUNT
            });

            if (creditLine.entity) {

                jeRec.setCurrentSublistValue({
                    sublistId: 'line',
                    fieldId: 'entity',
                    value: creditLine.entity
                });
            }

            jeRec.setCurrentSublistValue({
                sublistId: 'line',
                fieldId: 'credit',
                value: creditLine.amount
            });

            jeRec.commitLine({
                sublistId: 'line'
            });

            log.debug(
                'JE Credit Line ' + i,
                'Account: ' +
                jeParams.CR_ACCOUNT +
                ' | Entity: ' +
                creditLine.entity +
                ' | Amount: ' +
                creditLine.amount
            );
        }

        // Source Transaction

        jeRec.setValue({
            fieldId: 'custbody_source_trans_url',
            value: recordId
        });

        var jeId = jeRec.save();

        log.debug(
            'Journal Entry Saved',
            jeId
        );

        return jeId;
    }

    // Entry Point

    function afterSubmit(context) {

        try {

            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT
            ) {
                return;
            }

            var rec = context.newRecord;

            var recordType = rec.type;

            var recordId = rec.id;

            log.debug(
                'Record Type',
                recordType
            );

            log.debug(
                'Record ID',
                recordId
            );

            log.debug(
                'Document Number',
                rec.getValue({
                    fieldId: 'tranid'
                })
            );

            var subsidiary = rec.getValue({
                fieldId: 'subsidiary'
            });

            var totalAmount = rec.getValue({
                fieldId: 'total'
            });

            var jeParams = getJEParams(
                rec,
                recordType
            );

            if (!jeParams) {

                log.debug(
                    'Skipped',
                    'Transaction does not meet validation criteria'
                );

                return;
            }

            var jeId = createJournalEntry(
                subsidiary,
                jeParams,
                totalAmount,
                recordType,
                recordId
            );

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

            log.debug(
                'Reversal JE Created',
                jeId
            );

        } catch (e) {

            log.error(
                'Error Name',
                e.name
            );

            log.error(
                'Error Message',
                e.message
            );

            log.error(
                'Error Stack',
                e.stack
            );
        }
    }

    return {
        afterSubmit: afterSubmit
    };

});