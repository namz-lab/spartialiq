/**
 * What each cut-over load reads from a file, and the column headings each source package is known
 * to use for it.
 *
 * Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §3 (frontend repo).
 *
 * WHAT IS HONEST TO SAY ABOUT THESE HEADINGS
 * No export from the Council's own package has been supplied (decision D7). The aliases below come
 * from the published layouts of Pastel Partner/Xpress and Sage Evolution exports and from the
 * headings councils' spreadsheets commonly carry. They are a starting point: the screen shows
 * which column was matched to which field and a person corrects it before anything is checked.
 * The gates (every code mapped, the trial balance balances, open items equal the control account)
 * do not depend on the layout.
 *
 * Pastel Partner writes several of its exports with NO heading row. Such a file is uploaded with
 * "the first row is column headings" switched off, and its columns are then named Column 1,
 * Column 2 and so on for a person to assign.
 */

const SOURCE_SYSTEMS = [
  { key: 'pastel_partner', label: 'Sage Pastel Partner' },
  { key: 'pastel_xpress', label: 'Sage Pastel Xpress' },
  { key: 'sage_evolution', label: 'Sage Evolution (Sage 200)' },
  { key: 'promun', label: 'Promun' },
  { key: 'spreadsheet', label: 'A spreadsheet kept by the Council' },
  { key: 'other', label: 'Another package' },
]

/**
 * `required` is a list of groups; at least one field of each group must be matched to a column, or
 * the file is refused at mapping time rather than producing the same fault on every row.
 */
const LOADS = {
  chart: {
    label: 'Chart of accounts',
    fields: [
      { key: 'code', label: 'Account number', aliases: ['Account', 'Account Number', 'Account No', 'Acc No', 'Account Code', 'Code', 'GL Account', 'Master Sub Account', 'Master_Sub_Account', 'Vote', 'Vote Number', 'Vote Code', 'Number'] },
      { key: 'name', label: 'Description', aliases: ['Description', 'Account Description', 'Account Name', 'Name', 'Vote Description', 'Vote Name'] },
      { key: 'category', label: 'Financial category', aliases: ['Financial Category', 'Category', 'Account Type', 'Type', 'Account Category', 'Group', 'Report Category', 'Classification'] },
      { key: 'root_type', label: 'Asset, liability, equity, revenue or expense', aliases: ['Root Type', 'Nature', 'Statement Class', 'Class'] },
      { key: 'parent_code', label: 'Heading account number', aliases: ['Parent', 'Parent Account', 'Main Account', 'Heading', 'Parent Code', 'Group Account'] },
      { key: 'is_group', label: 'Is a heading', aliases: ['Is Group', 'Heading Account', 'Is Heading', 'Group Flag'] },
    ],
    required: [['code'], ['name']],
  },
  parties: {
    label: 'Customers and suppliers',
    fields: [
      { key: 'code', label: 'Account number', aliases: ['Account', 'Account Number', 'Account No', 'Acc No', 'Customer Code', 'Supplier Code', 'Customer Account', 'Supplier Account', 'Code', 'Customer', 'Supplier', 'Debtor Code', 'Creditor Code', 'Account Code'] },
      { key: 'name', label: 'Name', aliases: ['Name', 'Description', 'Customer Name', 'Supplier Name', 'Account Name', 'Company', 'Company Name', 'Debtor Name', 'Creditor Name'] },
      { key: 'contact_name', label: 'Contact person', aliases: ['Contact', 'Contact Name', 'Contact Person', 'Attention'] },
      { key: 'contact_phone', label: 'Telephone', aliases: ['Telephone', 'Phone', 'Tel', 'Telephone 1', 'Cell', 'Cellphone', 'Mobile', 'Telephone Number'] },
      { key: 'contact_email', label: 'E-mail', aliases: ['Email', 'E-mail', 'E-mail Address', 'Email Address'] },
      { key: 'address_1', label: 'Address line 1', aliases: ['Address', 'Address 1', 'Postal Address 1', 'Postal 1', 'Physical Address 1', 'Address Line 1', 'Delivery Address 1'] },
      { key: 'address_2', label: 'Address line 2', aliases: ['Address 2', 'Postal Address 2', 'Postal 2', 'Physical Address 2', 'Address Line 2'] },
      { key: 'address_3', label: 'Address line 3', aliases: ['Address 3', 'Postal Address 3', 'Postal 3', 'Physical Address 3', 'Address Line 3', 'City', 'Town'] },
    ],
    required: [['code'], ['name']],
  },
  opening_balance: {
    label: 'Opening trial balance',
    fields: [
      { key: 'code', label: 'Account number', aliases: ['Account', 'Account Number', 'Account No', 'Acc No', 'Account Code', 'Code', 'GL Account', 'Master Sub Account', 'Master_Sub_Account', 'Vote', 'Vote Number', 'Number'] },
      { key: 'name', label: 'Description', aliases: ['Description', 'Account Description', 'Account Name', 'Name'] },
      { key: 'debit', label: 'Debit balance', aliases: ['Debit', 'Dr', 'Debits', 'Debit Balance', 'Closing Debit', 'Balance Debit'] },
      { key: 'credit', label: 'Credit balance', aliases: ['Credit', 'Cr', 'Credits', 'Credit Balance', 'Closing Credit', 'Balance Credit'] },
      { key: 'balance', label: 'Balance (credits negative)', aliases: ['Balance', 'Closing Balance', 'Net', 'Net Balance', 'Amount', 'This Year Balance', 'YTD Balance'] },
    ],
    required: [['code'], ['debit', 'credit', 'balance']],
  },
  open_items: {
    label: 'Open items (age analysis)',
    fields: [
      { key: 'party_code', label: 'Customer or supplier account number', aliases: ['Account', 'Account Number', 'Account No', 'Acc No', 'Customer Code', 'Supplier Code', 'Customer', 'Supplier', 'Code', 'Debtor Code', 'Creditor Code', 'Account Code'] },
      { key: 'document_no', label: 'Document number', aliases: ['Reference', 'Document', 'Document No', 'Document Number', 'Invoice', 'Invoice No', 'Invoice Number', 'Doc No', 'Ref'] },
      { key: 'document_date', label: 'Document date', aliases: ['Date', 'Document Date', 'Invoice Date', 'Transaction Date', 'Doc Date', 'Tx Date'] },
      { key: 'narration', label: 'Description', aliases: ['Description', 'Narration', 'Details', 'Comment'] },
      { key: 'amount', label: 'Amount outstanding', aliases: ['Outstanding', 'Amount Outstanding', 'Balance', 'Amount', 'Open Amount', 'Outstanding Amount', 'Unallocated'] },
      // A summary age analysis: one row per account, one column per age. Each non-nil column
      // becomes an item dated at the START of that age band, the youngest it can be.
      { key: 'age_current', label: 'Current', aliases: ['Current', '0-30', '0 - 30', 'Current Balance'], ageDays: 0 },
      { key: 'age_30', label: '30 days', aliases: ['30 Days', '30', '31-60', '31 - 60', '30 Day'], ageDays: 30 },
      { key: 'age_60', label: '60 days', aliases: ['60 Days', '60', '61-90', '61 - 90', '60 Day'], ageDays: 60 },
      { key: 'age_90', label: '90 days', aliases: ['90 Days', '90', '91-120', '91 - 120', '90 Day'], ageDays: 90 },
      { key: 'age_120', label: '120 days', aliases: ['120 Days', '120', '121-150', '121 - 150', '120 Day'], ageDays: 120 },
      { key: 'age_150', label: '150 days', aliases: ['150 Days', '150', '151-180', '151 - 180', '150 Day'], ageDays: 150 },
      { key: 'age_180', label: '180 days and over', aliases: ['180 Days', '180', '180+', '180 Days+', 'Over 180', '181+'], ageDays: 180 },
    ],
    required: [['party_code'], ['amount', 'age_current', 'age_30', 'age_60', 'age_90', 'age_120', 'age_150', 'age_180']],
  },
}
LOADS.comparison_balance = { ...LOADS.opening_balance, label: 'Parallel-run trial balance' }

