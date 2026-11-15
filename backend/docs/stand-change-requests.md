# Stand boundary changes: proposals and the survey import

A stand is a parcel of the register (`land.parcel`). Its boundary changes only under an approved Survey Section import (`land.parcel_guard`).
An officer who wants a change **proposes** it; the Survey Section decides it, surveys it, and the import of the approved plan **closes** it.

## The flow
1. **Draw** (GIS stand editor): a new stand cut from a stand, a split, a merge or a boundary correction becomes a draft proposal
   (`POST /api/parcel-change-requests`). The checks (`land.change_request_problems`) list what is wrong; a proposal with problems cannot be sent.
2. **Send** (`/submit`): opens an unassigned survey task for the Survey Section (`subdivision`, `new_stand`, `consolidation`, `boundary_correction`).
3. **Decide** (the Survey Section's roles, `GMS.importSurvey`): accept, return (to the drafter, with a reason) or reject (with a reason). The drafter never decides their own.
4. **Import** (`POST /api/gms/imports/general-plan` with `change_request_id`, or the choice on the import screen): the surveyed features are matched to the proposal's
   items; on commit, in one transaction, new parcels are created, a boundary to be revised is changed in place (history kept), the stands a split or merge replaces are
   retired (history, lineage, zone link and offer withdrawn), and the proposal and its survey task are closed. An import that names no proposal behaves as before.

## Kinds
| Kind | Parents | Items | On import |
|---|---|---|---|
| split | 1 | 2 or more new | the parent is retired; lineage `subdivision` parent to each child |
| merge | 2 or more | 1 new (their union) | the parents are retired; lineage `consolidation` each parent to the child |
| new | 1 | the parent revised, 1 or more new | the parent keeps its id with the smaller boundary; lineage `subdivision` to each new stand |
| reshape | 1 | the parent revised | the boundary changes in place; no lineage |

A parcel id is never reused. A stand that is reserved or allocated cannot be changed; a stand may be in one open proposal at a time.

## Tolerances (PROPOSALS for the Survey Section to confirm)
- Proposal checks (a drawing, not a survey): the items must agree with the parents' ground within 2% of its area; a reshape must overlap its parent by half; two items, or an item and
  another current **stand**, may share an edge but not overlap by more than 0.5 m².
- Import: a surveyed feature matches a proposal item at 80% boundary agreement (intersection over union, in the survey CRS), one feature per item; a second candidate within 5 points is
  an ambiguity; the surveyed boundaries must cover the parents within 1% (at least 0.5 m²); every other current stand is checked for overlap (the ordinary import checks only the council's own).
  The report always shows the measured agreement.

## Where it lives
Migrations 229 and 230 (with rollbacks); `src/routes/parcel-change-requests.js`; `src/services/gms/parcelChangeImport.js` (called by `parcelImport.js`);
`frontend/src/components/gis/StandChangeProposals.vue`, `StandsEditorSection.vue`, `SurveyImportSection.vue`; tests `test/parcel-change-requests.test.js`, `test/parcel-change-import.test.js`.

Out of scope for now: tracking the Surveyor-General's approval (`council_ops.sg_plan_submission` can be linked), automatic stand numbering, and a proposal spanning townships.
