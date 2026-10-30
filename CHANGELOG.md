# Changelog

All notable changes to the vendored `sdk/` folder. The updater prints the sections between your installed version and the one it installs.

## [0.1.0] - 2026-10-29

First cut, extracted from the mini-programs in production (ticketing, transit, eSIM, tax).

- `miniSDK.user()` — the host user, msisdn normalised to nine digits, name from the parts that exist; never invents an identity.
- `miniSDK.login()` — the one-time code for the auth broker.
- `miniSDK.pay(order, {onIdentical})` — Orange Money merchant payment from a plain order: the SDK builds the host request (nested `payload` block, ONE correlation key — `serviceId` or `idService`, never both), handles the identical-transaction prompt (one retry, `caction: '1'` as a string), validates before anything leaves, reads the txnid whatever the host named it, flags `uncertain` on timeouts and unnamed failures. `result.sent` is what went on the wire.
- `miniSDK.contacts()` — the contact book in one shape, called without a `data` key.
- `miniSDK.deeplink({launch})` — the host's one-shot params merged over the launch query, slash form and glued keys expanded, `maskParams` for logs.
- `miniSDK.scan({cameraOnly})` — `wx.scanCode` with failures told apart, album fallback flagged.
- `miniSDK.screen.protect(on)` — capture mask on both platforms.
- `HostError` with stable codes: `UNAVAILABLE`, `TIMEOUT`, `CANCELLED`, `DENIED`, `REFUSED`, `DECLINED`, `INVALID`, `HOST_ERROR`.
- `configure({simulate, fixtures, log, confirm, timeoutMs})` and `sdk/mock/host.js` for DevTools.
- `npx @sonatel-os/maxit-mini-sdk update` — manifest-verified vendoring, no node_modules in the app. What installs is a single **obfuscated** `sdk/index.js` (the whole graph bundled and mangled), so a partner cannot read or patch the SDK in place; the SHA-256 manifest lets a tampered copy be detected. The readable source stays in the repo under `sdk/`.
