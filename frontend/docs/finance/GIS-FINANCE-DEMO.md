# GIS-integrated finance: demonstration runbook

How to run the property-map demonstration, what is real and what is demonstration data, and the
walkthrough for the presentation. Code: `backend/src/routes/finance-property.js`, migration
`244_finance_property_gis.sql`, frontend `src/modules/finance/components/gis/` and
`workspaces/shared/PropertyGisPage.vue`.

## Scope: Vungu RDC only

The finance map, search, profiles and figures cover the council's own area: the 19 wards linked to
Vungu RDC (`admin.authority_ward`, ZEC 2023 delimitation), merged into the council boundary. Each
parcel is placed in the council ward its location falls in. Parcels outside those wards (97 farm
parcels and 3 layout stands in the register) are left out, as are capital projects located outside
the council. The area beyond the boundary is muted on the map, and the map cannot be panned far
from it. Wards 3, 4, 6, 7, 8 and 12 show no properties because the register holds no parcels there yet.

## What is real, what is not

| Real (Planning register, copied from live) | Demonstration (local database only) |
|---|---|
| 1,609 stand boundaries (1,589 Hertfordshire from the DXF general plan, 20 layout stands) and the 731 farm parcels | The offers and allocations on 163 Hertfordshire stands (tagged `FINANCE-GIS-DEMO`) |
| The 19 Vungu wards (ZEC 2023) | The allottee names (invented) |
| The zoning that gives each stand its land use | Valuations, rates bills and payments on those stands |
| | The farm accounts from the earlier revenue seed (`REV-`, `LA-DEMO-`) |

The map says this on screen ("Boundaries, wards and zoning: Planning register. Accounts, charges
and payments shown here are demonstration data") and each demonstration property's profile repeats it.

Nothing was written to the live database. Live was read once, to copy the register.

## Setting up (already done on this laptop)

```bash
bash backend/scripts/start-finance-demo.sh                 # backend :3011 + frontend :5180, local DB
bash backend/scripts/copy-planning-register-to-local.sh    # real stands + wards, read from live
docker exec -i lamis-db psql -U postgres -d vungu_master_db_v1 -1 < backend/migrations/244_finance_property_gis.sql
DATABASE_URL=<local> node backend/scripts/seed-finance-property-gis-demo.js   # idempotent
```

Open http://localhost:5180 and use the one-click demo accounts (password `demo1234`).

## Before the presentation

1. **Open the cashier's till.** Sign in as Cashier, go to Daily Cash Up and open the till with a
   float. Payments are refused until the till is open; that is the cash office's own control.
2. Check that stand **HERTS 1378** (Blessing Nkomo, account HERTS-1378) is still **Overdue**
   (US$ 42.80 owed, US$ 21.40 overdue). It is the walkthrough stand. Do not pay it while rehearsing:
   rehearse on another overdue stand, such as HERTS-2811 or HERTS-2800.
3. Leave three stands (HERTS 1383, 1394 and 1405) un-synchronised. They show as "Allocated, no
   finance account" (magenta) so that discovery can be run live.

## The walkthrough

1. **Finance admin** → Dashboard. The council property map is at the top: KPIs on the left, the
   Hertfordshire stands coloured by financial status, wards and the township outline.
2. **Layers** → turn land use and status layers on and off; switch **Colour by** to *Land use*
   (residential/commercial), then back to *Financial status*.
3. Click **stand 1378**, or type `1378` in the search. The profile shows the Planning facts (stand,
   ward, size, zoning, allocation VRDC-STD-2026-000030) beside the account HERTS-1378: US$ 42.80
   outstanding, the October bill overdue, invoices and payment history.
4. Switch workspace to **Cashier** (or sign in as Cashier). On the dashboard, type `HERTS-1378` in
   *Find a citizen's stand* → the same property opens on the map.
5. **Take payment** → Take Payment opens with the account and the overdue October invoice chosen.
   Choose Cash, confirm, then **Issue Receipt & Finish**.
6. **Back to the property map**. The profile now says *1 receipt taken and awaiting posting* and
   shows the balance once it is posted; on the map the stand has a dashed blue ring.
7. Sign in as **Accountant** → Property Map → search `1378` → Payments → **Post**. The status
   changes to *Partially paid* (amber), the overdue amount goes to nil and the council KPIs move.
   (The cashier cannot post their own receipt: the ledger refuses the person who took it.)
8. **Finance admin** → Property Map → **Geographic analytics**: which ward generates the most
   revenue, the suburb with the most debt, allocated stands not fully paid, unbilled properties, the
   lowest collection rate, and where overdue accounts concentrate. Click a ward to go to it on the map.
9. **Planning integration** tab → *Run discovery now*. The three newly allocated stands are picked
   up and their accounts opened; the stands marked allocated in Planning with no allottee stay as
   exceptions, each with the reason. Re-running opens nothing twice.

The same map is in every finance workspace (*Property Map*; *Find Property* for the cashier), each
with its own default: the CEO and the committee open on ward revenue, the budget officer and the
department head on land use with projects, and the publisher sees no account holders.

## Known limits, stated plainly

- **Stand purchase prices are not billed through the ledger.** The profile shows the Planning offer
  price; instalments, deposits and purchase balances need a land-sales billing rule the Council has
  not approved. Only rates and charges are in the balance.
- Water, sewer and electricity layers are listed and disabled: none has been captured.
- Township outlines are drawn from the extent of the township's stands; the register holds no
  suburb boundary.
- Migration 244 is applied to the local database only. Live has 4 of the finance schema's tables,
  so the finance workspaces as a whole are not deployable there yet.
