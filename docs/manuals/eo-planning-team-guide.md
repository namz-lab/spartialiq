# The EO Planning team: who does what in the two worked cases

**Status: DRAFT, 18 November 2026 (inspection bookings released by the cash office, migration 247). For the Executive Officer (Planning) to hand to the team, and for the council's review.**

This guide is for the people who work **under the EO Planning**: the **planning clerk**, the **planner**, the **building inspector**, and the specialists the planner consults (**environmental health officer**, **GIS officer**, **surveyor**). It also names the one step that now happens **at the cash office**, because every case passes through it.

It follows the two worked examples in the [EO Planning user manual](eo-planning-user-manual.md) (section 13) and says, step by step, **what each of you has to do** so that the EO can decide lawfully and on time. The EO's own steps are in the user manual and are only named here.

| Example | The case | How it ends |
|---|---|---|
| **1** | Mr B. Phiri, a two-bedroom extension on **Stand 1378**, Medium Density Residential. **TPD/VUN/2026/0911** | Approved on the Planning Committee's resolution |
| **2** | Mrs L. Hlongwane, part of her house into a tuck shop on **Stand 1379**, beside the Gweru road. **TPD/VUN/2026/0912** | Refused, with reasons, after an objection and a referral to the roads minister |

The people and stands are made up, as in the user manual. The screens, rules and messages are what the system does today.

## 1. Where each of you works

