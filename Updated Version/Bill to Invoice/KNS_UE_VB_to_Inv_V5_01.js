/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */

define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    function afterSubmit(context) {
        try {

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            var rec = context.newRecord;
            var recType = rec.type;

            if (recType !== 'vendorbill' && recType !== 'check') {
                log.debug('SKIP', 'Not VB or Check');
                return;
            }

            var recId = rec.id;
            var recNumber = rec.getValue({ fieldId: 'tranid' });
            var recDate = rec.getValue({ fieldId: 'trandate' });
            var currency = rec.getValue({ fieldId: 'currency' });

            var lineCount = rec.getLineCount({ sublistId: 'expense' });

            log.audit('START',
                recType + ' | ID: ' + recId +
                ' | No: ' + recNumber +
                ' | Lines: ' + lineCount
            );

            var clientLineMap = {};

            for (var i = 0; i < lineCount; i++) {

                var clientId = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'customer',
                    line: i
                });

                var isBillable = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'isbillable',
                    line: i
                });

                var taxRef = rec.getSublistValue({
                    sublistId: 'expense',
                    fieldId: 'taxdetailsreference',
                    line: i
                });

                if (!clientId || !isBillable) continue;

                var lineData = {
                    amount: rec.getSublistValue({
                        sublistId: 'expense',
                        fieldId: 'amount',
                        line: i
                    }),
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

                    if (invoiceExists(clientId, recId)) {
                        log.audit('DUPLICATE',
                            'Rec: ' + recNumber + ' | Client: ' + clientId
                        );
                        continue;
                    }

                    var invoiceId = createInvoice(
                        clientId,
                        clientLineMap[clientId],
                        recId,
                        recDate,
                        currency,
                        recNumber
                    );

                    log.audit('INVOICE CREATED',
                        'Rec: ' + recNumber +
                        ' | Client: ' + clientId +
                        ' | Invoice ID: ' + invoiceId
                    );

                } catch (e) {
                    log.error('CLIENT ERROR',
                        'Rec: ' + recNumber +
                        ' | Client: ' + clientId +
                        ' | Error: ' + e.message
                    );
                }
            }

        } catch (e) {
            log.error('FATAL ERROR', e.message);
        }
    }

    function invoiceExists(clientId, recId) {

        var result = search.create({
            type: search.Type.INVOICE,
            filters: [
                ['entity', 'anyof', clientId], 'AND',
                ['custbody_vendor_inv_no', 'anyof', recId], 'AND',
                ['mainline', 'is', 'T'], 'AND',
                ['voided', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result && result.length > 0;
    }

    function createInvoice(clientId, lines, recId, recDate, currency, recNumber) {

        log.audit('CREATE START',
            'Rec: ' + recNumber + ' | Client: ' + clientId
        );

        var inv = record.create({
            type: record.Type.INVOICE,
            isDynamic: true
        });

        inv.setValue({ fieldId: 'entity', value: clientId });
        inv.setValue({ fieldId: 'trandate', value: recDate });
        inv.setValue({ fieldId: 'currency', value: currency });

        inv.setValue({
            fieldId: 'custbody_vendor_inv_no',
            value: recId
        });

        var expCount = inv.getLineCount({ sublistId: 'expcost' });

        if (expCount === 0) {
            log.error('NO EXP LINES', 'Rec: ' + recNumber);
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
        }

        if (!atLeastOneApplied) {

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

        return finalId;
    }

    return {
        afterSubmit: afterSubmit
    };
});