# Roads and Works: field survey sheets

**For the Civil Engineering Technician and the Roads and Works Foreman. Department of Roads and Works, Vungu Rural District Council. Draft, 18 November 2026.**

The registers in LAMIS hold what could be worked out from maps and the finance asset register. What can only be seen on the ground is missing, and these sheets are for collecting it:

| Register | Records | Missing until surveyed |
|---|---|---|
| Council roads | 1,059 | **Surface and condition of every road**; names for all but 7 |
| Bridges and culverts | 0 | **The whole register** |
| Water points (boreholes) | 142 | **Whether each one works**: all 142 are "unknown" |
| Council buildings | 3 | **Where they are**: none has a location, so none has a ward |

Each road now has its **ward** and its **council road class** (feeder, access, service, track, path), worked out by the system (migration 252). Check them while you are on the road, and note any that are wrong.

**Why it matters.** The council is the road authority for the tertiary roads of its area (Roads Act [Chapter 13:18]); the condition of its roads is what its ZINARA maintenance requests and its road-grading programme rest on. A road with no recorded condition cannot be put on the programme for a reason the council can show. A borehole with an unknown state cannot be reported as working.

## How to fill in the sheets

- One line per road, structure or water point. Use the **asset code** from LAMIS: roads are coded from the map they came from (e.g. `OSM-100856131`), water points `BH-016` and so on. Print the ward's list before you go out.
- Use the codes below exactly, so the sheets can be loaded into LAMIS without retyping.
- Take a photograph of anything rated **poor** or **failed**, and note its number in the last column.
- If you are not sure, write **?**. A guess recorded as fact is worse than a gap.

## Sheet 1: roads

| Asset code | Road name | Surface | Condition | Council class correct? | Width (m) | Drainage | Photo no. | Notes |
|---|---|---|---|---|---|---|---|---|
| | | | | Y / N (if N, which) | | | | |

**Surface:** `earth` (natural ground) · `gravel` · `surface_dressed` (tar, chip seal) · `asphalt` · `concrete` · `paved` (blocks)
**Condition:** `good` (passable in all weather, no repair needed) · `fair` (passable; routine maintenance) · `poor` (difficult; needs grading or repair this year) · `failed` (impassable or washed away)
**Drainage:** `side_drains` · `none` · `blocked` · `eroded`

## Sheet 2: bridges, culverts and drifts

| Road asset code | Structure | Name / location | Condition | Span or diameter (m) | GPS (lat, long) | Photo no. | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

**Structure:** `bridge` · `culvert` · `drift` (low-level crossing) · `causeway`
**Condition:** `good` · `fair` · `poor` · `failed` (as for roads)

## Sheet 3: water points

| Asset code | Ward | Working? | Yield | Hand pump / motorised | Last repaired | Caretaker | Photo no. | Notes |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

**Working?:** `working` · `broken` (needs repair) · `seasonal` (dry part of the year) · `decommissioned`
**Yield:** `good` · `low` · `none`

## Sheet 4: council buildings and assets

| Asset | Department using it | Condition | GPS (lat, long) | Photo no. | Notes |
|---|---|---|---|---|---|
| Council offices, Lincoln Road | | | | | |
| Somabhula clinic | | | | | |
| Maboleni business centre | | | | | |

**Condition:** `good` · `fair` · `poor` · `failed`

## Sheet 5: plant (once a month)

The daily log is kept in LAMIS (**Roads and Works → Plant → Log a day**). Once a month, check each item of plant against the register:

| Plant no. | Description | Status | Hour meter | Last service | Location | Notes |
|---|---|---|---|---|---|---|
| | | working / under repair / broken down / standby | | | | |

## After the survey

Hand the sheets to the District Engineer, who checks them and passes them to the GIS officer for loading. Once a road's surface and condition are loaded from the survey, its record is marked **verified** instead of unverified.
