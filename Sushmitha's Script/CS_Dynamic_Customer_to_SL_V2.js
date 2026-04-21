/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @Owner Mohana
 * @oldversion CS_Dynamic_Customer_to_SL_V1.js
 * @Updated Sushmitha Sekar 
 * @addedLogic I have added csv logic for new Client Ledger script 
 * 
 */
define(['N/record', 'N/url', 'N/search', 'N/currentRecord', 'N/ui/dialog', 'N/log'],
    function (record, url, search, currentRecord, dialog, log) {
        function fieldChanged(context) {

            if (context.fieldId === "custpage_customer") {
                console.log("start cutomer selection");
                var currentRecIs = context.currentRecord;
                var customer = currentRecIs.getValue({
                    fieldId: "custpage_customer"
                });
                var customerText = currentRecIs.getText({
                    fieldId: "custpage_customer"
                })
                log.debug("customer", customer);
                log.debug("customerText", customerText);
                var suiteletURL = url.resolveScript({
                    scriptId: 'customscript_client_ledger_sl',//'customscript_ks_client_ledger2',
                    deploymentId: 'customdeploy_client_ledger_sl',//'customdeploy_ks_client_ledger2',
                    params: {
                        customer: customer,
                        customerText: customerText
                    }
                });
                window.onbeforeunload = null;
                var newPage = (window.location = suiteletURL);
            }

            if (context.fieldId === "custpage_from_customer") {
                console.log("start cutomer selection");
                var currentRecIs = context.currentRecord;
                var fromcustomer = currentRecIs.getValue({
                    fieldId: "custpage_from_customer"
                });
                var fromcustomerText = currentRecIs.getText({
                    fieldId: "custpage_from_customer"
                })
                console.log("From Customer", fromcustomer);
                console.log("From CustomerText", fromcustomerText);
                var suiteletURL = url.resolveScript({
                    scriptId: 'customscript_transfer_client_record',
                    deploymentId: 'customdeploy_transfer_client_record_depl',
                    params: {
                        fromCustomer: fromcustomer,
                        fromCustomerText: fromcustomerText
                    }
                });
                window.onbeforeunload = null;
                var newPage = (window.location = suiteletURL);
            }


            if (context.fieldId === "custpage_from_vendor") {
                console.log("start cutomer selection");
                var currentRecIs = context.currentRecord;
                var fromVendor = currentRecIs.getValue({
                    fieldId: "custpage_from_vendor"
                });
                var fromVendorText = currentRecIs.getText({
                    fieldId: "custpage_from_vendor"
                })
                console.log("From Vendor", fromVendor);
                console.log("From Vendor Text", fromVendorText);
                var suiteletURL = url.resolveScript({
                    scriptId: 'customscript_update_client_for_vendor',
                    deploymentId: 'customdeploy_update_client_for_vendor',
                    params: {
                        fromVendor: fromVendor,
                        fromVendorText: fromVendorText
                    }
                });
                window.onbeforeunload = null;
                var newPage = (window.location = suiteletURL);
            }

            if (context.fieldId === "custpage_customer_ccr") {
                log.debug("Select cutomer for client cost JE");
                var currentRecIs = context.currentRecord;
                var customer = currentRecIs.getValue({
                    fieldId: "custpage_customer_ccr"
                });
                var customerText = currentRecIs.getText({
                    fieldId: "custpage_customer_ccr"
                })
                log.debug("customer", customer);
                log.debug("customerText", customerText);
                var suiteletURL = url.resolveScript({
                    scriptId:'customscript_client_cost_journal',
                    deploymentId:'customdeploy_client_cost_journal_deploy',
                    params: {
                        customer: customer,
                        customerText: customerText
                    }
                });
                window.onbeforeunload = null;
                var newPage = (window.location = suiteletURL);
            }

            

        }
        function downLoadCSV() {
            var currentRecIs = currentRecord.get();
            var customer = currentRecIs.getValue({
                fieldId: "custpage_customer"
            });
            var customerText = currentRecIs.getText({
                    fieldId: "custpage_customer"
                })
            console.log("customer", customer);
            var suiteletURL = url.resolveScript({
                scriptId:'customscript_client_ledger_sl', //'customscript_ks_client_ledger2',
                deploymentId: 'customdeploy_client_ledger_sl',//'customdeploy_ks_client_ledger2',
                params: {
                    customer: customer,
                    downLoad: 'T',
                    customerText: customerText
                }
            });
            window.onbeforeunload = null;
            window.location = suiteletURL;

        }
        
        function downLoadCSVCCJ() {
            var currentRecIs = currentRecord.get();
            var customer = currentRecIs.getValue({
                fieldId: "custpage_customer_ccr"
            });
            var customerText = currentRecIs.getText({
                    fieldId: "custpage_customer_ccr"
                })
            console.log("customer", customer);
            var suiteletURL = url.resolveScript({
                scriptId:'customscript_client_cost_journal',
                deploymentId:'customdeploy_client_cost_journal_deploy',
                params: {
                    customer: customer,
                    downLoad: 'T',
                    customerText: customerText
                }
            });
            window.onbeforeunload = null;
            window.location = suiteletURL;

        }

        function onRedirectClick() {
            var suiteletUrl = url.resolveScript({
                scriptId: 'customscript_transfer_client_record',
                deploymentId: 'customdeploy_transfer_client_record_depl'
            });

            window.location.href = suiteletUrl;
        }

        function onRedirectClickVendor() {
            var suiteletUrl = url.resolveScript({
                scriptId: 'customscript_update_client_for_vendor',
                deploymentId: 'customdeploy_update_client_for_vendor'
            });

            window.location.href = suiteletUrl;
        }

        function onRedirectClickCCJ() {
            var suiteletUrl = url.resolveScript({
                scriptId:'customscript_client_cost_journal',
                deploymentId:'customdeploy_client_cost_journal_deploy',
            });

            window.location.href = suiteletUrl;
        }

        function saveRecord(context) {
            let rec = currentRecord.get();

            let traninforCheckBox = []

            let traninfoCount = rec.getLineCount({
                sublistId: 'custpage_traninfo'
            });
            for (let i = 0; i < traninfoCount; i++) {

                let checkBox = rec.getSublistValue({
                    sublistId: 'custpage_traninfo',
                    fieldId: 'custpage_select',
                    line: i
                });
                traninforCheckBox.push(checkBox)
            }

            if (!traninforCheckBox.includes(true)) {
                alert('Please select at least one line before Transfer');
                return false;
            }

            return true;
        }



        return {
            fieldChanged: fieldChanged,
            downLoadCSV: downLoadCSV,
            downLoadCSVCCJ:downLoadCSVCCJ,
            onRedirectClick: onRedirectClick,
            onRedirectClickVendor: onRedirectClickVendor,
            onRedirectClickCCJ:onRedirectClickCCJ,
            saveRecord: saveRecord
        };
    });