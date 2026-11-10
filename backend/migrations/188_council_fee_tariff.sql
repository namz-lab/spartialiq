-- Working council tariff for the citizen payment page.
-- Amounts are the schedule held in this system. Finance replaces them
-- when Council adopts a tariff. Bill items (rates, water, refuse) take
-- the amount on the payer's account, not a flat fee.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_purpose_check CHECK (
  purpose IN (
    'application_fee', 'inspection_fee', 'permit_fee', 'occupation_certificate', 'other',
    'land_rates', 'supplementary_charge', 'rates_clearance', 'shop_licence', 'vendor_permit',
    'refuse_charge', 'water_charge', 'sewer_charge', 'cemetery_fee', 'market_fee',
    'stand_deposit', 'lease_rent', 'plan_scrutiny', 'advertisement_fee', 'wayleave_fee',
    'property_search', 'hall_hire', 'dog_licence', 'appeal_fee'
  )
);

CREATE TABLE IF NOT EXISTS public.council_fee_tariff (
  code         varchar(32) PRIMARY KEY,
  department   varchar(64) NOT NULL,
  title        varchar(80) NOT NULL,
  detail       text NOT NULL,
  amount_usd   numeric(12,2),
  unit_label   varchar(40) NOT NULL,
  priced_by    varchar(8) NOT NULL CHECK (priced_by IN ('tariff', 'bill')),
  sort_order   integer NOT NULL,
  active       boolean NOT NULL DEFAULT true
);

INSERT INTO public.council_fee_tariff
  (code, department, title, detail, amount_usd, unit_label, priced_by, sort_order)
VALUES
  ('land_rates',            'Finance',              'Land rates',                  'Pay the rates on a stand or account. Enter the amount on the statement.', NULL, 'as billed',        'bill',   10),
  ('supplementary_charge',  'Finance',              'Supplementary charge',        'Pay a supplementary charge on the rates account.',                         NULL, 'as billed',        'bill',   20),
  ('rates_clearance',       'Finance',              'Rates clearance certificate', 'Certificate that rates are clear before a transfer.',                     20,  'per certificate',  'tariff', 30),
  ('property_search',       'Finance',              'Property search',             'Search fee for the rates or property record.',                            10,  'per search',       'tariff', 40),
  ('shop_licence',          'Finance',              'Shop licence',                'Annual shop licence.',                                                    80,  'per year',         'tariff', 50),
  ('vendor_permit',         'Finance',              'Vendor permit',               'Permit to trade as a vendor or hawker.',                                  20,  'per year',         'tariff', 60),
  ('market_fee',            'Finance',              'Market stall',                'Monthly market stall fee.',                                               15,  'per month',        'tariff', 70),
  ('dog_licence',           'Finance',              'Dog licence',                 'Annual dog licence.',                                                      5,  'per year',         'tariff', 80),
  ('application_fee',       'Town planning',        'Development application',     'Fee to lodge a development application.',                                 50,  'per application',  'tariff', 110),
  ('plan_scrutiny',         'Town planning',        'Plan scrutiny',               'Fee to examine building plans.',                                          30,  'per plan',         'tariff', 120),
  ('permit_fee',            'Town planning',        'Development permit',          'Fee when a development permit is issued.',                                40,  'per permit',       'tariff', 130),
  ('appeal_fee',            'Town planning',        'Appeal',                      'Fee to lodge an appeal against a planning decision.',                     50,  'per appeal',       'tariff', 140),
  ('advertisement_fee',     'Town planning',        'Advertisement permit',        'Permit for a sign or billboard.',                                         40,  'per site',         'tariff', 150),
  ('inspection_fee',        'Building inspectorate','Stage inspection',            'Fee for a building stage inspection.',                                    25,  'per inspection',   'tariff', 210),
  ('occupation_certificate','Building inspectorate','Occupation certificate',      'Fee for the occupation certificate.',                                     35,  'per certificate',  'tariff', 220),
  ('refuse_charge',         'Engineering',          'Refuse removal',              'Pay the refuse charge on the account.',                                   NULL, 'as billed',        'bill',   310),
  ('water_charge',          'Engineering',          'Water',                       'Pay the water account.',                                                  NULL, 'as billed',        'bill',   320),
  ('sewer_charge',          'Engineering',          'Sewerage',                    'Pay the sewerage account.',                                               NULL, 'as billed',        'bill',   330),
  ('wayleave_fee',          'Engineering',          'Wayleave',                    'Fee to open a road or verge.',                                            30,  'per opening',      'tariff', 340),
  ('stand_deposit',         'Housing',              'Stand deposit',               'Deposit when a council stand is allocated.',                             100, 'per stand',        'tariff', 410),
  ('lease_rent',            'Housing',              'Lease rent',                  'Pay rent on a council lease. Enter the amount on the statement.',       NULL, 'as billed',        'bill',   420),
  ('cemetery_fee',          'Social services',      'Cemetery',                    'Burial or grave fee.',                                                    25,  'per burial',       'tariff', 510),
  ('hall_hire',             'Social services',      'Hall hire',                   'Hire of a council hall.',                                                 40,  'per booking',      'tariff', 520)
ON CONFLICT (code) DO NOTHING;

GRANT SELECT ON public.council_fee_tariff TO vungu_app, vungu_runtime;
