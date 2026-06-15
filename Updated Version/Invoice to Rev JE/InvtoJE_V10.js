/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Script Name: InvtoJE_V09
 * Script Record Name : ZEN | Transactions to Rev JE
 * Script ID : customscript_transaction_to_je
 * Deployed In : Invoice, Vendor Bill, Vendor Payment, Customer Payment
 */
define(['N/record', 'N/log'], function (record, log) {

    /**
     * Handles Invoice transaction type.
     *
     * Validation  : Header account must be 832 (AR account).
     *               Item lines must contain at least one line with account 644 (1650).
     * Line Logic  : Iterates 'item' sublist; sums amounts for lines where account = 644.
     * JE Created  : DR 830 (1651) — one debit line, total of matched amounts, entity = customer
     *               CR 833 (1751) — one credit line per matched item line,  entity = customer
     *
     * Example:
     *   Customer Invoice INV-001  (header account 832, entity = C1)
     *     Item line 0 : account 644, amount 30.00
     *     Item line 1 : account 644, amount 20.00
     *     Item line 2 : account 999, amount 15.00  ← skipped (account ≠ 644)
     *   → Reversal JE:
     *       DR 830 | C1 | 50.00
     *       CR 833 | C1 | 30.00
     *       CR 833 | C1 | 20.00
     */
    function handleInvoice(rec) {
        var headerAccount = rec.getValue({ fieldId: 'account' });

        if (parseInt(headerAccount) !== 832) {
            log.debug('Skipped', 'Invoice Header Account not matched');
            return null;
        }

        log.debug('Invoice', 'Header Account matched, checking line accounts');

        var entity      = rec.getValue({ fieldId: 'entity' });
        var lineCount   = rec.getLineCount({ sublistId: 'item' });
        var creditLines = [];
        var debitTotal  = 0;

        for (var j = 0; j < lineCount; j++) {

            var lineAccount = rec.getSublistValue({
                sublistId: 'item',
                fieldId:   'account',
                line:       j
            });

            log.debug('Invoice Line Account ID Line ' + j, lineAccount);

            if (parseInt(lineAccount) === 644) {

                var lineAmount = rec.getSublistValue({
                    sublistId: 'item',
                    fieldId:   'amount',
                    line:       j
                });

                log.debug('Invoice 644 Line ' + j + ' Amount', lineAmount);

                creditLines.push({ entity: entity, amount: lineAmount });
                debitTotal += parseFloat(lineAmount) || 0;
            }
        }

        if (creditLines.length === 0) {
            log.debug('Skipped', 'Invoice — no item lines with account 644 found');
            return null;
        }

        log.debug('Processing', 'Customer Invoice — credit lines: ' + creditLines.length);
        log.debug('Invoice Debit Total', debitTotal);

        return {
            DR_ACCOUNT:  830,       // 1651
            CR_ACCOUNT:  833,       // 1751
            memoText:    'Reversal JE for Customer Invoice ' + rec.id,
            debitEntity: entity,
            debitTotal:  debitTotal,
            creditLines: creditLines
        };
    }

    /**
     * Handles Vendor Bill transaction type.
     *
     * Validation  : Header account must be 820 (2009).
     *               Expense lines must contain at least one line with account 644 (1650).
     * Line Logic  : Iterates 'expense' sublist; sums amounts for lines where account = 644.
     * JE Created  : DR 820 (2009) — one debit line,  total of matched amounts, entity = vendor
     *               CR 830 (1651) — one credit line per matched expense line, entity = client on that line
     *
     * Example:
     *   Vendor Bill BILL-001  (header account 820, vendor V1)
     *     Expense line 0 : account 644, client C1, amount 30.00
     *     Expense line 1 : account 644, client C2, amount 20.00
     *     Expense line 2 : account 999, client C3, amount 10.00  ← skipped (account ≠ 644)
     *   → Reversal JE:
     *       DR 820 | V1 | 50.00
     *       CR 830 | C1 | 30.00
     *       CR 830 | C2 | 20.00
     */
    function handleVendorBill(rec) {
        var headerAccount = rec.getValue({ fieldId: 'account' });

        if (parseInt(headerAccount) !== 820) {
            log.debug('Skipped', 'Vendor Bill Header Account not matched');
            return null;
        }

        log.debug('Vendor Bill', 'Header Account matched, checking line accounts');

        var lineCount   = rec.getLineCount({ sublistId: 'expense' });
        var creditLines = [];
        var debitTotal  = 0;
        var vendor      = rec.getValue({ fieldId: 'entity' });

        for (var j = 0; j < lineCount; j++) {

            var vbLineAccount = rec.getSublistValue({
                sublistId: 'expense',
                fieldId:   'account',
                line:       j
            });

            log.debug('Vendor Bill Line Account ID Line ' + j, vbLineAccount);

            if (parseInt(vbLineAccount) === 644) {

                var lineClient = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId:   'customer',
                    line:       j
                });

                var lineAmount = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId:   'amount',
                    line:       j
                });

                log.debug('Vendor Bill 644 Line ' + j + ' Client', lineClient);
                log.debug('Vendor Bill 644 Line ' + j + ' Amount', lineAmount);

                creditLines.push({ entity: lineClient, amount: lineAmount });
                debitTotal += parseFloat(lineAmount) || 0;
            }
        }

        if (creditLines.length === 0) {
            log.debug('Skipped', 'Vendor Bill — no expense lines with account 644 found');
            return null;
        }

        log.debug('Processing', 'Vendor Bill — credit lines: ' + creditLines.length);
        log.debug('Vendor Bill Debit Total', debitTotal);

        return {
            DR_ACCOUNT:  820,       // 2009
            CR_ACCOUNT:  830,       // 1651 (applied per credit line)
            memoText:    'Reversal JE for Vendor Bill ' + rec.id,
            debitEntity: vendor,
            debitTotal:  debitTotal,
            creditLines: creditLines
        };
    }

    /**
     * Handles Vendor Payment transaction type.
     *
     * Validation  : Header account must be 1 (1000 / bank).
     *               AP account must be 820 (2009).
     *               At least one applied Vendor Bill must have an expense line with account 644 (1650).
     * Line Logic  : Loads each applied (checked) Vendor Bill; iterates its 'expense' lines;
     *               sums amounts for lines where account = 644 and records client entity per line.
     * JE Created  : DR   1 (1000) — one debit line,  total of matched amounts, entity = vendor
     *               CR 820 (2009) — one credit line per matched expense line, entity = client on that bill line
     *
     * Example:
     *   Vendor Payment VP-001  (header account 1, apaccount 820, vendor V1)
     *     Applied Bill BILL-001:
     *       Expense line 0 : account 644, client C1, amount 30.00
     *       Expense line 1 : account 644, client C2, amount 20.00
     *     Applied Bill BILL-002:
     *       Expense line 0 : account 644, client C3, amount 15.00
     *       Expense line 1 : account 999, client C4, amount 10.00  ← skipped (account ≠ 644)
     *   → Reversal JE:
     *       DR   1 | V1 | 65.00
     *       CR 820 | C1 | 30.00
     *       CR 820 | C2 | 20.00
     *       CR 820 | C3 | 15.00
     */
    function handleVendorPayment(rec) {
        var headerAccount = rec.getValue({ fieldId: 'account' });
        var apaccount     = rec.getValue({ fieldId: 'apacct' });

        log.debug('Vendor Payment Header Account', headerAccount);
        log.debug('Vendor Payment AP Account',     apaccount);

        if (parseInt(headerAccount) !== 1 || parseInt(apaccount) !== 820) {
            log.debug('Skipped', 'Vendor Payment Header Account not matched');
            return null;
        }

        var applyLineCount = rec.getLineCount({ sublistId: 'apply' });
        var creditLines    = [];
        var debitTotal     = 0;
        var vendor         = rec.getValue({ fieldId: 'entity' });

        log.debug('Vendor Payment Apply Line Count', applyLineCount);

        for (var i = 0; i < applyLineCount; i++) {

            var isApplied = rec.getSublistValue({
                sublistId: 'apply',
                fieldId:   'apply',
                line:       i
            });

            if (!isApplied) { continue; }

            var appliedBillId = rec.getSublistValue({
                sublistId: 'apply',
                fieldId:   'internalid',
                line:       i
            });

            log.debug('Vendor Payment Applied Bill ID', appliedBillId);

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

                    var lineClient = billRec.getSublistValue({
                        sublistId: 'expense',
                        fieldId:   'customer',
                        line:       j
                    });

                    var lineAmount = billRec.getSublistValue({
                        sublistId: 'expense',
                        fieldId:   'amount',
                        line:       j
                    });

                    log.debug('Vendor Payment Bill ' + appliedBillId + ' Line ' + j + ' Client', lineClient);
                    log.debug('Vendor Payment Bill ' + appliedBillId + ' Line ' + j + ' Amount', lineAmount);

                    creditLines.push({ entity: lineClient, amount: lineAmount });
                    debitTotal += parseFloat(lineAmount) || 0;
                }
            }
        }

        if (creditLines.length === 0) {
            log.debug('Skipped', 'Vendor Payment — no applied Vendor Bill has line account 644');
            return null;
        }

        log.debug('Processing', 'Vendor Payment — credit lines: ' + creditLines.length);
        log.debug('Vendor Payment Debit Total', debitTotal);

        return {
            DR_ACCOUNT:  1,         // 1000
            CR_ACCOUNT:  820,       // 2009
            memoText:    'Reversal JE for Vendor Payment ' + rec.id,
            debitEntity: vendor,
            debitTotal:  debitTotal,
            creditLines: creditLines
        };
    }

    /**
     * Handles Customer Payment transaction type.
     *
     * Validation  : Header account must be 1 (1000 / bank).
     *               AR account must be 832.
     *               At least one applied Customer Invoice must have an item line with account 644 (1650).
     * Line Logic  : Loads each applied (checked) Customer Invoice; iterates its 'item' lines;
     *               sums amounts for lines where account = 644; entity = customer from payment header.
     * JE Created  : DR 833 (1751) — one debit line,  total of matched amounts, entity = customer
     *               CR 834 (4020) — one credit line per matched item line,     entity = customer
     *
     * Example:
     *   Customer Payment CP-001  (header account 1, araccount 832, customer C1)
     *     Applied Invoice INV-001:
     *       Item line 0 : account 644, amount 30.00
     *       Item line 1 : account 644, amount 20.00
     *     Applied Invoice INV-002:
     *       Item line 0 : account 644, amount 15.00
     *       Item line 1 : account 999, amount 10.00  ← skipped (account ≠ 644)
     *   → Reversal JE:
     *       DR 833 | C1 | 65.00
     *       CR 834 | C1 | 30.00
     *       CR 834 | C1 | 20.00
     *       CR 834 | C1 | 15.00
     */
    function handleCustomerPayment(rec) {
        log.debug('Inside Customer Payment', 'Checking header account and AR account');
        var headerAccount = rec.getValue({ fieldId: 'account' });
        var araccount     = rec.getValue({ fieldId: 'aracct' });
        log.debug('Customer Payment Header Account', headerAccount);
        log.debug('Customer Payment AR Account',     araccount);

        if (parseInt(headerAccount) !== 1 || parseInt(araccount) !== 832) {
            log.debug('Skipped', 'Customer Payment Header Account / AR Account not matched');
            return null;
        }

        var applyLineCount = rec.getLineCount({ sublistId: 'apply' });
        var creditLines    = [];
        var debitTotal     = 0;
        var customer       = rec.getValue({ fieldId: 'customer' });

        log.debug('Customer Payment Apply Line Count', applyLineCount);

        for (var i = 0; i < applyLineCount; i++) {

            var isApplied = rec.getSublistValue({
                sublistId: 'apply',
                fieldId:   'apply',
                line:       i
            });

            if (!isApplied) { continue; }

            var appliedInvId = rec.getSublistValue({
                sublistId: 'apply',
                fieldId:   'internalid',
                line:       i
            });

            log.debug('Customer Payment Applied Invoice ID', appliedInvId);

            var invRec       = record.load({ type: record.Type.INVOICE, id: appliedInvId });
            var invLineCount = invRec.getLineCount({ sublistId: 'item' });

            for (var j = 0; j < invLineCount; j++) {

                var invLineAccount = invRec.getSublistValue({
                    sublistId: 'item',
                    fieldId:   'account',
                    line:       j
                });

                log.debug('Customer Payment Invoice ' + appliedInvId + ' Line ' + j + ' Account', invLineAccount);

                if (parseInt(invLineAccount) === 644) {

                    var lineAmount = invRec.getSublistValue({
                        sublistId: 'item',
                        fieldId:   'amount',
                        line:       j
                    });

                    log.debug('Customer Payment Invoice ' + appliedInvId + ' Line ' + j + ' Amount', lineAmount);

                    creditLines.push({ entity: customer, amount: lineAmount });
                    debitTotal += parseFloat(lineAmount) || 0;
                }
            }
        }

        if (creditLines.length === 0) {
            log.debug('Skipped', 'Customer Payment — no applied Invoice has item line with account 644');
            return null;
        }

        log.debug('Processing', 'Customer Payment — credit lines: ' + creditLines.length);
        log.debug('Customer Payment Debit Total', debitTotal);

        return {
            DR_ACCOUNT:  833,       // 1751
            CR_ACCOUNT:  834,       // 4020
            memoText:    'Reversal JE for Customer Payment ' + rec.id,
            debitEntity: customer,
            debitTotal:  debitTotal,
            creditLines: creditLines
        };
    }

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

    /**
     * Creates the Journal Entry from jeParams.
     * All transaction types now use creditLines (multiple CR lines),
     * so drAmount is always sourced from jeParams.debitTotal.
     */
    function createJournalEntry(subsidiary, jeParams, totalAmount, recordType, recordId) {
        var jeRec = record.create({
            type:      record.Type.JOURNAL_ENTRY,
            isDynamic: true
        });

        jeRec.setValue({ fieldId: 'subsidiary', value: subsidiary });
        jeRec.setValue({ fieldId: 'memo',       value: jeParams.memoText });

        // Debit Line
        var drAmount = jeParams.creditLines ? jeParams.debitTotal : totalAmount;

        jeRec.selectNewLine({ sublistId: 'line' });
        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: jeParams.DR_ACCOUNT });

        if (jeParams.debitEntity) {
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'entity', value: jeParams.debitEntity });
        }

        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: drAmount });
        jeRec.commitLine({ sublistId: 'line' });

        // Credit Line(s)
        if (jeParams.creditLines) {
            // All types now: one CR line per matched account-644 line, with per-line entity + amount
            for (var k = 0; k < jeParams.creditLines.length; k++) {
                var crLine = jeParams.creditLines[k];

                jeRec.selectNewLine({ sublistId: 'line' });
                jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: jeParams.CR_ACCOUNT });

                if (crLine.entity) {
                    jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'entity', value: crLine.entity });
                }

                jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: crLine.amount });
                jeRec.commitLine({ sublistId: 'line' });

                log.debug('JE Credit Line ' + k, 'Account: ' + jeParams.CR_ACCOUNT + ' | Entity: ' + crLine.entity + ' | Amount: ' + crLine.amount);
            }
        } else {
            // Fallback: single CR line (safety net — all handlers now return creditLines)
            jeRec.selectNewLine({ sublistId: 'line' });
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: jeParams.CR_ACCOUNT });

            if (jeParams.creditEntity) {
                jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'entity', value: jeParams.creditEntity });
            }

            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: totalAmount });
            jeRec.commitLine({ sublistId: 'line' });
        }

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

            log.debug('Record Type',     recordType);
            log.debug('Record ID',       recordId);
            log.debug('Document Number', rec.getValue({ fieldId: 'tranid' }));

            var subsidiary  = rec.getValue({ fieldId: 'subsidiary' });
            var totalAmount = rec.getValue({ fieldId: 'total' });

            var jeParams = getJEParams(rec, recordType);

            if (!jeParams) { return; }

            var jeId = createJournalEntry(subsidiary, jeParams, totalAmount, recordType, recordId);

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