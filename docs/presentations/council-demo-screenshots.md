# Full Council demonstration: what each step looks like

**For the development team running the demonstration. A screenshot for every step of the [demonstration guide](council-demo-guide.md), taken on the demonstration copy by working both cases through the real screens.**

Use it to rehearse, and to check on the day that each screen looks the way it should. The steps, who signs in and what to say are in the demonstration guide; this document shows the screen at each step.

## Before you start

**No new accounts are needed.** The two applicants, Mr B. Phiri and Mrs L. Hlongwane, never sign in: every step is done by a council officer. The officers' demonstration accounts (cashier, clerk, planner, EO Planning, revenue officer, and the cash supervisor for the cash-up) already exist on the demonstration copy. What each case needs is its **application** in the demonstration database, pending payment and not yet acknowledged. The capture script creates both.

**Run it on the demonstration copy only**: the backend on port 3011 over the local database, the frontend on 5175, as section 1 of the demonstration guide says.

**One step is not in the system yet.** When the clerk records the acknowledgement as sent, the case gets its acknowledgement date and its three-month clock, but its status stays *Registered*, and no screen moves it on. The EO's approval in Case 1, step 8 is then refused: *"A case in 'registered' cannot move to 'approved'."* Until that is fixed, move each case to *Under review* after step 4 (the capture script does it through the status route, as the planner). Do this before the meeting, or the approval will fail in front of the councillors.

**To take the screenshots again** (after a change to the screens, or for a fresh rehearsal):

```bash
node docs/manuals/tools/capture-demo-steps.js
```

It cashes up a till left open from an earlier day, opens today's, lodges the two applications, works both cases and saves the screenshots in `docs/presentations/demo-steps/`. An earlier rehearsal's applications are withdrawn and marked *(rehearsal)*, so the cashier's search finds only the new ones. Everything it creates is listed in `docs/manuals/tools/demo-created.json`.

## Opening: the EO's first screen

**EO Planning** signs in: the console opens on *At a glance*, one tile per desk under the EO.

![The EO console's first screen](demo-steps/c0-eo-at-a-glance.png)

## Case 1: the extension, approved

*Mr B. Phiri, a two-bedroom extension on Stand 1378. TPD/VUN/2026/0911.*

### Step 1. Cashier: the application fee at the cash office

**Cash office → Issue Receipt.** Choose *Planning application fee · planning fee*, find the application by its reference, enter the amount, Cash.

![The receipt form, filled in](demo-steps/c1-01-cashier-receipt-form.png)

**Issue Receipt.** The councillors should see: *"Recorded against planning application …: its application fee is now paid."*

![The receipt issued](demo-steps/c1-01-cashier-receipt.png)

### Step 2. Clerk: the fee is paid

**Clerk console → Application receipt**, with the file open. The **Fee** card shows *Application fee paid* and the cash office's receipt number.

![The clerk sees the fee paid](demo-steps/c1-02-clerk-fee-paid.png)

### Step 3. Clerk: stamp the receipt and draft the acknowledgement

Tick the envelope checklist, check the letter number and addressee, **Stamp receipt & draft acknowledgement**.

![Stamped, with the letter drafted](demo-steps/c1-03-clerk-stamped.png)

### Step 4. Clerk: the acknowledgement goes out

**Acknowledgements → Mark sent**: when it went and how.

![Mark the letter as sent](demo-steps/c1-04-clerk-ack-sent-form.png)

**Record as sent.** The letter shows *Sent*, and the three-month clock starts.

![The letter sent; the clock running](demo-steps/c1-04-clerk-ack-sent.png)

*Then move the case to Under review (see "One step is not in the system yet" above).*

### Step 5. Planner: circulation to the departments

**EO console → Circulation.** The departmental tasks with their due dates, one marked **blocking**.

![Circulation](demo-steps/c1-05-planner-circulation.png)

### Step 6. Planner: the Act's questions

**Determination → Before you decide → The Act's questions.** All five answered *No*; **Save answers**.

![The Act's questions answered](demo-steps/c1-06-planner-act-questions.png)

### Step 7. Clerk: the committee

**EO console → Committee.** The sitting, attendance (quorate), and the outcome *Approved* with the resolution.

![The committee resolved](demo-steps/c1-07-clerk-committee.png)

### Step 8. EO Planning: the determination

**Determination.** The direction check done, the plan basis answered, the decision notes written.

![The determination, ready](demo-steps/c1-08-eo-determination-form.png)

**Approve.** The case reads *Approved*; the road moves to *Decided*.

![Approved](demo-steps/c1-08-eo-approved.png)

### Step 9. EO: the permit and the notification date

**Permits.** The issued permit, locked as a fixed record, and the date the applicant was told.

![The permit](demo-steps/c1-09-eo-permit-issued.png)

### Step 10. Revenue officer: the fee in Finance

**Revenue → Planning Fees.** The fee from step 1, *Awaiting posting*: it reaches the ledger when the cash-up is verified.

![Planning fees in Finance](demo-steps/c1-10-revenue-planning-fees.png)

## Case 2: the tuck shop, refused

*Mrs L. Hlongwane, part of her house into a tuck shop on Stand 1379, beside the Gweru road. TPD/VUN/2026/0912. Its fee and acknowledgement are done before the meeting, as in Case 1, steps 1 to 4.*

### Step 1. Planner: a "yes" about a State road

**Determination → Before you decide → The Act's questions.** *Yes* to *within 200 m of the centre line of a State road*, No to the rest. In red: the referral to the roads minister, not sent.

![A State road: referral needed](demo-steps/c2-01-planner-state-road.png)

### Step 2. Planner: the referral is recorded

**Record the referral.** *Awaiting reply (they have one month)*.

![The referral recorded](demo-steps/c2-02-planner-referral-sent.png)

### Step 3. Clerk: an objection at the counter

**EO console → Public notice.** The neighbour's objection on the case: noise, traffic, no parking.

![The objection recorded](demo-steps/c2-03-clerk-objection.png)

### Step 4. EO Planning: the objection considered

**Public notice.** *Sustained: there is no parking, and the stand is on a bend.* Next: put it to the applicant.

![The objection considered](demo-steps/c2-04-eo-objection-considered.png)

### Step 5. Clerk: put to the applicant

**Put to the applicant.** The date, and the end of her 14 days to reply.

![Put to the applicant](demo-steps/c2-05-clerk-put-to-applicant.png)

### Step 6. EO Planning: the applicant's written extension

**Before you decide → Record the applicant's written extension**: the new date and where her letter is filed. The deemed-refusal date moves.

![The extension recorded](demo-steps/c2-06-eo-extension.png)

**A safeguard working.** With the referral unanswered, an approval is not possible: *Before you decide* shows the gate that stops it, and **Approve** stays unavailable.

![An approval stopped by the referral](demo-steps/c2-06b-safeguard-approval-refused.png)

### Step 7. Clerk: the committee refuses

**Committee.** The outcome *Refused*, with reasons.

![The committee refused](demo-steps/c2-07-clerk-committee-refused.png)

### Step 8. EO Planning: refused, with reasons

**Determination.** The reasons, including her right of appeal within one month; **Refuse**. The case reads *Refused*.

![Refused](demo-steps/c2-08-eo-refused.png)

### Step 9. Clerk: the refusal letter

**Clerk console → Refusal letters.** The letter due within seven days, then **Dispatch** to record how it was sent.

![The refusal letter](demo-steps/c2-09-clerk-refusal-letter.png)
