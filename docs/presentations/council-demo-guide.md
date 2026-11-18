# Full Council demonstration: a step-by-step guide

**For the presenter. Use with the deck *Vungu Full Council - LAMIS planning showcase.pptx* (slides 26 and 27 are the on-screen summary of this guide; slide 22 shows the EO's team overview). A screenshot of every step is in [what each step looks like](council-demo-screenshots.md).**

The demonstration takes the councillors through the two worked cases from the [EO Planning user manual](../manuals/eo-planning-user-manual.md) and the [team guide](../manuals/eo-planning-team-guide.md), signing in as each member of the team in turn: cashier, clerk, planner, the Civil Engineering Technician of Roads and Works, EO, revenue officer. It takes about **18 minutes** (9 per case).

## 1. Before the meeting

### Run it on the demonstration copy, never on the live system

Everything you do in the demonstration is saved. The live system is the council's record, so **do not demonstrate on it**: a receipt, a committee resolution or a refusal made for the councillors would sit in the council's books and registers.

Run the demonstration on the **local demonstration database** (the Docker copy on the presenter's laptop), with its own backend and frontend:

```bash
# in C:\lamis\backend: the backend on port 3011, on the LOCAL database only
DATABASE_URL=<the local database address from backend/.env.local.bak> PORT=3011 NODE_ENV=development node server.js
```

```bash
# in C:\lamis\frontend: the frontend on port 5175, talking to that backend
VITE_BACKEND_PROXY=http://localhost:3011 npx vite --port 5175 --strictPort
```

Open **http://localhost:5175** in the browser. The sign-in page there shows the **demonstration accounts** (Cashier, Clerk, Planner, EO Planning, Civil tech, Revenue, Accountant). Their password is in `backend/scripts/seed-finance-cash-bank-demo.js`; do not put it on a slide.

### The day before

| # | Do | Check |
|---|---|---|
| 1 | Start the demonstration backend and frontend (above) | http://localhost:5175 opens; the demonstration accounts are listed |
| 2 | Choose **two applications** in the demonstration database to play the two cases, one for the extension and one for the tuck shop. Write down their references or stand numbers. Use applications that are *pending payment* or *registered*, and not yet acknowledged. | The cashier's search finds both |
| 3 | Make sure the cash office has a **planning application fee** code (PLN-APP) and an **inspection** fee code (CASH-BIN) marked as planning fees: Cash Office → Set-up → Income codes, *Planning fee* column. | Both show "· planning fee" on Issue Receipt |
| 4 | As the **demonstration cashier**, open a cash session **on the day of the meeting** (a till left open from an earlier day must be cashed up first). | Issue Receipt has no "earlier business day" warning |
| 5 | Set up a **committee sitting** for the meeting date with its members, so the clerk only has to record attendance and the outcome. | The sitting appears under Committee |
| 6 | **Rehearse** both cases end to end once, then reset or choose two fresh applications for the meeting itself. | Every step below works |
| 7 | Open one browser window per role, or sign out and in between roles. | You can switch role in under 15 seconds |

**Fallback:** if the network or the laptop fails, present slides 7 to 15 instead. They show the same screens.

## 2. Case 1: the extension, approved (about 8 minutes)

*The story: Mr B. Phiri, a two-bedroom extension on Stand 1378, Medium Density Residential. Unopposed; no public notice needed; the committee approves.*

| # | Sign in as | Where | Do | The councillors should see | Say |
|---|---|---|---|---|---|
| 1 | **Cashier** | Cash office → **Issue Receipt** | Choose **Planning application fee · planning fee**. In the *Planning application* card that appears, search the application's reference or stand and pick it. Enter the amount; Cash; **Issue Receipt**. | *"Receipt RC-… issued. Recorded against planning application …: its application fee is now paid."* | "The fee is taken by the cashier, not the planning clerk, and it goes straight into the council's books." |
| 2 | **Clerk** | Clerk console → **Application receipt** (open the file) | Show the **Fee** card. | *Application fee paid*, with the cash office's receipt number | "The clerk can see it is paid, and could not go on if it were not." |
| 3 | Clerk | Application receipt | Tick the envelope checklist; enter the letter number and addressee; **Stamp receipt & draft acknowledgement**. | Each step reads *Written* | |
| 4 | Clerk | **Acknowledgements** | On the new letter press **Mark sent**. | The case now has a deemed-refusal date three months on, and is *In circulation* | "This is the moment the Act's clock starts. Drafting the letter does not start it. The same moment, the case goes to the departments that must comment on it." |
| 5 | **Planner** | EO console → **Circulation** | Show the circulation the acknowledgement made: **Roads and Works** (blocking) and Environmental health, each with its reply date and the reason it was asked. Nothing to press. | *1 blocking referral outstanding: Roads and Works* | "Nobody chose these departments. The council's circulation rules did: every application goes to Roads and Works, an extension also to Environmental health. None can be forgotten, and the EO cannot decide while a blocking reply is out." |
| 5b | **Civil tech** (Roads and Works) | Roads and Works → **Engineering referrals** | **Reply** on Mr Phiri's case: the five heads of the infrastructure-cost test all **No**; **No objection**; note *roof water to a soakaway; clear of the road reserve*; **Send the reply**. | The referral moves to *Answered*; the blocking referral is no longer outstanding | "Before the council approves, its Roads and Works department says whether the development would cost the council anything for roads, parking, drains, sewers or water. That is section 26(5) of the Act. Here it would not." |
| 6 | Planner | **Determination → Before you decide → The Act's questions** | Answer all five **No**; **Save answers**. | *All answered* | "Each question is one the Act asks: a State road, an aerodrome, a neighbouring council…" |
| 7 | **Clerk** | EO console → **Committee** | Open the sitting; record **attendance**; record the outcome **Approved** with the resolution. | *Quorate*; the case's road moves to *Committee resolved* | "No quorum, no resolution: the system will not record one." |
| 8 | **EO Planning** | **Determination** | Point at the **Roads and Works assessment** card (*no cost to the council*). Press *I have checked: none applies* (directions); write the decision notes; **Approve**. | *Decided*; *Approved* | "The decision rested on the committee's resolution and the departments' findings, and the record says so." |
| 9 | EO | **Permits** | Show the issued permit, locked; record the **notification** date. | *Issued: this permit is a fixed record* | "The appeal month runs from the day the applicant is told." |
| 10 | **Revenue officer** | Revenue → **Planning Fees** | Show the receipt from step 1. | The fee, *Awaiting posting*: it reaches the ledger when the cash-up is verified | "Every planning fee is visible to Finance, by application." |

**Show the team at a glance:** when you first sign in as the EO (before step 8), the console opens on **At a glance**: one tile per desk under the EO. Point at the figures in amber and red, open the **Planners** tile to show the desk in full, then go to **Determination**. Say: "This is the first thing the EO sees each morning: where the team's work is waiting, read from the registers." (This needs the demonstration copy to be running the latest version of the system; if the tiles say they could not be read, show slide 22 instead.)

**Optional, if time allows:** as the cashier, take an **inspection fee** (CASH-BIN, quantity = number of stages) for the same application, and show the applicant's stage booking move from *pending payment* to *waitlisted*.

## 3. Case 2: the tuck shop, refused (about 8 minutes)

*The story: Mrs L. Hlongwane, part of her house into a tuck shop on Stand 1379, beside the Gweru road. A neighbour objects; the committee refuses.*

Before you start this case, take its application fee and acknowledge it as in Case 1, steps 1 to 4 (or do it before the meeting, to save time). The acknowledgement circulates it. By step 3, Environmental health and Fire have replied *no objection*; on the demonstration copy the capture script records their replies.

| # | Sign in as | Where | Do | The councillors should see | Say |
|---|---|---|---|---|---|
| 1 | **Planner** | Determination → **Before you decide → The Act's questions** | Answer **Yes** to *within 200 m of the centre line of a State road*; No to the rest; **Save answers**. | In red: *Referral to the minister responsible for roads: not sent*, with a button | "A 'yes' is an instruction to refer." |
| 2 | Planner | Before you decide | Press **Record the referral**. | *Awaiting reply (they have one month)*; the referral log shows the reply-by date | "An approval would now wait for the minister. A refusal does not." |
| 2b | Planner | EO console → **Circulation** | Show the circulation the acknowledgement made: **Roads and Works** and **Environmental health** (both blocking) and Fire. | *2 blocking referrals outstanding* | "A change of use goes to more departments than an extension: a shop brings customers and their cars, and may sell food. The rules know that." |
| 2c | **Civil tech** (Roads and Works) | Roads and Works → **Engineering referrals** | Show the tag *Near a State road: the roads minister is consulted too*. **Reply**: cost heads all **No**; **Objection**, with reasons: *no room for customer parking; customers would stop on the shoulder of the Gweru road, on a bend where drivers cannot see far ahead; access to the State road is the minister's*; **Send the reply**. | *Answered*: Objection | "The council is not the road authority for the Gweru road, so it does not approve the access: the minister does. What the council judges is the parking and the danger at the bend." |
| 3 | **Clerk** | EO console → **Public notice** | Record an **objection** from the neighbour: noise, traffic, no parking. | The objection on the case | "Handed in at the counter, recorded the same day." |
| 4 | **EO Planning** | Public notice | **Consider** it, with reasons: *Sustained: there is no parking, and the stand is on a bend. Roads and Works objects on the same grounds.* | *Considered*; next step: put it to the applicant | "The neighbour's objection is not the only ground: the council's own engineers say the same." |
| 5 | **Clerk** | Public notice | Press **Put to the applicant**. | The date, and the end of her **14 days** | "Without this step a refusal can be overturned on appeal." |
| 6 | **EO Planning** | Before you decide | **Record the applicant's written extension**: a new date, and where her letter is filed. | The deemed-refusal date moves | "Only the applicant can give more time, and only in writing." |
| 7 | **Clerk** | Committee | Record the committee's outcome **Refused**, with reasons. | *Committee resolved: refused* | |
| 8 | **EO Planning** | Determination | Point at the **Roads and Works assessment** card (*Objection*). Write the reasons, citing Roads and Works' objection and the sustained objection, with her right of appeal within one month; **Refuse**. | *Refused*; the road stands at *Decided* | "A refusal must have reasons and a matching resolution. Reasons that rest on the council's own engineering finding hold up on appeal to the Administrative Court." |
| 9 | **Clerk** | Clerk console → **Refusals**, then **Dispatch** | Show the refusal letter due within seven calendar days, and record how it was sent. | The letter in the register | |

**Show a safeguard working:** before step 7, as the EO, press *I have checked: none applies* (the direction check), then try **Approve**. The system checks its gates in order and stops at the first that fails: here it refuses with *Statutory referral pending*, because the roads minister has not replied and the month has not run. The objection and the missing committee resolution would each stop it too; so would a Roads and Works referral still unanswered, had step 2c not been done. Say: "The system will not let the council make an unlawful decision, and it says exactly why."

## 4. After the demonstration

- Close the demonstration windows, then present slide 28 (*What council is asked to decide*).
- Stop the demonstration backend and frontend after the meeting.
- Nothing from the demonstration is in the live system.

## 5. If something goes wrong

| What happens | Do |
|---|---|
| Sign-in fails | Use the demonstration account buttons on http://localhost:5175, not the live address |
| Issue Receipt says the till is from an earlier day | Sign in as the cashier, cash up, then open a new session for today |
| The cashier's search finds nothing | Search by stand number or the applicant's name; the reference may be empty on that application |
| The clerk's Fee card says *not paid* after the receipt | Press **Check again** on the card |
| A screen is slow | Talk through the matching slide while it loads |
| Anything else | Move to the screenshots on slides 7 to 15 and carry on |
