# Desktop update signing keys

- `spartialiq.key.pub` — public key (committed; embedded in the app).
- `spartialiq.key` — **private**; never commit. Store as GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.

Generate a replacement pair (only if the private key is lost — existing installs cannot verify new updates):

```bash
npx tauri signer generate -w src-tauri/keys/spartialiq.key --ci
```
