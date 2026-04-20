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
 */

define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

    /**
     * afterSubmit entry point
     */
    const afterSubmit = (context) => {
        // Only run on Create or Edit (not Delete/XEdit)
        if (
            context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT
        ) return;

        const billRec = context.newRecord;
        const billId   = billRec.id;
        const billDate = billRec.getValue({ fieldId: 'trandate' });
        const currency = billRec.getValue({ fieldId: 'currency' });
        const lineCount = billRec.getLineCount({ sublistId: 'expense' });

        log.debug('ue_bill_to_invoice', `Processing Bill ID: ${billId} | Lines: ${lineCount}`);

        const clientLineMap = {};

        for (let i = 0; i < lineCount; i++) {
            const clientId = billRec.getSublistValue({
                sublistId : 'expense',
                fieldId   : 'customer',
                line      : i
            });
            const billable_Flag = billRec.getSublistValue({
                sublistId : 'expense',
                fieldId   : 'isbillable',
                line      : i
            });
              let taxreference = billRec.getSublistValue({
                sublistId : 'expense',
                fieldId   : 'taxdetailsreference',
                line      : i
            });
            log.debug(" taxreference  ",taxreference );
        
            if (!clientId && !billable_Flag && !taxreference) {
                log.audit('ue_bill_to_invoice', `Line ${i} skipped — no client tagged.`);
                continue;
            }

            const lineData = {
                account     : billRec.getSublistValue({ sublistId: 'expense', fieldId: 'account',   line: i }),
                amount      : billRec.getSublistValue({ sublistId: 'expense', fieldId: 'amount',    line: i }),
                memo        : billRec.getSublistValue({ sublistId: 'expense', fieldId: 'memo',      line: i }),
                department  : billRec.getSublistValue({ sublistId: 'expense', fieldId: 'department',line: i }),
                class       : billRec.getSublistValue({ sublistId: 'expense', fieldId: 'class',     line: i }),
                location    : billRec.getSublistValue({ sublistId: 'expense', fieldId: 'location',  line: i }),
                taxreference: billRec.getSublistValue({ sublistId: 'expense', fieldId: 'taxdetailsreference', line: i}),
            };

            if (!clientLineMap[clientId]) clientLineMap[clientId] = [];
            clientLineMap[clientId].push(lineData);
        }

        // ── 2. For each client — duplicate check then create invoice ─────────
        for (const [clientId, lines] of Object.entries(clientLineMap)) {
            try {
                if (invoiceExistsForClientAndBill(clientId, billId)) {
                    log.audit('ue_bill_to_invoice',
                        `Invoice already exists for Client: ${clientId} & Bill: ${billId}. Skipping.`);
                    continue;
                }
                log.debug("Line date", lines);
                const inv_id = createInvoice({ clientId, lines, billId, billDate, currency});
                
                if (inv_id) {
                  record.submitFields({
                        type    : record.Type.VENDOR_BILL,  // or string e.g. 'vendorbill'
                        id      : billId,
                        values  : {
                            custbody_invoice_created : true,
                        },
                        
                    });  
                }

            } catch (e) {
                log.error('ue_bill_to_invoice',
                    `Failed for Client ${clientId}: ${e.message} | Stack: ${e.stack}`);
            }
        }
    };

    // ── Helper: Check if invoice already exists for this client + source bill ──
    /**
     * Searches for an existing Invoice linked to the same vendor bill and client.
     * We store the originating bill ID in a custom body field custbody_source_bill.
     * If your environment uses a different field, update fieldId below.
     */
    const invoiceExistsForClientAndBill = (clientId, billId) => {
        const invoiceSearch = search.create({
            type    : search.Type.INVOICE,
            filters : [
                ['entity',               'anyof', clientId],
                'AND',
                ['custbody_vendor_inv_no', 'anyof', billId],
                'AND',
                ['mainline',             'is',    'T'],
                'AND',
                ['voided',               'is',    'F']
            ],
            columns : ['internalid']
        });

        const result = invoiceSearch.run().getRange({ start: 0, end: 1 });
        return result && result.length > 0;
    };

    //     // const createInvoice = ({ clientId, lines, billId, billDate }) => {

    //     const invRec = record.create({
    //         type: record.Type.INVOICE,
    //         isDynamic: true
    //     });

    //     // Header
    //     invRec.setValue({ fieldId: 'entity', value: clientId });
    //     invRec.setValue({ fieldId: 'trandate', value: billDate });
    //   //  invRec.setValue({ fieldId: 'custbody_vendor_inv_no', value: billId });

    //     invRec.setValue({
    //         fieldId: 'memo',
    //         value: `Auto-created from Vendor Bill #${billId}`
    //     });
    //     const expCount = invRec.getLineCount({ sublistId: 'expcost' });

    //     for (let i = 0; i < expCount; i++) {
    //         invRec.setCurrentSublistValue({
    //                             sublistId : 'expcost',
    //                             fieldId   : 'apply',
    //                             value     : true
    //                         });
    //     }

    //     const invoiceId = invRec.save({
    //         enableSourcing: true,
    //         ignoreMandatoryFields: false
    //     });

    //     log.audit('Invoice Created',
    //         `Invoice ${invoiceId} for Client ${clientId}`);

    //     return invoiceId;
    // // };

    const createInvoice = ({ clientId, lines, billId, billDate, currency }) => {

    // Step 1: Create a basic invoice first (header only)
    const invRec = record.create({
        type: record.Type.INVOICE,
        isDynamic: true
    });

    invRec.setValue({ fieldId: 'entity',   value: clientId });
    invRec.setValue({ fieldId: 'trandate', value: billDate });
    invRec.setValue({ fieldId: 'currency', value: currency });
    invRec.setValue({ fieldId: 'custbody_vendor_inv_no', value: billId });
    invRec.setValue({
        fieldId: 'memo',
        value: `Auto-created from Vendor Bill #${billId}`
    });

    // Save first — expcost lines are only populated AFTER entity is saved
    // So we save a bare invoice, then reload and apply expense lines
    const invoiceId = invRec.save({
        enableSourcing: true,
        ignoreMandatoryFields: true
    });

    log.debug('createInvoice', `Draft invoice ${invoiceId} saved. Now applying expense lines.`);

    // Step 2: Load the saved invoice — expcost sublist is now populated
    const savedInv = record.load({
        type: record.Type.INVOICE,
        id: invoiceId,
        isDynamic: true
    });

    const expCount = savedInv.getLineCount({ sublistId: 'expcost' });
    log.debug('createInvoice', `Expense lines available on loaded invoice: ${expCount}`);

    if (expCount === 0) {
        log.audit('createInvoice',
            `No billable expense lines found for client ${clientId}. Deleting draft invoice.`);
        record.delete({ type: record.Type.INVOICE, id: invoiceId });
        return null;
    }

    // Step 3: Match and apply lines by taxdetailsreference
    for (let i = 0; i < expCount; i++) {
        savedInv.selectLine({ sublistId: 'expcost', line: i });

        let invTaxRef = savedInv.getCurrentSublistValue({
            sublistId: 'expcost',
            fieldId: 'taxdetailsreference'
        });

        // Normalize the reference (NetSuite prefixes it with "expcost_")
        if (invTaxRef) {
            invTaxRef = invTaxRef.replace('expcost_', '');
        }

        // Check if this expense line matches one of our bill lines
        const matched = lines.some(line => line.taxreference === invTaxRef);

        savedInv.setCurrentSublistValue({
            sublistId: 'expcost',
            fieldId: 'apply',
            value: true  // true only for matching lines
        });

        savedInv.commitLine({ sublistId: 'expcost' });
    }

    // Step 4: Re-save with expense lines applied
    const finalId = savedInv.save({
        enableSourcing: true,
        ignoreMandatoryFields: false
    });

    log.audit('createInvoice',
        `Invoice ${finalId} finalised for Client ${clientId} from Bill ${billId}`);

    return finalId;
};

    return { afterSubmit };
});