const AGE_FIELDS = LOADS.open_items.fields.filter((f) => f.ageDays !== undefined)

/**
 * A suggested statement class for the financial categories the source packages print.
 *
 * A SUGGESTION, shown to a person as an editable table before the file is checked. An account's
 * class is Council data and is never worked out from its number (decision D2); it may be read from
 * the old package's own category for it, once somebody has looked at the table and agreed.
 * A category that is not listed here is left blank, and its accounts wait for a decision.
 */
const CATEGORY_SUGGESTIONS = {
  // Pastel Partner / Xpress financial categories
  sales: { root_type: 'revenue' },
  income: { root_type: 'revenue' },
  revenue: { root_type: 'revenue' },
  otherincome: { root_type: 'revenue' },
  costofsales: { root_type: 'expense' },
  expenses: { root_type: 'expense' },
  expense: { root_type: 'expense' },
  expenditure: { root_type: 'expense' },
  incometax: { root_type: 'expense' },
  fixedassets: { root_type: 'asset', account_type: 'fixed_asset' },
  otherfixedassets: { root_type: 'asset', account_type: 'fixed_asset' },
  investments: { root_type: 'asset' },
  currentassets: { root_type: 'asset' },
  othercurrentassets: { root_type: 'asset' },
  inventory: { root_type: 'asset', account_type: 'inventory' },
  accountsreceivable: { root_type: 'asset', account_type: 'receivable' },
  bank: { root_type: 'asset', account_type: 'bank' },
  cash: { root_type: 'asset', account_type: 'cash' },
  ownersequity: { root_type: 'equity' },
  capital: { root_type: 'equity' },
  equity: { root_type: 'equity' },
  reserves: { root_type: 'equity' },
  retainedincome: { root_type: 'equity', account_type: 'accumulated_surplus' },
  accumulatedsurplus: { root_type: 'equity', account_type: 'accumulated_surplus' },
  shareholdersloans: { root_type: 'liability' },
  longtermborrowings: { root_type: 'liability' },
  longtermliabilities: { root_type: 'liability' },
  otherlongtermliabilities: { root_type: 'liability' },
  currentliabilities: { root_type: 'liability' },
  othercurrentliabilities: { root_type: 'liability' },
  accountspayable: { root_type: 'liability', account_type: 'payable' },
  taxation: { root_type: 'liability', account_type: 'tax' },
  provisions: { root_type: 'liability', account_type: 'provision' },
  // The five roots written out, as a spreadsheet kept by hand usually has them
  asset: { root_type: 'asset' },
  assets: { root_type: 'asset' },
  liability: { root_type: 'liability' },
  liabilities: { root_type: 'liability' },
}

module.exports = { SOURCE_SYSTEMS, LOADS, AGE_FIELDS, CATEGORY_SUGGESTIONS }
