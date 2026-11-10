# Letter 2: to the Surveyor-General

> DRAFT for the Chief Executive's signature, after the legal officer has read it. Not sent. Complete everything in [brackets].

[Vungu Rural District Council letterhead]

[Date]
Our ref: [reference]

The Surveyor-General
Department of the Surveyor-General
[Address]

Dear Sir or Madam

## Request for approved general plans and diagrams of the Vungu Rural District Council area in digital form, and for the terms on which the council may hold them

**1. Why we are writing.** Vungu Rural District Council is introducing a digital land register. It is built on one rule: a parcel's boundary comes only from a plan or diagram approved by the Surveyor-General. The register refuses any other change to a boundary. For that rule to work, the council needs the approved plans and diagrams for its area in a form it can load, and a clear understanding of what it may do with them.

**2. What we ask for.**

1. The approved general plans and diagrams that cover the council area, in digital form where they exist: for each, the Surveyor-General's reference, the township or farm, the date of approval and the stand or lot numbers.
2. For each, the boundary coordinates, and the coordinate system and Lo belt in which they were computed. We hold the Gauss Conform Lo belts on the Arc 1950 datum, which we understand to be the system of the Surveyor-General's records.
3. The farm cadastre for the council area, with the farm numbers and areas as the Surveyor-General holds them. We hold an extract whose stored areas disagree with its shapes in a number of cases, and we would rather replace it than correct it.
4. The trigonometrical and town survey-mark control that the Surveyor-General holds for the area, with coordinates and class, if it may be released.
5. Whether the department publishes, or intends to publish, the national e-cadastre or any interface to approved plans, and if so on what terms the council may use it.

**3. Form.** We can load: GeoPackage, shapefile, GeoJSON, DXF/DWG with a coordinate-system statement, or CSV of coordinates by stand. Where only scanned plans exist, please tell us, and we will not digitise them ourselves without the department's agreement.

**4. How we will use it.** The council will hold a dated, read-only copy, record the Surveyor-General's reference for each parcel, and show the department as the source. A council's own surveys are kept apart and marked as awaiting the Surveyor-General's approval; when the department approves a plan, the council adopts it onto the same parcel and keeps the parcel's identifier. The council will not alter an approved boundary. Where reconciliation finds a plan and the council's records disagree, the council will report it to the department.

**5. Terms.** We ask the department to say: (a) whether the council may hold the data on its own systems; (b) whether it may display boundaries on a public map, and to what level of detail; (c) any fee; and (d) any acknowledgement the department requires. The Land Survey Act [Chapter 20:12] and the Land Survey (General) Regulations (SI 727 of 1979) govern the plans themselves; we are asking about their digital release, not about changing any requirement of those instruments.

**6. A further request.** When a licensed surveyor works for the council, the survey class (A, B or C) is declared at the time the work is delivered. We would like to learn from the department how it would prefer a council's survey to be submitted for approval, so that the council's delivery process can match.

**7. Timing.** We would be grateful for a reply by [date, suggest 30 days]. A first conversation with the officer responsible for digital records would help us ask for the right things.

**8. Contact.** [Name, post, telephone, email].

Yours faithfully

[Name]
Chief Executive Officer
Vungu Rural District Council

---

### Annex: the fields we would like per approved plan or diagram

| Field | Form | Needed for |
|---|---|---|
| Surveyor-General reference | e.g. "GP [number]/[year]" | Recorded on every parcel it approves |
| Township or farm name and number | | Identity |
| Date of approval | | Provenance and currency |
| Stand or lot numbers | | Matching the council's own surveys |
| Boundary coordinates | Polygon in the plan's own system | The register's only source of boundaries |
| Coordinate system, datum and belt | Lo [belt], Arc 1950 | Correct transformation |
| Area as approved | square metres | Checked against the boundary (agreement within 0.5%) |
| Status | current, cancelled, superseded | Retiring a parcel when a plan is replaced |
