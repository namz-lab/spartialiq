# Demonstrating identity verification to the Registrar-General's Office

**For the presenter.** This is a prototype. Its population register holds **fictional people**, and it runs only on the demonstration copy (the local database), never on the live system.

## What it shows

LAMIS (the council's land and planning management system) keeps one register of the people the council deals with: applicants, objectors, payers and account holders. Each person has a level of assurance:

| Level | Meaning | How it is reached |
|---|---|---|
| 0 Recorded | A name as given | Any desk registers the person, or the person signs up online |
| 1 Identity verified | The identity document was checked | A copy uploaded online and approved by an officer, or the original seen |
| 2 Resident or ratepayer | Identity verified, and lives or owns property in the district | A title deed, rates statement, lodger's permit, offer letter, or a letter from the councillor, headman or chief |
| 3 Original sighted | The planning clerk handled the original document | At the counter only |

The council can't confirm on its own that an ID number is genuine. That is what the Registrar-General's service would do. The prototype demonstrates the design the council would ask for:

- **Verify, do not disclose.** The council sends a document number and the particulars it holds (surname, first names, date of birth). The service says whether each particular **agrees**, and gives the document's status: valid, expired, cancelled, reported lost or stolen, or holder deceased. It never returns the register's own data. Asking about an ID number does not reveal whose it is.
- **Each client has its own key, and every question is logged on the Registrar-General's side** with who asked, when, why and the answer. The Registrar-General can audit how the register is used.
- **A refusal is binding.** If the service says a document is not the person's, or not valid, the council's system will not let that document verify anyone.

## Before the meeting

1. Run the demonstration backend and frontend as in the [council demo guide](council-demo-guide.md#1-before-the-meeting): ports 3011 and 5175, on the local database.
2. Sign in with the demonstration **Clerk** account. The **CEO** and **IT admin** demonstration accounts can open the Registrar-General console too.

## The demonstration (about 10 minutes)

| # | Where | Do | Say |
|---|---|---|---|
| 1 | http://localhost:5175/mock/registrar-general | Show **How a client asks**: the question, the answer. | "This is all the council would ever receive: agrees or does not agree, and whether the document is valid. Never a name, a date or a photograph." |
| 2 | Same page, **Try it** | Use the case for Mr Phiri. **Ask**. | *Everything sent agrees*, with a reference. |
| 3 | Try it | Use *Someone else's ID*: Mr Khumalo's ID number sent with the surname Phiri. | "Someone using another person's ID is stopped here." |
| 4 | Try it | Use the deceased holder, then the stolen passport. | "A dead man's ID or a stolen passport cannot open an account with the council." |
| 5 | Same page, **Who has asked** | Show the log: client, purpose, answer, with masked numbers. | "The Registrar-General sees every use of the register, and why." |
| 6 | Clerk console → **Register of persons** | Search *Bernard Phiri*, **Register a new person**: national ID *63-2876543 X 27*, date of birth *12 April 1979*, tick *I have the original identity document in my hands*; **Register**. | The record shows **Level 3 · Original sighted** and *Registrar-General: everything sent agrees*. "The check happens as the clerk registers him, before anything is written." |
| 7 | Same record, **Confirm at the counter** | Proof of residence: *Rates or utility statement*; reference; **Record residence**. | The **Resident** mark appears; the ladder shows every step with its date and evidence. |
| 8 | Register of persons | Register *Tendai Moyo* with ID *63-2222333 B 27* and the original ticked. | *Registered, but not as verified: the Registrar-General records the holder as deceased.* The person stays at level 0. |

Afterwards, delete the people registered in steps 6 and 8 from the demonstration database, or use the demonstration copy's reset.

## What the council would need from the Registrar-General

- A verification endpoint answering as above, reached over the government network or the internet, with mutual TLS or an issued key.
- A client key for Vungu RDC, and an agreement on the purposes for which the council may ask (registration, verification at the counter, online verification).
- The audit log on the Registrar-General's side, and a way for the council to read back its own answers by reference.

Connecting the real service changes configuration only: `RG_MODE=http`, `RG_API_URL` and `RG_CLIENT_KEY` (backend `src/services/registrarGeneral.js`). The council's screens and records stay as they are.
