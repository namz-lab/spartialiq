# Sample cut-over files

Invented figures in the layouts Pastel and Sage exports commonly use, for trying the accountant's
**Data Migration** screen (`/finance/accountant/migration`). They are not the Council's data.

Load them in this order. The cut-over date can be any date in an open accounting period.

| File | Load | What it shows |
|---|---|---|
| `1-chart-of-accounts.csv` | Chart of accounts | Categories are suggested; "Cash on hand" and "Suspense" are not recognised, so 8410 and 9990 wait for a decision (class 8410 as an asset that behaves as cash; retire 9990 with a reason) |
| `2a-customers.csv` | Customers and suppliers, as customers | Five debtors |
| `2b-suppliers.csv` | Customers and suppliers, as suppliers | Three suppliers |
| `3-trial-balance-usd.csv` | Opening trial balance, USD | Balances at 415,375.40. The nil line and the Total line are set aside and listed. Control account for debtors is 2000 (42,650.00), for creditors 3000 (18,420.00) |
| `4a-debtors-by-document.csv` | Open items, debtors, control account 2000 | One row per document, including an unmatched payment. Totals 42,650.00 |
| `4b-creditors-age-analysis.csv` | Open items, creditors, control account 3000 | A summary age analysis: one row per supplier, one column per age. Totals 18,420.00 |

The opening vouchers are drafts until somebody other than the person who loaded them posts them
(for example the Director of Finance). Then draw up the reconciliation from the opening trial
balance, and the Director signs off.
