# Letter 1: to the Zimbabwe Electoral Commission

> DRAFT for the Chief Executive's signature, after the legal officer has read it. Not sent. Complete everything in [brackets].

[Vungu Rural District Council letterhead]

[Date]
Our ref: [reference]

The Chairperson
Zimbabwe Electoral Commission
[Address]

Dear Sir or Madam

## Request for the ward delimitation in digital form, for the Vungu Rural District Council area

**1. Why we are writing.** Vungu Rural District Council is introducing a digital planning and land register. Its maps and its rules about which council sees which land depend on the wards of the council area. We understand that the Commission delimited the country's wards in 2022 and finalised the delimitation in February 2023, at 1,970 wards. The ward boundaries we hold are the national statistical set published before that delimitation, which has 1,961 wards. The two will not match one for one, and we would like to use the Commission's.

**2. What we ask for.**

1. The 2022 delimitation of wards as GIS data, for the whole country or, if that is not possible, for the province and districts that adjoin the council area: ward polygons with the ward number, ward name if any, constituency, district and province.
2. The list of wards that fall within the Vungu Rural District Council area, with the instrument or report that fixes it, so that the council area can be built as the union of its wards.
3. The date of the delimitation, the version of the dataset, and the coordinate reference system and datum of the data.
4. Whether the villages or village development committee areas within each ward are held by the Commission, and if so in what form.

**3. Form.** Any of: a GeoPackage, a shapefile set, or GeoJSON, in WGS 84 or the Arc 1950 Lo coordinate belts, whichever the Commission holds. If the Commission publishes the boundaries only as written descriptions and maps, we ask whether it can supply the coordinates behind them.

**4. How we will use it.** The council will hold a dated, read-only copy of the dataset, labelled with its source, the delimitation date and the version, and will state that source wherever the wards appear. The council will not alter the boundaries. If our reconciliation finds a place where the data and the written descriptions disagree, we will report it to the Commission and not correct it ourselves. The data contain no personal information.

**5. Terms.** Please tell us on what terms the council may hold the data, and whether it may show the ward boundaries on its public map. We will follow whatever acknowledgement the Commission asks us to give.

**6. Timing.** We would be grateful for a reply by [date, suggest 30 days]. A short acknowledgement and the name of the officer who will handle this would help us plan. If the Commission is not able to release GIS data, please tell us, and tell us where else the Commission would direct us.

**7. Contact.** [Name, post, telephone, email] will handle any queries.

Yours faithfully

[Name]
Chief Executive Officer
Vungu Rural District Council

Copy: [Provincial Administrator / District Administrator, if the council's practice is to copy them]

---

### Annex: the fields we would like per ward

| Field | Example form | Needed for |
|---|---|---|
| Ward number | 18 | Identifying the ward; stand numbers are unique within a ward |
| Ward name, if any | | Display |
| Ward polygon | Polygon, WGS 84 or Arc 1950 Lo | Placing every parcel in a ward |
| Constituency | | Reporting |
| District, province | | Reporting; combination authorities |
| Local authority | Vungu Rural District Council | Which authority sees which land |
| Delimitation date and version | 2022, finalised February 2023 | Provenance |
