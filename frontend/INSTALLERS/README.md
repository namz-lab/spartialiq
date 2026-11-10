# SpartialIQ Local — Windows installer

## Where is the `.exe`?

After a successful `npm run desktop:build`, copy it here and to your Desktop:

```powershell
cd frontend
npm run desktop:publish-installer
```

You should then see:

- `frontend/INSTALLERS/SpartialIQ_Local_*_x64-setup.exe`
- `%USERPROFILE%\Desktop\SpartialIQ_Local_*_x64-setup.exe`

A build from 2026-10-16 is also on the Desktop as `SpartialIQ_Local_1.0.0_x64-setup.exe`.

## Wireless updates (over the internet)

Installed apps check GitHub Releases on launch:

`https://github.com/Muna18madzinga/Manicipal-drums-frontend/releases/latest/download/latest.json`

When a newer version is published, the app shows **Update available → Install & restart**.

### One-time setup for auto-publish on commit

1. Open GitHub → **Manicipal-drums-frontend** → Settings → Secrets → Actions.
2. Add secret `TAURI_SIGNING_PRIVATE_KEY` = entire contents of `src-tauri/keys/spartialiq.key` (local only; never commit).
3. Push to `main` (desktop paths) or tag `v1.0.1` — workflow **Desktop release** builds Windows and publishes the Release + `latest.json`.

### Local signed build

```powershell
cd frontend
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw src-tauri\keys\spartialiq.key
npm run desktop:build
npm run desktop:publish-installer
```
