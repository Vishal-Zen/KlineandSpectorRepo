/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @Owner Sushmitha Sekar C 
 * @description - client ledger report
 * @updatedVersion - 11 in this version i have updated the PAYEE NAME LOOP
 *  */

define(["N/ui/serverWidget", "N/search", "N/file", 'N/query'],
    function (serverWidget, search, file, query) {
        function onRequest(context) {
            if (context.request.method == "GET") {
                try {

                    let customer = context.request.parameters.customer;
                    let customerText = context.request.parameters.customerText;
                    let downLoadCSVButton = context.request.parameters.downLoad;

                    let listOfRecords

                    var form = serverWidget.createForm({ title: "Client Ledger" });
                    form.addFieldGroup({ id: "Customerinfo", label: "Customer Information" });

                    let customerField = form.addField({
                        id: "custpage_customer",
                        label: "Customer",
                        type: serverWidget.FieldType.SELECT,
                        container: "Customerinfo",
                        source: 'customer'
                    });
                    if (customer != "") {
                        customerField.defaultValue = customer;
                    }

                    let sublist = form.addSublist({
                        id: "custpage_traninfo",
                        label: "Transaction Details",
                        type: serverWidget.SublistType.LIST
                    })

                    sublist.addField({ id: "custpage_date", label: "Date", type: serverWidget.FieldType.DATE });
                    sublist.addField({ id: "custpage_payee", label: "Payee", type: serverWidget.FieldType.TEXT });
                    sublist.addField({ id: "custpage_memomain", label: "Memo", type: serverWidget.FieldType.TEXT });
                    sublist.addField({ id: "custpage_expcat", label: "Expense Category", type: serverWidget.FieldType.TEXT });
                    sublist.addField({ id: "custpage_client", label: "Client", type: serverWidget.FieldType.TEXT })
                    sublist.addField({ id: "custpage_dno", label: "Document Number", type: serverWidget.FieldType.TEXT });
                    sublist.addField({ id: "custpage_account", label: "Account", type: serverWidget.FieldType.TEXT });
                    sublist.addField({ id: "custpage_generalaccount", label: "General Account", type: serverWidget.FieldType.TEXT });
                    sublist.addField({ id: "custpage_trustaccount", label: "Trust Account", type: serverWidget.FieldType.TEXT });

                    //headers will show while scroll down
                    let floatingHeadersScript = form.addField({
                        id: 'custpage_floatingheaders_script',
                        label: 'Hidden',
                        type: serverWidget.FieldType.INLINEHTML
                    });

                    floatingHeadersScript.defaultValue = `
                        <script>
                        jQuery(document).ready(function() {
                            // Add CSS
                            let style = document.createElement('style');
                            style.textContent = \`
                                .uir-machine-table-container {
                                    max-height: 70vh !important;
                                    overflow-y: auto !important;
                                    position: relative !important;
                                }
                                .uir-machine-headerrow {
                                    position: sticky !important;
                                    top: 0 !important;
                                    z-index: 100 !important;
                                }
                               
                            \`;
                            document.head.appendChild(style);
                            // Apply container class
                            jQuery('.uir-machine-table').parent().addClass('uir-machine-table-container');
                            // Handle sort indicators
                            jQuery('.listheadertd, .listheadertdleft').click(function() {
                                jQuery('.listheadersortdown').removeClass('listheadersortdown').addClass('listheadersort');
                                jQuery(this).find('.listheadersort').removeClass('listheadersort').addClass('listheadersortdown');
                            });
                        });
                </script>
                `;
                    form.addButton({
                        id: "custpage_export",
                        label: "Export",
                        functionName: "downLoadCSV"
                    });

                    if (customer != null && customer != '') {
                        ////log.debug("Customer ", customer);
                        listOfRecords = getRecordQuery(customer);
                        ////log.debug(" List of Records ", listOfRecords);

                        processUIPage(listOfRecords, sublist, customerText)

                    }
                    if (downLoadCSVButton == "T" && listOfRecords) {
                        log.audit(" CSV ")
                        //  listOfRecords = getRecordQuery(customer);
                        getExportRecords(customerText, listOfRecords, context);
                        return;
                    }
                    form.clientScriptModulePath = 'SuiteScripts/CS_Dynamic_Customer_to_SL_V2.js'     //'SuiteScripts/tranReport(CU Updated)(client).js';
                    context.response.writePage({
                        pageObject: form
                    });



                } catch (e) {
                    log.error("error is", e);
                    let errorForm = serverWidget.createForm({ title: "Client Ledger — Error" });
                    errorForm.addField({
                        id: 'custpage_error_msg',
                        label: 'Error',
                        type: serverWidget.FieldType.INLINEHTML
                    }).defaultValue = `
                        <div style="padding:20px; background:#fff3cd; border:1px solid #ffc107; border-radius:4px; color:#856404;">
                            <strong>An error occurred while loading the Client Ledger </strong><br/>
                            <small style="color:#999;">Error: ${e.message || e}</small>
                        </div>`;
                    context.response.writePage({ pageObject: errorForm });
                }
            }

            function getRecordQuery(customer) {
                try {

                    let suiteQL = `
                   SELECT
                        t.id,
                        t.trandate,

                        CASE 
                            WHEN t.type = 'Check' 
                            THEN t.transactionnumber
                            ELSE t.tranid
                        END AS document_number,

                        t.type,
                        t.recordtype,

                        COALESCE(tl.memo, t.memo) AS description,
                        COALESCE(BUILTIN.DF(tl.cseg1), '') AS expcategory,

                        tal.account,
                        a.acctnumber,
                        a.fullname AS account_name,
                        a.accttype AS account_type,
                        COALESCE(a.custrecord_ks_trust_account, 'F') AS is_trust_account,

                        tal.debit,
                        tal.credit,


                        CASE 
                            WHEN payee.type IN ('Vendor','Employee')
                            THEN t.entity
                            ELSE NULL
                        END AS payee,


                        CASE
                            WHEN lineentity.type = 'CustJob'
                            THEN lineentity.id
                            ELSE t.custbody_ks_customer_name
                        END AS client

                    FROM transaction t

                    JOIN transactionaccountingline tal
                        ON tal.transaction = t.id

                    LEFT JOIN account a
                        ON a.id = tal.account

                    LEFT JOIN transactionline tl
                        ON tl.transaction = t.id
                        AND tl.id = tal.transactionline

                    LEFT JOIN entity payee
                        ON payee.id = t.entity


                    LEFT JOIN entity lineentity
                        ON lineentity.id = tl.entity

                    WHERE
                    (
                        (
                            EXISTS (
                                SELECT 1
                                FROM transactionline tl2
                                WHERE tl2.transaction = t.id
                                AND tl2.entity = ?
                            )
                            AND t.type NOT IN ('CustPymt','VendPymt','Transfer','Journal')
                        )
                        OR
                        (
                            t.type = 'Transfer'
                            AND t.custbody_ks_customer_name = ?

                        )
                    )

                    AND tal.posting = 'T'

                    AND
                    (
                        (
                            t.type IN ('Check','Deposit','ExpRept')
                            AND a.accttype NOT IN ('AcctRec','AcctPay','CredCard')
                        )
                        OR
                        (
                            t.type NOT IN ('Check','Deposit','ExpRept')
                            AND a.accttype NOT IN ('AcctRec','AcctPay','CredCard')
                        )
                    )

                    ORDER BY t.recordtype ASC
                                `;


                    let results = query.runSuiteQL({
                        query: suiteQL,
                        params: [customer, customer]
                    }).asMappedResults();

                    log.audit(" Query Result", results);
                    return results

                } catch (e) {
                    log.error("error is", e);
                }


            }

            function processUIPage(listOfRecords, sublist, customerText) {
                let AccountSummary = {};
                let trustAccountSummary = {};
                let bankAccountSummary = {};
                let expenseSummary = {};
                let payeeMap = buildPayeeMap(listOfRecords);  // ONE time before the loop

                listOfRecords.forEach((row, index) => {
                    // use payeeName directly — no more individual lookups
                });



                listOfRecords.forEach((row, index) => {
                    let date = row.trandate || '';
                    let payee1 = row.payee ? String(row.payee) : '';
                    let payee = row.payee ? String(row.payee) : '';
                    let payeeName = payeeMap[payee] || 'Kline Specter PC';//(row.recordtype !== 'transfer' ? 'Kline Specter PC' : '');
                    // log.audit(" PAYEE 1 ", payee1);
                    // log.audit(" PAYEE  ", payee);
                    // log.audit(" PAYEE Name ", payeeName);
                    //  let client = row.client ? String(row.client) : '';
                    let memo = row.description || '';
                    let expCat = row.expcategory || '';
                    let documentNo = row.document_number || '';
                    let recordType = row.recordtype || '';
                    let account = row.account_name;
                    let accountNum = row.acctnumber;
                    let accountName = accountNum ? accountNum + ' ' + account : account;
                    //let accountName = accountNum + ' ' + account;
                    let accountType = row.account_type;
                    let accountId = row.account;
                    let credit = Number(row.credit) || 0;
                    let debit = Number(row.debit) || 0;


                    let isTrust = row.is_trust_account === 'T';

                    let trustCredit = isTrust && credit > 0 ? credit : '';
                    let trustDebit = isTrust && debit > 0 ? debit : '';

                    let generalCredit = !isTrust && credit > 0 ? credit : '';
                    let generalDebit = !isTrust && debit > 0 ? debit : '';

                    // ---------------- Expense Summary Logic ----------------

                    if (
                        expCat &&
                        (
                            row.recordtype === 'expensereport' ||
                            row.recordtype === 'vendorbill' ||
                            row.recordtype === 'check'
                        )
                    ) {

                        if (!expenseSummary[expCat]) {
                            expenseSummary[expCat] = {
                                total: 0,
                                expText: expCat
                            };
                        }

                        let amount = (Number(debit) || 0) - (Number(credit) || 0);

                        expenseSummary[expCat].total += amount;
                    }



                    // log.audit('Line ' + index, JSON.stringify({
                    //     date, payee1, payee, payeeName, memo, documentNo, recordType, accountId, accountName, trustCredit, trustDebit, generalCredit, generalDebit, isTrust, credit, debit, customerText
                    // }));

                    if (customerText) {
                        sublist.setSublistValue({ id: 'custpage_client', line: index, value: customerText });
                    }

                    if (date) sublist.setSublistValue({ id: 'custpage_date', line: index, value: date });

                    if (payeeName) {
                        //log.audit(" PAYEE NAME ", payeeName);
                        sublist.setSublistValue({ id: 'custpage_payee', line: index, value: payeeName ? payeeName : '' });
                    }

                    if (memo) sublist.setSublistValue({ id: 'custpage_memomain', line: index, value: memo });
                    if (expCat) sublist.setSublistValue({ id: 'custpage_expcat', line: index, value: expCat });
                    if (documentNo) sublist.setSublistValue({ id: 'custpage_dno', line: index, value: documentNo });
                    if (accountName) sublist.setSublistValue({ id: 'custpage_account', line: index, value: accountName });
                    if (trustCredit) {
                        trustCredit = formatCurrency(trustCredit);
                        ////log.debug("Formated amount T Cr ", trustCredit);
                        sublist.setSublistValue({ id: 'custpage_trustaccount', line: index, value: '(' + trustCredit + ')' });
                    }

                    if (trustDebit) {
                        trustDebit = formatCurrency(trustDebit);
                        ////log.debug("Formated amount T Cr ", trustDebit);
                        sublist.setSublistValue({ id: 'custpage_trustaccount', line: index, value: trustDebit });
                    }

                    if (generalCredit) {
                        generalCredit = formatCurrency(generalCredit);
                        ////log.debug("Formated amount G Cr ", generalCredit);
                        sublist.setSublistValue({ id: 'custpage_generalaccount', line: index, value: '(' + generalCredit + ')' });
                    }

                    if (generalDebit) {
                        generalDebit = formatCurrency(generalDebit);
                        ////log.debug("Formated amount G Dr ", generalDebit);
                        sublist.setSublistValue({ id: 'custpage_generalaccount', line: index, value: generalDebit });
                    }

                    if (isTrust) {
                        ////log.debug(" ", "IS TRUST");
                        if (isTrust) {

                            if (!trustAccountSummary[accountName]) {

                                trustAccountSummary[accountName] = {
                                    debit: 0,
                                    credit: 0,
                                    accountText: accountName
                                };
                            }

                            let existing = trustAccountSummary[accountName];

                            existing.debit += debit;
                            existing.credit += credit;

                        }

                    }

                    if (!AccountSummary[accountName] && accountType != "Bank" && !isTrust) {
                        ////log.debug("", " ACCOUNT SUMMARY");
                        AccountSummary[accountName] = { debit: 0, credit: 0, accountText: accountName, accountType: accountType };

                        AccountSummary[accountName].debit = parseFloat(AccountSummary[accountName].debit + (isNaN(debit) ? 0 : debit));
                        AccountSummary[accountName].credit = parseFloat(AccountSummary[accountName].credit + (isNaN(credit) ? 0 : credit));
                        ////log.debug(" ACCOUNT SUMMARY BLOCK ", AccountSummary);
                    } else if (AccountSummary[accountName] && accountType != "Bank" && !isTrust) {
                        ////log.debug("Existing Account in Acc Summary", AccountSummary)
                        AccountSummary[accountName].debit = parseFloat(AccountSummary[accountName].debit + (isNaN(debit) ? 0 : debit));
                        AccountSummary[accountName].credit = parseFloat(AccountSummary[accountName].credit + (isNaN(credit) ? 0 : credit));
                    }

                    if (accountType === "Bank" && !isTrust) {

                        if (!bankAccountSummary[accountName]) {

                            bankAccountSummary[accountName] = {
                                debit: 0,
                                credit: 0,
                                accountText: accountName,
                                accountType: accountType
                            };
                        }

                        let existing = bankAccountSummary[accountName];

                        existing.debit = (Number(existing.debit) || 0) + (Number(debit) || 0);
                        existing.credit = (Number(existing.credit) || 0) + (Number(credit) || 0);
                    }

                });


                if (Object.keys(AccountSummary).length > 0) {
                    ////log.debug("AccountSummary 1", AccountSummary);
                    accountSummary(AccountSummary);
                }

                if (Object.keys(bankAccountSummary).length > 0) {
                    ////log.debug("bankAccountSummary", bankAccountSummary);
                    var summaryHtml = `
                                        <style>
                                            .summary-table {
                                                border-collapse: collapse;
                                                width: 100%;
                                                margin-top: 20px;
                                            }
                                            .summary-table th, .summary-table td {
                                                border: 1px solid #999;
                                                padding: 8px;
                                                text-align: left;
                                                font-size:12px;

                                            }
                                            .summary-table th {
                                                background-color: #f2f2f2;
                                            }
                                        </style>
                                        <h5><br>Bank Account Summary</h5>
                                        <table class="summary-table">
                                            <thead>
                                            <tr>
                                                <th>G/L Account</th>
                                                <th>G/L Account Summary</th>                                           
                                            </tr>
                                            </thead>
                                            <tbody> `;


                    for (let key in bankAccountSummary) {
                        ////log.debug("key", key);
                        log.audit(" Bank Account Summary inside AccSummary", bankAccountSummary);
                        let accountText = bankAccountSummary[key].accountText;
                        let bankDebit = parseFloat(bankAccountSummary[key].debit);
                        let bankCredit = parseFloat(bankAccountSummary[key].credit);

                        ////log.debug(" bank debit ", bankDebit);
                        ////log.debug(" Bank Credit ", bankCredit);

                        totalBankAmt = bankCredit + bankDebit;
                        totalBankAmt = formatCurrency(totalBankAmt);

                        //log.debug(" totalBankAmt: totalBankAmt ", totalBankAmt);

                        // Append row
                        summaryHtml += `
                                    <tr>
                                        <td>${accountText}</td>
                                        <td>
                                            ${totalBankAmt < 0 ? totalBankAmt * -1 : totalBankAmt}
                                        </td>                                      
                                    </tr>`;

                        var summaryScript = `<script>
                                    require(['N/record', 'N/currentRecord'], function (record, currRec) {
                                    let sublistDivClass=document.querySelector('.uir-machine-table-container');
                                    console.log("sublistDivClass",sublistDivClass);
                                    let createDiv=document.createElement('div');
                                    createDiv.className='uir-summary';
                                    createDiv.id='summary-table';
                                    createDiv.innerHTML=${JSON.stringify(summaryHtml)};
                                    if(sublistDivClass)
                                        sublistDivClass.appendChild(createDiv);
                                });
                                </script>`;

                    }
                    form.addField({
                        id: "custpage_bankaccountsummary",
                        label: "Bank Account Summary",
                        type: serverWidget.FieldType.INLINEHTML,
                    }).defaultValue = summaryScript;
                }


                if (Object.keys(trustAccountSummary).length > 0) {
                    ////log.debug("trustAccountSummary", trustAccountSummary);
                    TrustaccountSummary(trustAccountSummary)
                }

                if (Object.keys(expenseSummary).length > 0) {
                    ExpenseSummary(expenseSummary);
                }

            }

            function accountSummary(AccountSummary) {

                var summaryHtml = `
                                    <style>
                                        .summary-table {
                                            border-collapse: collapse;
                                            width: 100%;
                                            margin-top: 20px;
                                        }
                                        .summary-table th, .summary-table td {
                                            border: 1px solid #999;
                                            padding: 8px;
                                            text-align: left;
                                            font-size:12px;

                                        }
                                        .summary-table th {
                                            background-color: #f2f2f2;
                                        }
                                    </style>
                                    <h5><br>Account Summary</h5>
                                    <table class="summary-table">
                                        <thead>
                                        <tr>
                                            <th>G/L Account</th>
                                            <th>Billed</th>
                                            <th>UnBilled</th>
                                            
                                        </tr>
                                        </thead>
                                        <tbody> `;

                let creditamount = 0;
                let debitamount = 0;
                let totalBilled = 0;
                let totalUnbilled = 0;


                for (let key in AccountSummary) {
                    //.debug("AccountSummary loop", AccountSummary);
                    let accountText = AccountSummary[key].accountText;
                    let accountType = AccountSummary[key].accountType;

                    //log.debug(" ACC TYPE Inside Summary ", accountType);

                    creditamount = parseFloat(AccountSummary[key].credit);
                    debitamount = parseFloat(AccountSummary[key].debit);

                    // log.debug(" Credit amnt", creditamount);
                    // log.debug(" unbilled", debitamount)

                    let Billed_Amt = 0;
                    let Unbilled_Amt = 0;

                    // Credit / Debit based conditions
                    if (creditamount === debitamount) {
                        // log.debug(" IF 1 Credit", creditamount);
                        // log.debug(" IF 1 Debit", debitamount);
                        Billed_Amt = creditamount;
                        Unbilled_Amt = creditamount - debitamount;

                    } else if (creditamount > 0 && debitamount === 0 && accountType == "Income") {
                        // log.debug(" IF 2 Credit", creditamount);
                        // log.debug(" IF 2 Debit", debitamount);
                        Billed_Amt = creditamount;
                        Unbilled_Amt = 0;

                    } else if (creditamount === 0 && debitamount > 0) {
                        // log.debug(" IF 3 Credit", creditamount);
                        // log.debug(" IF 3 Debit", debitamount);
                        Billed_Amt = 0;
                        Unbilled_Amt = debitamount;

                    } else if (creditamount > 0 && debitamount === 0) {
                        // log.debug(" IF 4 Credit", creditamount);
                        // log.debug(" IF 4 Debit", debitamount);
                        Billed_Amt = creditamount;
                        Unbilled_Amt = 0;

                    } else if (creditamount > 0 && debitamount > 0) {
                        // log.debug(" IF 4 Credit", creditamount);
                        // log.debug(" IF 4 Debit", debitamount);
                        Billed_Amt = debitamount;
                        Unbilled_Amt = creditamount - debitamount;
                    }

                    totalBilled += Billed_Amt;
                    totalUnbilled += Unbilled_Amt;

                    formatted_Billed_Amt = formatCurrency(Billed_Amt);
                    formatted_Unbilled_Amt = formatCurrency(Unbilled_Amt);

                    formattedTotalBilled = formatCurrency(totalBilled);
                    formattedTotalUnbilled = formatCurrency(totalUnbilled);

                    log.debug(" formatted Billed ", formatted_Billed_Amt);
                    log.debug(" formatted Unbilled ", formatted_Unbilled_Amt);
                    log.debug(" formattedTotalBilled ", formattedTotalBilled);
                    log.debug(" formattedTotalUnbilled ", formattedTotalUnbilled);


                    summaryHtml += `
                                            <tr>
                                                <td>${accountText}</td>
                                                <td>${formatted_Billed_Amt}</td>
                                                <td>${formatted_Unbilled_Amt}</td>
                                            </tr>
                                        `;

                }

                // TOTAL ROW
                summaryHtml += `
                                        <tr style="font-weight:bold;background-color:#f9f9f9;">
                                            <td>Total</td>
                                            <td>${formattedTotalBilled}</td>
                                            <td>${formattedTotalUnbilled}</td>
                                        </tr>
                                    `;

                summaryHtml += `
                                            </tbody>
                                        </table>
                                    `;

                var summaryScript = `<script>
                                    require(['N/record', 'N/currentRecord'], function (record, currRec) {
                                    let sublistDivClass=document.querySelector('.uir-machine-table-container');
                                    console.log("sublistDivClass",sublistDivClass);
                                    let createDiv=document.createElement('div');
                                    createDiv.className='uir-summary';
                                    createDiv.id='summary-table';
                                    createDiv.innerHTML=${JSON.stringify(summaryHtml)};
                                    if(sublistDivClass)
                                        sublistDivClass.appendChild(createDiv);
                                    });
                                    </script>`;

                form.addField({
                    id: "custpage_accountsummary",
                    label: "Account Summary",
                    type: serverWidget.FieldType.INLINEHTML,
                }).defaultValue = summaryScript;

            }



            function TrustaccountSummary(trustAccountSummary) {
                var summaryHtml = `
                                                <style>
                                                    .summary-table {
                                                        border-collapse: collapse;
                                                        width: 100%;
                                                        margin-top: 20px;
                                                    }
                                                    .summary-table th, .summary-table td {
                                                        border: 1px solid #999;
                                                        padding: 8px;
                                                        text-align: left;
                                                        font-size:12px;

                                                    }
                                                    .summary-table th {
                                                        background-color: #f2f2f2;
                                                    }
                                                </style>
                                                <h5><br>Trust Account Summary</h5>
                                                <table class="summary-table">
                                                    <thead>
                                                    <tr>
                                                        <th>G/L Account</th>
                                                        <th>G/L Account Summary</th>                                           
                                                    </tr>
                                                    </thead>
                                                    <tbody> `;


                for (let key in trustAccountSummary) {
                    //log.debug("key", key);
                    log.audit(" Trust Account Summary inside AccSummary", trustAccountSummary);
                    let accountText = trustAccountSummary[key].accountText;
                    credit_Trust_Amount = parseFloat(trustAccountSummary[key].credit);
                    debit_Trust_Amount = parseFloat(trustAccountSummary[key].debit);
                    total_Trust_Amount = parseFloat(credit_Trust_Amount) - parseFloat(debit_Trust_Amount);
                    log.debug(" trustAmt: trustAmount ", total_Trust_Amount);

                    total_Trust_Amount = formatCurrency(total_Trust_Amount);
                    log.debug(" Trust total Summary Formated", total_Trust_Amount);

                    // Append row
                    summaryHtml += `
                                            <tr>
                                                <td>${accountText}</td>
                                                <td>
                                                    ${total_Trust_Amount < 0 ? total_Trust_Amount * -1 : total_Trust_Amount}
                                                </td>                                      
                                            </tr>`;

                    var summaryScript = `<script>
                                            require(['N/record', 'N/currentRecord'], function (record, currRec) {
                                            let sublistDivClass=document.querySelector('.uir-machine-table-container');
                                            console.log("sublistDivClass",sublistDivClass);
                                            let createDiv=document.createElement('div');
                                            createDiv.className='uir-summary';
                                            createDiv.id='summary-table';
                                            createDiv.innerHTML=${JSON.stringify(summaryHtml)};
                                            if(sublistDivClass)
                                                sublistDivClass.appendChild(createDiv);
                                        });
                                        </script>`;
                }
                form.addField({
                    id: "custpage_trustaccountsummary",
                    label: "Trust Account Summary",
                    type: serverWidget.FieldType.INLINEHTML,
                }).defaultValue = summaryScript;
            }

            function ExpenseSummary(expenseSummary) {

                var summaryHtml = `
        <style>
            .summary-table {
                border-collapse: collapse;
                width: 100%;
                margin-top: 20px;
            }
            .summary-table th, .summary-table td {
                border: 1px solid #999;
                padding: 8px;
                text-align: left;
                font-size:12px;
            }
            .summary-table th {
                background-color: #f2f2f2;
            }
        </style>
        <h5><br>Expense Code Summary</h5>
        <table class="summary-table">
            <thead>
                <tr>
                    <th>Expense Category</th>
                    <th>Expense Summary</th>
                </tr>
            </thead>
            <tbody>
    `;

                for (let key in expenseSummary) {

                    let expText = expenseSummary[key].expText;
                    let total = expenseSummary[key].total;

                    let formattedTotal = formatCurrency(total);

                    summaryHtml += `
            <tr>
                <td>${expText}</td>
                <td>${formattedTotal}</td>
            </tr>
        `;
                }

                summaryHtml += `
            </tbody>
        </table>
    `;

                var summaryScript = `<script>
        require(['N/currentRecord'], function () {
            let sublistDivClass = document.querySelector('.uir-machine-table-container');
            let createDiv = document.createElement('div');
            createDiv.className = 'uir-summary';
            createDiv.innerHTML = ${JSON.stringify(summaryHtml)};
            if (sublistDivClass)
                sublistDivClass.appendChild(createDiv);
        });
    </script>`;

                form.addField({
                    id: "custpage_expensesummary",
                    label: "Expense Summary",
                    type: serverWidget.FieldType.INLINEHTML,
                }).defaultValue = summaryScript;
            }

            function getExportRecords(customerText, listOfRecords, context) {

                let AccountSummary = {};
                let trustAccountSummary = {};
                let bankAccountSummary = {};
                let expenseSummary = {};
                let payeeMap = buildPayeeMap(listOfRecords);

                // -----------------------------------------------------------------------
                // 1.  Build detail rows  (mirrors the forEach loop in processUIPage)
                // -----------------------------------------------------------------------
                let detailRows = [];

                listOfRecords.forEach(function (row) {

                    let recordType = row.recordtype || '';
                    let payee = row.payee ? String(row.payee) : '';
                    let payeeName = payeeMap[payee] || 'Kline Specter PC';
                    let accountNum = row.acctnumber || '';
                    let accountText = row.account_name || '';
                    let accountName = (accountNum + ' ' + accountText).trim();
                    let accountType = row.account_type || '';
                    let credit = Number(row.credit) || 0;
                    let debit = Number(row.debit) || 0;
                    let isTrust = row.is_trust_account === 'T';

                    let trustCredit = isTrust && credit > 0 ? credit : 0;
                    let trustDebit = isTrust && debit > 0 ? debit : 0;
                    let generalCredit = !isTrust && credit > 0 ? credit : 0;
                    let generalDebit = !isTrust && debit > 0 ? debit : 0;

                    // Format trust/general amounts with parentheses for credits (matching original display)

                    let trustDisplay_Credit = trustCredit ? trustCredit : '';
                    let trustDisplay_Debit = trustDebit ? trustDebit : '';
                    let generalDisplay_Credit = generalCredit ? generalCredit : '';
                    let generalDisplay_Debit = generalDebit ? generalDebit : '';

                    trustDisplay_Credit = formatCurrency(trustDisplay_Credit);
                    trustDisplay_Debit = formatCurrency(trustDisplay_Debit);
                    generalDisplay_Credit = formatCurrency(generalDisplay_Credit);
                    generalDisplay_Debit = formatCurrency(generalDisplay_Debit);

                    // ---------------- Expense Summary Logic ----------------
                    let expCat = row.expcategory || '';

                    if (
                        expCat &&
                        (
                            row.recordtype === 'expensereport' ||
                            row.recordtype === 'vendorbill' ||
                            row.recordtype === 'check'
                        )
                    ) {

                        if (!expenseSummary[expCat]) {
                            expenseSummary[expCat] = {
                                total: 0,
                                expText: expCat
                            };
                        }

                        let amount = (Number(debit) || 0) - (Number(credit) || 0);

                        expenseSummary[expCat].total += amount;
                    }

                    //log.debug(" CSV Formated trustDisplay_Credit ", trustDisplay_Credit);
                    //log.debug(" CSV Formated trustDisplay_Debit ", trustDisplay_Debit);
                    //log.debug(" CSV Formated generalDisplay_Credit ", generalDisplay_Credit);
                    //log.debug(" CSV Formated generalDisplay_Debit ", generalDisplay_Debit);

                    let date = formatDate(row.trandate);
                    log.audit(" DATE FORMAt", date);

                    detailRows.push([
                        date || '',
                        payeeName,
                        row.description || '',
                        expCat || '',
                        customerText,
                        row.document_number || '',
                        accountName,
                        generalDisplay_Credit ? '(' + generalDisplay_Credit + ')' : (generalDisplay_Debit ? generalDisplay_Debit : ''),
                        trustDisplay_Credit ? '(' + trustDisplay_Credit + ')' : (trustDisplay_Debit ? trustDisplay_Debit : '')
                    ]);

                    log.audit(" Detail Row in CSV ", detailRows);

                    // ---- Accumulate summaries (same logic as original) ----------------

                    if (isTrust) {
                        if (!trustAccountSummary[accountName]) {
                            trustAccountSummary[accountName] = {
                                debit: 0,
                                credit: 0,
                                accountText: accountName
                            };
                        }

                        trustAccountSummary[accountName].debit += debit;
                        trustAccountSummary[accountName].credit += credit;
                    }

                    if (!isTrust && accountType !== 'Bank') {
                        if (!AccountSummary[accountName]) {
                            AccountSummary[accountName] = { debit: 0, credit: 0, accountText: accountName, accountType: accountType };
                        }
                        AccountSummary[accountName].debit += debit;
                        AccountSummary[accountName].credit += credit;
                    }

                    if (accountType === 'Bank' && !isTrust) {
                        if (!bankAccountSummary[accountName]) {
                            bankAccountSummary[accountName] = { debit: 0, credit: 0, accountText: accountName, accountType: accountType };
                        }
                        bankAccountSummary[accountName].debit += debit;
                        bankAccountSummary[accountName].credit += credit;
                    }
                });


                // -----------------------------------------------------------------------
                // 2.  Build CSV content
                // -----------------------------------------------------------------------
                let csv = [];

                // -- Transaction Detail --------------------------------------------------
                csv.push(csvRow(['TRANSACTION DETAIL']));
                csv.push(csvRow([
                    'Date',
                    'Payee',
                    'Memo',
                    'Expense Category',
                    'Client',
                    'Document Number',
                    'Account',
                    'General Amount',
                    'Trust Amount'
                ]));
                detailRows.forEach(function (r) { csv.push(csvRow(r)); });


                // // -- Account Summary -----------------------------------------------------
                if (Object.keys(AccountSummary).length > 0) {
                    csv.push(csvRow([]));   // blank spacer row
                    csv.push(csvRow(['ACCOUNT SUMMARY']));
                    csv.push(csvRow(['G/L Account', 'Billed', 'UnBilled']));

                    let totalBilled = 0;
                    let totalUnbilled = 0;

                    for (let key in AccountSummary) {
                        let entry = AccountSummary[key];
                        let creditAmt = parseFloat(entry.credit);
                        let debitAmt = parseFloat(entry.debit);
                        let accountType = entry.accountType;
                        let billedAmt = 0;
                        let unbilledAmt = 0;

                        if (creditAmt === debitAmt) {
                            billedAmt = creditAmt;
                            unbilledAmt = creditAmt - debitAmt;          // always 0
                        } else if (creditAmt > 0 && debitAmt === 0 && accountType === 'Income') {
                            billedAmt = creditAmt;
                            unbilledAmt = 0;
                        } else if (creditAmt === 0 && debitAmt > 0) {
                            billedAmt = 0;
                            unbilledAmt = debitAmt;
                        } else if (creditAmt > 0 && debitAmt === 0) {
                            billedAmt = creditAmt;
                            unbilledAmt = 0;
                        } else if (creditAmt > 0 && debitAmt > 0) {
                            billedAmt = debitAmt;
                            unbilledAmt = creditAmt - debitAmt;
                        }

                        totalBilled += billedAmt;
                        totalUnbilled += unbilledAmt;

                        formatted_Billed_Amt = formatCurrency(billedAmt);
                        formatted_Unbilled_Amt = formatCurrency(unbilledAmt);

                        formattedTotalBilled = formatCurrency(totalBilled);
                        formattedTotalUnbilled = formatCurrency(totalUnbilled);

                        //log.debug(" CSV formatted Billed ", formatted_Billed_Amt);
                        //log.debug(" CSV formatted Unbilled ", formatted_Unbilled_Amt);
                        //log.debug(" CSV formattedTotalBilled ", formattedTotalBilled);
                        //log.debug(" CSV formattedTotalUnbilled ", formattedTotalUnbilled);

                        csv.push(csvRow([entry.accountText, formatted_Billed_Amt, formatted_Unbilled_Amt]));
                    }

                    csv.push(csvRow(['Total', formattedTotalBilled, formattedTotalUnbilled]));
                }


                // -- Bank Account Summary ------------------------------------------------
                if (Object.keys(bankAccountSummary).length > 0) {
                    csv.push(csvRow([]));
                    csv.push(csvRow(['BANK ACCOUNT SUMMARY']));
                    csv.push(csvRow(['G/L Account', 'G/L Account Summary']));

                    for (let bKey in bankAccountSummary) {
                        let bEntry = bankAccountSummary[bKey];
                        let bDebit = parseFloat(bEntry.debit);
                        let bCredit = parseFloat(bEntry.credit);
                        let bAmt = bDebit > 0 && bCredit === 0 ? bDebit
                            : bCredit > 0 && bDebit === 0 ? bCredit
                                : bDebit + bCredit;             // fallback: show combined

                        formatted_bAmt = formatCurrency(bAmt);

                        //log.debug(" CSV formatted Bank Amount ", formatted_bAmt);

                        csv.push(csvRow([
                            bEntry.accountText, formatted_bAmt < 0 ? (formatted_bAmt * -1) : formatted_bAmt
                        ]));
                    }
                }


                // -- Trust Account Summary -----------------------------------------------
                if (Object.keys(trustAccountSummary).length > 0) {
                    csv.push(csvRow([]));
                    csv.push(csvRow(['TRUST ACCOUNT SUMMARY']));
                    csv.push(csvRow(['G/L Account', 'G/L Account Summary']));

                    for (let tKey in trustAccountSummary) {
                        let tEntry = trustAccountSummary[tKey];
                        let tCredit = parseFloat(tEntry.credit);
                        let tDebit = parseFloat(tEntry.debit);
                        let tTotal = tCredit - tDebit;

                        formatted_tTotal = formatCurrency(tTotal);

                        //log.debug(" CSV formatted Trust Amount ", formatted_tTotal);

                        csv.push(csvRow([
                            tEntry.accountText, formatted_tTotal < 0 ? formatted_tTotal * -1 : formatted_tTotal
                        ]));
                    }
                }

                if (Object.keys(expenseSummary).length > 0) {
                    csv.push(csvRow([]));
                    csv.push(csvRow(['EXPENSE CATEGORY SUMMARY']));
                    csv.push(csvRow(['Expense Category', 'Expense Summary']));

                    for (let key in expenseSummary) {
                        let entry = expenseSummary[key];

                        let total = entry.total;
                        let formattedTotal = formatCurrency(total);

                        csv.push(csvRow([
                            entry.expText,
                            formattedTotal
                        ]));
                    }
                }


                let csvString = csv.join('\r\n');
                let fileName = 'Client_Ledger_Report_' + customerText.replace(/[^a-zA-Z0-9_]/g, '_') + '.csv';

                let csvFile = file.create({
                    name: fileName,
                    fileType: file.Type.CSV,
                    contents: csvString
                });

                context.response.writeFile({
                    file: csvFile,
                    isInline: false   // false = forces download, not inline display
                });
            }


            function csvRow(fields) {
                return fields.map(function (val) {
                    let str = val === null || val === undefined ? '' : String(val);
                    // Escape double-quotes, then wrap in quotes if the value contains
                    // a comma, double-quote, or newline
                    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
                        str = '"' + str.replace(/"/g, '""') + '"';
                    }
                    return str;
                }).join(',');
            }

            function formatDate(dateStr) {
                if (!dateStr) return '';

                // If already in MM/DD/YYYY format, return as-is
                if (dateStr.indexOf('/') !== -1) return dateStr;

                // Convert MM-DD-YYYY → M/D/YYYY
                let parts = dateStr.split('-');
                if (parts.length !== 3) return dateStr;

                return parseInt(parts[0]) + '/' + parseInt(parts[1]) + '/' + parts[2];
            }

            function formatCurrency(amount) {
                let formattedAmount = amount.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD'
                });
                ////log.debug("Formated amount", formattedAmount);
                return formattedAmount
            }

            function buildPayeeMap(listOfRecords) {
                let vendorIds = [];
                let employeeIds = [];

                listOfRecords.forEach(row => {
                    if (!row.payee) return;
                    if (row.recordtype === 'expensereport') {
                        employeeIds.push(String(row.payee));
                    } else {
                        vendorIds.push(String(row.payee));
                    }
                });

                let payeeMap = {};

                if (vendorIds.length > 0) {
                    search.create({
                        type: search.Type.VENDOR,
                        filters: [['internalid', 'anyof', vendorIds]],
                        columns: ['internalid', 'entityid', 'altname']
                    }).run().each(result => {
                        let id = result.id;
                        let name = (result.getValue('entityid') + ' ' + result.getValue('altname')).trim();
                        payeeMap[id] = name || 'Kline Specter PC';
                        return true;
                    });
                }

                if (employeeIds.length > 0) {
                    search.create({
                        type: search.Type.EMPLOYEE,
                        filters: [['internalid', 'anyof', employeeIds]],
                        columns: ['internalid', 'entityid']
                    }).run().each(result => {
                        payeeMap[result.id] = result.getValue('entityid') || 'Kline Specter PC';
                        return true;
                    });
                }

                return payeeMap;
            }

        }

        return {
            onRequest
        };
    });