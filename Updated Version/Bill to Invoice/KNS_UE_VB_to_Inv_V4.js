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
                log.debug('SKIP EVENT', context.type);
                return;
            }

            var billRec = context.newRecord;
            var billId = billRec.id;
            var billDate = billRec.getValue({ fieldId: 'trandate' });
            var billNumber = billRec.getValue({ fieldId: 'tranid' });
            var currency = billRec.getValue({ fieldId: 'currency' });
            var lineCount = billRec.getLineCount({ sublistId: 'expense' });

            log.audit('START', 'Bill ID: ' + billId + ' | Bill No: ' + billNumber + ' | Lines: ' + lineCount);

            var clientLineMap = {};

            for (var i = 0; i < lineCount; i++) {

                var clientId = billRec.getSublistValue({ sublistId: 'expense', fieldId: 'customer', line: i });
                var isBillable = billRec.getSublistValue({ sublistId: 'expense', fieldId: 'isbillable', line: i });
                var taxRef = billRec.getSublistValue({ sublistId: 'expense', fieldId: 'taxdetailsreference', line: i });

                log.debug('LINE READ', 'Line ' + i +
                    ' | Client: ' + clientId +
                    ' | Billable: ' + isBillable +
                    ' | TaxRef: ' + taxRef);

                if (!clientId || !isBillable) {
                    log.debug('SKIP LINE', 'Line ' + i + ' skipped');
                    continue;
                }

                var lineData = {
                    amount: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'amount', line: i }),
                    taxreference: taxRef
                };

                if (!clientLineMap[clientId]) {
                    clientLineMap[clientId] = [];
                }

                clientLineMap[clientId].push(lineData);
            }

            log.debug('GROUPED DATA', JSON.stringify(clientLineMap));

            for (var clientId in clientLineMap) {
                try {

                    if (invoiceExists(clientId, billId)) {
                        log.audit('DUPLICATE', 'Client ' + clientId);
                        continue;
                    }

                    var invoiceId = createInvoice(clientId, clientLineMap[clientId], billId, billDate, currency);

                    log.audit('INVOICE CREATED', 'Client ' + clientId + ' | Invoice ' + invoiceId);

                } catch (e) {
                    log.error('CLIENT ERROR',
                        'Bill ID: ' + billId +
                        ' | Client: ' + clientId +
                        ' | Error: ' + e.message +
                        ' | Stack: ' + e.stack
                    );
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
                ['entity', 'anyof', clientId], 'AND',
                ['custbody_vendor_inv_no', 'anyof', billId], 'AND',
                ['mainline', 'is', 'T'], 'AND',
                ['voided', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    function createInvoice(clientId, lines, billId, billDate, currency) {

    log.audit('CREATE START', 'Client: ' + clientId);

    var inv = record.create({
        type: record.Type.INVOICE,
        isDynamic: true
    });

    // --- Set Header Fields ---
    inv.setValue({ fieldId: 'entity', value: clientId });
    inv.setValue({ fieldId: 'trandate', value: billDate });
    inv.setValue({ fieldId: 'currency', value: currency });
    inv.setValue({ fieldId: 'custbody_vendor_inv_no', value: billId });

    // --- IMPORTANT: Trigger sourcing ---
    inv.setValue({ fieldId: 'entity', value: clientId });

    // --- Get expcost lines BEFORE saving ---
    var expCount = inv.getLineCount({ sublistId: 'expcost' });

    log.debug('EXP COST COUNT BEFORE SAVE', expCount);

    // --- SAFETY CHECK ---
    if (expCount === 0) {
        log.error('NO EXP LINES', 'Skipping invoice creation for Client: ' + clientId);
        return null;
    }

    var atLeastOneApplied = false;

    for (var i = 0; i < expCount; i++) {

        inv.selectLine({ sublistId: 'expcost', line: i });

        var invTaxRef = inv.getCurrentSublistValue({
            sublistId: 'expcost',
            fieldId: 'taxdetailsreference'
        });

        if (invTaxRef) {
            invTaxRef = invTaxRef.replace('expcost_', '');
        }

        var matched = false;

        for (var j = 0; j < lines.length; j++) {

            log.debug('COMPARE',
                'InvTaxRef: ' + invTaxRef +
                ' | BillTaxRef: ' + lines[j].taxreference);

            if (lines[j].taxreference && invTaxRef &&
                String(lines[j].taxreference) === String(invTaxRef)) {
                matched = true;
                break;
            }
        }

        if (matched) {
            atLeastOneApplied = true;
        }

        inv.setCurrentSublistValue({
            sublistId: 'expcost',
            fieldId: 'apply',
            value: matched
        });

        inv.commitLine({ sublistId: 'expcost' });

        log.debug('LINE RESULT', 'Line ' + i + ' | Applied: ' + matched);
    }

    if (!atLeastOneApplied) {
        log.audit('FALLBACK', 'No match : applying all lines');

        for (var i = 0; i < expCount; i++) {

            inv.selectLine({ sublistId: 'expcost', line: i });

            inv.setCurrentSublistValue({
                sublistId: 'expcost',
                fieldId: 'apply',
                value: true
            });

            inv.commitLine({ sublistId: 'expcost' });
        }
    }

    var hasApplied = false;

    for (var i = 0; i < expCount; i++) {
        var isApplied = inv.getSublistValue({
            sublistId: 'expcost',
            fieldId: 'apply',
            line: i
        });

        if (isApplied) {
            hasApplied = true;
            break;
        }
    }

    if (!hasApplied) {
        log.error('FORCE APPLY', 'Forcing first line');

        inv.selectLine({ sublistId: 'expcost', line: 0 });

        inv.setCurrentSublistValue({
            sublistId: 'expcost',
            fieldId: 'apply',
            value: true
        });

        inv.commitLine({ sublistId: 'expcost' });
    }

    var finalId = inv.save({
        enableSourcing: true,
        ignoreMandatoryFields: false
    });

    log.audit('FINAL SUCCESS', 'Invoice: ' + finalId);

    return finalId;
}

    return { afterSubmit: afterSubmit };
});