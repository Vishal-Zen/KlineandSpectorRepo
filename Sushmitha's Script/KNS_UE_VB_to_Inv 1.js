/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define(['N/record', 'N/log'], (record, log) => {

    const afterSubmit = (context) => {

        if (context.type !== context.UserEventType.CREATE) return;

        const billRec  = context.newRecord;
        const billId   = billRec.id;
        const billDate = billRec.getValue({ fieldId: 'trandate' });

        const lineCount = billRec.getLineCount({ sublistId: 'expense' });

        log.debug('Bill Processing', `Bill ID: ${billId} | Lines: ${lineCount}`);

        const clientMap = {};

        // 🔹 Group lines by customer
        for (let i = 0; i < lineCount; i++) {

            const customer = billRec.getSublistValue({
                sublistId: 'expense',
                fieldId: 'customer',
                line: i
            });

            const isBillable = billRec.getSublistValue({
                sublistId: 'expense',
                fieldId: 'isbillable',
                line: i
            });

            if (!customer || !isBillable) continue;

            if (!clientMap[customer]) {
                clientMap[customer] = true;
            }
        }

        // 🔥 Create invoice per customer
        for (let clientId in clientMap) {

            try {

               let createdInvId = createInvoice(clientId, lines, billId, billDate)

            } catch (e) {
                log.error('Error',
                    `Client ${clientId} | ${e.message}`);
            }
        }
    };

    const createInvoice = ({ clientId, lines, billId, billDate }) => {

    const invRec = record.create({
        type: record.Type.INVOICE,
        isDynamic: true
    });

    // Header
    invRec.setValue({ fieldId: 'entity', value: clientId });
    invRec.setValue({ fieldId: 'trandate', value: billDate });
    invRec.setValue({ fieldId: 'custbody_vendor_inv_no', value: billId });

    invRec.setValue({
        fieldId: 'memo',
        value: `Auto-created from Vendor Bill #${billId}`
    });

   
    lines.forEach(function(line){
        let invTaxRef = invRec.getCurrentSublistValue({
            sublistId: 'expcost',
            fieldId: 'taxdetailsreference'
        });

         if (invTaxRef) {
            invTaxRef = invTaxRef.replace('expcost_', '');
        }
    });

    const invoiceId = invRec.save({
        enableSourcing: true,
        ignoreMandatoryFields: false
    });

    log.audit('Invoice Created',
        `Invoice ${invoiceId} for Client ${clientId}`);

    return invoiceId;
};

    return { afterSubmit };
});