| You are | Your screens | Sign in, then |
|---|---|---|
| **Planning clerk** | The **Planning Clerk console**: Application receipt, Acknowledgements, Public notices, Correspondence, Fees, Refusals, Dispatch, Appeals, Deadlines | `/planning-clerk-portal` |
| **Planning clerk, planner** | The **EO console's** "Prepared for you" screens: Intake review, Due diligence, Public notice, Circulation; and **Committee** | `/eo-planner-portal` |
| **Planner** | The **planner console**: the statutory workflow (intake, due diligence, committee report, permit drafting, notices) and the map | `/planner` |
| **Building inspector** | The inspector's workspace: schedule and complete stage inspections | `/inspector-workspace` |
| **Environmental officer, GIS officer, surveyor** | Their own portals (`/env-officer-workspace`, `/gis-officer-portal`, `/surveyor`); a consultation the planner sends you appears there, and your answer goes back on the case | Your usual portal |
| **Cashier** (Finance, not the EO's team) | **Cash office → Issue Receipt** | `/finance/cashier` |

## 2. What changed on 18 November: fees are paid at the cash office

Planning fees now go into the council's books. That changes the clerk's counter:

- **The clerk does not take money and does not write receipts.** The clerk's old *Fee receipt register* is kept as history and takes no new entries.
- The applicant pays **at the cash office**. The cashier chooses the fee (for a TPD application, **Planning application fee, PLN-APP**), **finds the application by its reference**, and issues the council's receipt. That receipt **marks the application's fee paid** at once.
- A fee paid **online** shows the same way.
- The clerk sees the payment on **Application receipt** and on **Fees**. **The application cannot be acknowledged until its application fee is paid.**

The planning fees set up on the live system are:

| Fee | Income code | Notes |
|---|---|---|
| Planning (TPD) application fee | **PLN-APP** | Assessed per case |
| Plan scrutiny | **CASH-BPF** Building plan approval fee | Assessed per case |
| Inspection | **CASH-BIN** Building inspection fee (per stage) | Fixed by council |

**Not yet set up:** appeal, public notice and search fees. Until Finance marks an income code for each, the cashier cannot receipt them against an application. Ask Finance before the first one is needed.

## 3. Rules every one of you must know

| Rule | What it means for you |
|---|---|
| **The Act's clock starts when the acknowledgement letter is recorded as SENT** | Drafting the letter does not start it. The clerk must record the letter as **sent** in *Acknowledgements*. That sets the application's acknowledgement date and its deemed-refusal date (three months; four for a subdivision). |
| **Nothing decides itself** | Only the EO decides (or the committee, which the EO then signs). Nobody else records a decision. |
| **A "yes" to one of the Act's questions means a referral** | A State road, an aerodrome, a neighbouring authority, agricultural land: the referral must be recorded, and an approval waits a month or for the reply. The **planner may answer the questions and record the referral**, not only the EO. |
| **Every objection has three steps** | Recorded, considered with reasons, and **put to the applicant, who has 14 days** to comment. The clerk, planner or EO may record each step. |
| **Only the applicant can give more time, and only in writing** | The clerk files the applicant's letter and logs it. **The EO** records the extension, and must say where the letter is filed. |
| **The appeal window runs from notification** | The EO records the notification date on *Permits*. The clerk records how and when the permit or refusal letter was served (*Dispatch*). Record both the day it happens. |

## 4. Example 1: the extension on Stand 1378 (approved)

| # | Step | Who | Where | Done when |
|---|---|---|---|---|
| 1 | Mr Phiri lodges the application (citizen portal, or the clerk captures it with him). It stands at *pending payment*. | Applicant, clerk | Citizen portal / EO console → Intake review | The application exists with a reference |
| 2 | **He pays the application fee at the cash office.** The cashier picks *Planning application fee (PLN-APP)*, searches **TPD/VUN/2026/0911**, picks it, enters the amount and issues the receipt. | **Cashier** | Cash office → Issue Receipt | The receipt says *"Recorded against planning application TPD/VUN/2026/0911: its application fee is now paid."* The application is now *registered*. |
| 3 | The clerk opens the file, ticks what was in the envelope (title deed, five sets of plans, signatures), and checks the **Fee** card. | **Clerk** | Clerk console → Application receipt | The Fee card says *Application fee paid*, with the cash office's receipt number |
| 4 | The clerk enters the letter number and addressee and presses **Stamp receipt & draft acknowledgement**. This logs the correspondence and drafts the letter. | **Clerk** | Application receipt | Both steps show *Written* |
| 5 | **The clerk sends the letter and presses *Mark sent*.** This starts the clock. | **Clerk** | Clerk console → Acknowledgements | The case bar shows a deemed-refusal date (**16 February 2027**) instead of *Not acknowledged* |
| 6 | The planner circulates the plans to the departments that must comment (health, survey, engineering, fire…), marking any reply that must come back first as **blocking**. | **Planner** | EO console → Circulation | Each department has a task with a due date |
| 7 | Each department answers on the case. The environmental officer, GIS officer, surveyor and building inspector answer in their own portals; **a department with no account on the system (engineering, fire, the utilities) answers on paper, and the planner records its answer**. | Specialists; planner for the rest | Their portal → the consultation; EO console → Circulation | No blocking reply outstanding |
| 8 | The planner checks the site, the zone, the title and the plan. Answers **the Act's five questions** (all *No* here: inside the village, away from the Gweru road, the aerodrome and the boundary, no title conflict, no change of use). Notes that **public notice is not required**. | **Planner** | EO console → Due diligence; *Before you decide → The Act's questions* | *All answered*; public notice *Not required* |
| 9 | The planner writes the recommendation and the **committee report**. | **Planner** | Planner console → Committee report (also EO console → Committee reports) | The report is on the case |
| 10 | The planner or clerk sets up the **November sitting** with its quorum, **tables** the case, and records **attendance**. | **Planner or clerk** | EO console → Committee | *Quorate: 2 of 2 required* |
| 11 | The committee approves. **The clerk (or the EO) records the outcome and the resolution** (*"Approved: the extension complies with the plan for the zone."*). A planner cannot record an outcome. | **Clerk** (or EO) | EO console → Committee | The road shows *Committee resolved* |
| 12 | *The EO* records the direction check, reads the panel and **approves**, then issues the permit. | EO | Determination, Permits | *Decided*; the permit is *Issued* |
| 13 | **The clerk serves the permit** and records how. A posted permit needs its tracking number. | **Clerk** | Clerk console → Dispatch | The permit leaves the dispatch queue |
| 14 | *The EO* records the **notification date** on *Permits*. The one-month appeal window runs from it. | EO (clerk to tell the EO the date) | Permits | *Applicant notified* |
| 15 | When building starts, Mr Phiri books each **stage inspection** and pays the **inspection fee** (CASH-BIN, US$25 a stage) at the cash office against the same application, or online. The cashier enters **how many stages** he is paying for as the quantity. | Applicant, **cashier** | Cash office → Issue Receipt | Each paid stage's booking moves from *pending payment* to *waitlisted* at once (or the moment he books it, if he paid first). The fee shows on the clerk's *Fees* page. |
| 16 | The inspector schedules and completes each stage, with photos. | **Building inspector** | Inspector workspace | Each stage *completed* |

**What would stop the case, and whose job it is to clear it**

| The EO is told | Because | Who clears it |
|---|---|---|
| *Not acknowledged* | The letter was drafted but not recorded as sent | **Clerk**: record it as sent in *Acknowledgements* |
| *Blocking reply outstanding* | A department marked blocking has not answered | **Planner**: chase it, or record that it is not needed |
| *Statutory checks required* | One of the Act's questions is unanswered | **Planner**: answer it |
| *Committee resolution required* | No outcome is recorded | **Clerk**: record the committee's outcome |
| The Fee card says *not paid* and the stamp button is grey | No cash-office receipt names this application | **Clerk**: send the applicant to the cash office with the reference. **Cashier**: name the application on the receipt. |

## 5. Example 2: the tuck shop on Stand 1379 (refused)

The case was acknowledged on **12 September 2026**, so it is deemed refused on **12 December** unless the applicant gives more time. The steps up to acknowledgement are the same as Example 1, steps 1 to 5: **the fee is paid at the cash office first**.

| # | Step | Who | Where | Done when |
|---|---|---|---|---|
| 1 | The planner answers the Act's questions. The shop is **within 200 m of the Gweru road, a State road**, so that answer is **Yes**; the other four are No. | **Planner** | EO console → *Before you decide → The Act's questions* | The panel shows *Referral to the minister responsible for roads: not sent* |
| 2 | The referral is sent to the roads minister in the council's usual way, and **recorded**: press *Record the referral*. | **Planner** (or EO) | *Before you decide* / Referrals & switches → Referral log | The log shows it with its reply-by date (**7 December**) |
| 3 | If notice is required (a change of use that may be adverse), the clerk files the **newspaper certificate**, the **notices to abutting owners**, and the **site notice**; the planner verifies them. | **Clerk**, planner | Clerk console → Public notices; EO console → Public notice | Public notice *Complete* |
| 4 | Mr J. Khumalo hands in an **objection at the counter** (noise, traffic, no parking). **The clerk records it** on the case the same day and logs the letter in *Correspondence*. | **Clerk** | EO console → Public notice (objections); Clerk console → Correspondence | The objection is on the case |
| 5 | The objection is **considered, with reasons**: *Sustained: there is no parking, and the stand is on a bend.* Usually the EO; the planner may prepare the reasons. | EO (planner prepares) | EO console → Public notice | *Considered* |
| 6 | **The objection is put to Mrs Hlongwane**: press *Put to the applicant* and give her a copy. Her 14 days end on **30 November**. | **Clerk** or planner | EO console → Public notice | The date and the end of her 14 days are shown |
| 7 | If she replies, **the clerk records her comment** and logs her letter. If she does not, the 14 days running out is enough. | **Clerk** | Public notice; Correspondence | Comment recorded, or the 14 days have run |
| 8 | **Protect the clock.** The council asks her in writing for more time; she agrees to **16 December**. The clerk **logs her letter in Correspondence and files it**, and tells the EO where it is filed. | **Clerk** | Clerk console → Correspondence | The letter is logged, with its file reference |
| 9 | *The EO* records the extension with the new date and the letter's location. | EO | *Before you decide* | The deemed-refusal date shows **16 December 2026** |
| 10 | The planner writes the committee report: the objection, the road, the parking, the bend. | **Planner** | Committee report | The report is on the case |
| 11 | A **special sitting** is set up, the case tabled, attendance recorded. The committee **refuses**, and **the clerk records the outcome and the reasons**. | **Planner or clerk** (setting up); **clerk** (outcome) | EO console → Committee | The road shows *Committee resolved*; resolution *refused* |
| 12 | *The EO* refuses with written reasons, including the right of appeal to the Administrative Court within one month. | EO | Determination | *Refused* |
| 13 | **The clerk sends the refusal letter within seven calendar days** of the resolution, with the reasons, and records it. | **Clerk** | Clerk console → Refusals, then Dispatch | The refusal letter is recorded as sent |
| 14 | *The EO* records the **notification date**. Her appeal window runs from it. | EO (clerk to tell the EO the date) | Permits | *Applicant notified* |
| 15 | Good practice, not required by the workflow: the clerk writes to the **roads minister** and to **Mr Khumalo** with the outcome, and logs both letters. | **Clerk** | Correspondence | Both letters logged |
| 16 | If the minister replies later, **the planner records the reply** on the referral. Nothing is deleted. | **Planner** | Referral log | The referral shows the reply |
| 17 | If Mrs Hlongwane **appeals**, the clerk records it in the appeals register and checks it is within the month. | **Clerk** | Clerk console → Appeals | The appeal is on the register |

**The dates in this case, and who watches each**

| Date | What | Who watches it |
|---|---|---|
| 12 November | Last day to ask for an extension (a month before the Act's date) | Clerk (*Deadlines*), EO |
| 27 November | The committee should resolve by this date | Planner, clerk (to set up the sitting) |
| 30 November | Mrs Hlongwane's 14 days on the objection end | Clerk |
| 7 December | The roads minister's month ends | Planner |
| 12 December, then **16 December** | Deemed refused, then the extended date | Everyone; the case bar shows it |

## 6. One page per role

### Planning clerk

1. **Never take money.** Send the applicant to the cash office with the file reference. Check the **Fee** card on *Application receipt*; press *Check again* when they are back.
2. **Stamp the receipt and draft the acknowledgement**, then **send the letter and press *Mark sent*** in *Acknowledgements*. Until you do, the clock has not started, and the EO is told *Not acknowledged*.
3. **Record everything that comes over the counter on the case the same day**: objections (*Public notice*), the applicant's comment on an objection, the applicant's letter agreeing more time (*Correspondence*, with where it is filed).
4. **Public notice**: file the newspaper certificate, the notices to abutting owners and the site notice.
5. **Committee**: set up sittings, table cases, record attendance, and **record the outcome and resolution**.
6. **After the decision**: send refusal letters within **seven calendar days** (*Refusals*); serve permits and record how (*Dispatch*); tell the EO the date the applicant was told.
7. **Appeals**: record them in the appeals register.
8. Watch **Deadlines** every morning.

### Planner

1. **Circulate** the application to the departments that must comment, and mark blocking replies.
2. **Due diligence**: site, zone, title, plan. **Answer the Act's questions** in *Before you decide*.
3. **Record the referral** for every "yes" (State road, aerodrome, neighbouring authority, agricultural land), and the reply when it comes, or *No reply* when the month runs.
4. **Objections**: prepare the reasons for the EO; you may put an objection to the applicant.
5. **Write the recommendation and the committee report.**
6. Set up committee sittings and table cases with the clerk. **You cannot record a committee outcome**; the clerk or the EO does.

### Building inspector

1. Schedule each stage inspection once it is *waitlisted*: that means its fee is paid. Complete it with photos and findings.
2. The inspection fee (CASH-BIN) is paid at the cash office against the application, one stage per unit. Each paid stage releases the lowest booking waiting for payment, and the booking's history names the receipt. If a receipt is later cancelled, a booking it released goes back to *pending payment*, unless you have already scheduled it; then it is left as it is, with a note saying so.

### Environmental health officer, GIS officer, surveyor

1. A consultation from the planner appears in your portal. **Answer it on the case**, with your stance and any attachment, before its due date. (Departments with no account on the system, such as engineering, answer on paper and the planner records the answer.)
2. If the planner marked it **blocking**, the EO cannot decide until you answer.
3. If the EO **returns a case to you**, it comes back to your queue with the EO's note.

### Cashier (Finance)

1. For any planning fee, choose the fee, then **find the application by its reference** in the *Planning application* card. **Never** receipt a planning fee without naming the application.
2. Planning fees go on a receipt of their own.
3. If the card warns *Its application fee is already paid*, check with the clerk before taking it again.
4. For an **inspection fee**, enter the number of stages being paid for as the quantity: each stage releases one of the applicant's inspection bookings.

## 7. What the system does not do yet

So that nobody relies on something that is not there:

- **Appeal, public notice and search fees** have no planning income code yet (section 2).
- **There is no rates check before a decision**, although a section 109 rates clearance register exists. And Finance does not yet know the owners of most stands, including 1378 and 1379.
- **An approval does not change the rates.** After Example 1 the house is bigger, but its rateable value does not change by itself. Had Example 2 been approved, nothing would have moved the stand to a business category or asked for a trading licence.
- **The system does not know where a site is** (as in the user manual): the planner answers the Act's questions.

## 8. Where to get help

- **The workflow, a screen, or a message you do not understand**: the EO Planning, then the [EO Planning user manual](eo-planning-user-manual.md).
- **A fee, a receipt, or a payment that does not show**: the cash office supervisor or the revenue officer (*Planning Fees* page).
- **Signing in, or a screen that will not open**: the council's IT administrator.
