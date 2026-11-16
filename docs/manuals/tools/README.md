# How the manual's figures are made

The EO Planning user manual (`../eo-planning-user-manual.md`) has two diagrams and nineteen screenshots in `../images/`. These scripts regenerate them, so the manual can be refreshed when the screens change. They need the dev servers running (backend on port 3000, front end on 5174) and Docker's `lamis-db`.

| Script | What it does |
|---|---|
| `make-figs.js` | Draws Figure 1 (the road of an application) and Figure 2 (the gates before an approval) as SVG and renders them to PNG. |
| `capture.js` | Signs in as the demo planner and EO, works the two examples of section 13 through the real screens, and saves a screenshot at each step. It records what it creates in `created.json`. |
| `cleanup.js` | Deletes everything `capture.js` created (the two cases, the meetings), using `created.json`. **Run it after every capture.** |

```bash
node make-figs.js
node capture.js && node cleanup.js
```

They use the demo accounts of the development build only, and Playwright's Chromium (`npx playwright install chromium` if it is missing). The paths in them are for this checkout (`C:/lamis`). After changing the images, rebuild the Word copy of the manual.
