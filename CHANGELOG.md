# Changelog

All notable changes to the vendored `sdk/` folder. The updater prints the sections between your installed version and the one it installs.

## [0.1.3] - 2026-11-02

- **Deep link: the host's late copy of a link is not a second tap.** On a cold start the launch options deliver the tap while the host bridge is not ready yet, so the first `getDeeplinkParams` call fails and the host KEEPS its copy; the next call that reaches it (a resume, the return from a payment overlay) handed the same link over again and 0.1.2 — « anything the host answers is a fresh tap » — routed it a second time (the order page mounted twice). The SDK now swallows the host's first delivery of a set the launch options already handed out, once; the same words from the host a second time are a genuine re-tap and still route.

## [0.1.2] - 2026-10-30

- **Deep link: a repeated tap of the same link routes again.** The host's `getDeeplinkParams` is one-shot on its side, so anything it answers is a fresh tap; `deeplink({ once })` now de-duplicates only the launch options that TCMPP repeats on a resume. Before, tapping the same link twice while the mini-program was alive was swallowed as a resume.
- `miniSDK.pay`: the correlation key is named **`idService` by default**. The host's request model (samea-mobile `MiniAppPayReq.fromMap`) reads `idService` ONLY and forwards it as the Orange Money debit's `serviceId` — the exact-match key a verification oracle needs; a top-level `serviceId` was dropped by the host, so an app trusting the old default lost the key on every debit. A bare `orderId`, or both spellings with one value, now go out as `idService`; an explicit `serviceId` alone is kept as given. HOST_CONTRACT and README updated.

## [0.1.1] - 2026-10-30

- `miniSDK.deeplink({launch})` reads the host's NEW door: since 2026-10-30 the host starts the mini-program with TCMPP `MiniStartOptions.params`, which the runtime hands to `onLaunch`/`onShow` as `options.referrerInfo.extraData` / `options.extendData` — pass the whole options object. Reads `path?…` → `query` → `extraData` → `extendData`, the later winning.
- The issued link now carries TWO question marks (`…/miniapps/<appId>??msisdn=…`): keys are stripped of a stray `?`/`&`/`/` — `?msisdn` never reaches your router. A JSON object serialised in the params string is read as a map.
- `miniSDK.deeplink({launch})` is now **one-shot by default**: it fingerprints the resolved params and answers `null` for a repeat, so calling it on every `App.onShow` no longer re-routes on an app switch (the runtime repeats the same launch options on every resume). Pass `{once: false}` to always resolve; `miniSDK.resetDeeplink()` clears the memory (e.g. a fresh cold launch). This moves the dedup that each app carried into the SDK.
- `mockLaunchOptions(params, {door})` in `sdk/mock/host.js`: builds runtime launch/show options that carry params through the new door (`referrerInfo.extraData`, `extendData`), the compile-condition `query`, or the `??` path form — so DevTools and tests can rehearse the launch-options door, which is not a `wx` call the mock host could fake.
- HOST_CONTRACT: the `getDeeplinkParams` section documents the new door and that the SDK now one-shots the resume.

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
