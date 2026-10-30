<p align="center">
  <h1 align="center">📱 @sonatel-os/maxit-mini-sdk</h1>
</p>

<p align="center">
  <strong>The Max It host, as one object.</strong><br/>
  Everything a mini-program does through <code>wx.invokeNativePlugin</code> — identity, login, Orange Money payment, contacts, deep links, screen protection — with plain results, typed errors, and every host quirk handled once instead of in every app.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/install-npx%20update-FF7900?style=for-the-badge&logo=npm&logoColor=white" alt="Install: npx update" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-3C873A?style=for-the-badge&logo=node.js&logoColor=white" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/module-ESM-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="ESM" />
  <img src="https://img.shields.io/badge/tests-77%20vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white" alt="77 tests · vitest" />
  <img src="https://img.shields.io/badge/lint-eslint%209-4B32C3?style=for-the-badge&logo=eslint&logoColor=white" alt="ESLint 9" />
  <img src="https://img.shields.io/badge/ships-obfuscated-black?style=for-the-badge&logo=gnuprivacyguard&logoColor=white" alt="Ships obfuscated" />
</p>

<p align="center">
  <code>npx @sonatel-os/maxit-mini-sdk update</code>
</p>

---

## 💡 Why this SDK exists

A Max It mini-program talks to its host through `wx.invokeNativePlugin`. That channel is **full of traps**, and every app on the fleet re-learned them the hard way:

- The host answers a **failure through the success callback** — a `{ result: 'fail' }` envelope, not an error.
- A second identical payment is refused for ~15 minutes, and the **txnid you need to retry is hidden on that failure**. The retry only works with `caction: '1'` — the string, because a number fails the host's type check.
- `contactList` returns **empty when you hand it a `data` field**. Pass nothing.
- The msisdn arrives as the subscriber typed it: `+221 77…`, `00221…`, with spaces.
- The deep-link params are **one-shot** — read them once and the host forgets.
- `block_screen` is **host-wide** and does not lift itself when your page closes.

**This SDK exists so you never touch any of that.** You get one frozen object, methods that read like sentences, predictable shapes, and typed errors you branch on by `code` — never by parsing a French string again.

```javascript
import { miniSDK } from './sdk/index.js';

const user = await miniSDK.user(); // { msisdn: '770000001', fullName: 'Fatou Sarr', … }
```

One import. The whole host. Zero regex. 🪄

---

## 📦 Install into a mini-program

```bash
npx @sonatel-os/maxit-mini-sdk update
```

That writes a **single, obfuscated `sdk/index.js`** into your project — verified against a per-file SHA-256 manifest — and **nothing else**: no `node_modules`, no build step, no dependency in your `package.json`. TCMPP packs the folder as it packs your pages. Run the same command any time to update; it prints what changed.

```bash
npx @sonatel-os/maxit-mini-sdk update 0.2.0      # a specific version
npx @sonatel-os/maxit-mini-sdk update --dir utils/sdk   # a different folder
npx @sonatel-os/maxit-mini-sdk check             # exit 2 when an update exists
npx @sonatel-os/maxit-mini-sdk version           # what is installed here
```

> 🔒 **What lands in your app is the published build, not the readable source.** It runs identically but is not meant to be read or patched in place — a fix belongs in this repo so every app gets it, and the manifest's hash proves the file was not tampered with. The readable source lives here under [`sdk/`](./sdk).

Then, in your `app.js`:

```javascript
import { miniSDK } from './sdk/index.js';

App({
  onLaunch() {
    miniSDK.configure({
      simulate: __DEV__ && SIMULATE, // fixtures in DevTools, the real host on device
      log: (level, api, message, ctx) => logger[level](`[sdk:${api}] ${message}`, ctx),
    });
  },
});
```

---

## 🌍 The big picture

```
                     your mini-program
                            │
          import { miniSDK } from './sdk/index.js'
                            │
      ┌─────────────────────▼──────────────────────┐
      │                  miniSDK                    │
      │   user · login · pay · contacts · deeplink  │   ← clean results
      │          · scan · screen · supports         │   ← typed HostError
      └──────────┬───────────────────────┬──────────┘
                 │                        │
        wx.invokeNativePlugin      wx.scanCode / setVisualEffectOnCapture
                 │
      ┌──────────▼──────────────────────────────────┐
      │              Max It host (Sonatel)           │
      │  userInfos · login · merchantPay · contactList│
      │        · block_screen · getDeeplinkParams     │
      └───────────────────────────────────────────────┘
```

> 🛂 **You never thread tokens or parse envelopes.** Every method resolves plain data or rejects a `HostError` with a stable `code`, a user-safe French `message`, the host's `raw` payload, and — on a payment — an `uncertain` flag when the money may have moved.

---

## ⚡ 30-second tour

```javascript
// Who is using the app? (the host already authenticated them)
const { msisdn, fullName } = await miniSDK.user();

// A one-time code for your auth broker
const code = await miniSDK.login();

// Take a payment — the SDK builds the host request and handles the duplicate prompt
const { txnid } = await miniSDK.pay({
  amount: 2000,
  receiver: 467652, // the merchant code
  receiverName: 'Ma Boutique',
  orderId: 'ORD-1', // your order id
  description: 'Pass journée',
});

// The contact book, in one shape
const contacts = await miniSDK.contacts();

// What URL opened us? (one-shot, merged over the launch query)
const params = await miniSDK.deeplink({ launch: options });

// Read a QR, camera only
const { code: qr } = await miniSDK.scan();

// Hide a paid QR from screenshots — and ALWAYS turn it back off
await miniSDK.screen.protect(true);
```

---

## ⚙️ Configure

Call `miniSDK.configure()` once at boot. It is **partial** — only the keys you pass change — and the SDK reads your constants from nowhere: you decide what "dev" means.

```javascript
miniSDK.configure({
  simulate: __DEV__ && SIMULATE,
  fixtures: { user: { msisdn: '780000000', firstName: 'Awa', lastName: 'Bâ' } },
  log: (level, api, message, ctx) => logger[level](`[sdk:${api}] ${message}`, ctx),
  confirm: (message) => myDialog(message), // your UI for the identical-payment prompt
  timeoutMs: 30000,
});
```

| Option      | Type                                 | Default    | What it does                                                                                 |
| ----------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| `simulate`  | `boolean`                            | `false`    | Answer from fixtures instead of calling the host. For DevTools, where there is no host.      |
| `fixtures`  | `object`                             | see below  | Override any canned answer (merged over the defaults).                                       |
| `log`       | `(level, api, message, ctx) => void` | `null`     | Your logger. The SDK is silent until you give it one, and a throwing logger never breaks it. |
| `confirm`   | `(message) => Promise<boolean>`      | host modal | Your dialog for the identical-transaction prompt (falls back to `wx.showModal`).             |
| `timeoutMs` | `number`                             | `30000`    | How long to wait for the host before a `TIMEOUT`.                                            |

<details>
<summary><strong>The simulation fixtures (<code>DEFAULT_FIXTURES</code>)</strong></summary>

| Fixture         | Default                                                       | Notes                                                            |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `user`          | `{ msisdn: '770000001', firstName: 'Dev', lastName: 'User' }` | what `user()` returns under `simulate`.                          |
| `loginCode`     | `'DEV-CODE-0001'`                                             | what `login()` returns.                                          |
| `txnid`         | `() => 'MP-DEV-' + Date.now()`                                | a fresh fake transaction id for `pay()`.                         |
| `identicalOnce` | `false`                                                       | make the next simulated `pay()` raise the duplicate prompt once. |
| `contacts`      | three sample contacts                                         | what `contacts()` returns.                                       |
| `deeplink`      | `null`                                                        | what `deeplink()` resolves from.                                 |
| `scanCode`      | `'DEV-SCAN-0001'`                                             | what `scan()` returns.                                           |
| `latencyMs`     | `300`                                                         | simulated latency.                                               |

</details>

---

## 📡 API reference

Every method resolves plain data or throws a [`HostError`](#-errors). Signatures are the real ones.

### 👤 `miniSDK.user(options?)`

The authenticated host user. There is no login screen in a Max It mini-program — the host hands the user over, and this is your **only** identity source. The SDK never invents one.

```javascript
const { msisdn, fullName, firstName, lastName } = await miniSDK.user();
```

| Param                 | Type     | Default | Note                                                                                |
| --------------------- | -------- | ------- | ----------------------------------------------------------------------------------- |
| `options.maxAttempts` | `number` | `4`     | The plugin is not ready the instant the app launches; the SDK warms up and retries. |

**Returns** `Promise<{ msisdn, fullName, firstName, lastName }>` — the msisdn in its nine-digit form; a missing name part is `null`, never the string `"undefined"`.
**Throws** `UNAVAILABLE` when the host has no user to give (show your "open in Max It" state — do not impersonate a number).

---

### 🔑 `miniSDK.login(options?)`

A one-time code bound to the user. POST it to your auth broker (`{GATEWAY_URL}/auth/session { code, appId }`) for a session token. **No secret ever ships in the mini-program.**

```javascript
const code = await miniSDK.login();
const session = await http.post('/auth/session', { code, appId: APP_ID });
```

| Param                 | Type     | Default | Note                                     |
| --------------------- | -------- | ------- | ---------------------------------------- |
| `options.maxAttempts` | `number` | `3`     | Warms up ~1s after launch, then retries. |

**Returns** `Promise<string>` — the one-time code.
**Throws** `HOST_ERROR` when the host returns no code, `UNAVAILABLE` with no host.

---

### 💳 `miniSDK.pay(order, handlers?)`

One Orange Money merchant payment. **You describe the order; the SDK builds the host's request**, handles the identical-transaction prompt with exactly one retry, reads the txnid whatever the host named it, and flags `uncertain` when a timeout or an unnamed failure means the money may have moved.

```javascript
const { txnid, confirmedIdentical, sent, raw } = await miniSDK.pay(
  {
    amount: 2000,
    receiver: 467652, // the merchant code — the account the money lands on
    receiverName: 'Ma Boutique',
    orderId: 'ORD-1', // your order id; the correlation key and reference default to it
    description: 'Pass journée', // what the customer reads on the sheet
  },
  {
    onIdentical: async (message) => await myDialog(message), // "… continuer ?"
  }
);
```

**The order**

| Field            | Type     | Required | Note                                                                                      |
| ---------------- | -------- | -------- | ----------------------------------------------------------------------------------------- |
| `amount`         | `number` | ✅       | XOF, > 0. A 0 F item must not go through the sheet.                                       |
| `receiver`       | `number` | ✅       | The **merchant code**, never the msisdn, never 0.                                         |
| `receiverName`   | `string` | ✅       | Merchant display name.                                                                    |
| `description`    | `string` | ✅       | Shown on the sheet; sent as both `orderDescription` and `message`.                        |
| `orderId`        | `string` | ✅\*     | Your order id. \*At least one reference is required.                                      |
| `serviceId`      | `string` | —        | The correlation key the host records on the debit. Defaults to `orderId`.                 |
| `idService`      | `string` | —        | The **alternative** key — **exclusive**: pass `serviceId` **or** `idService`, never both. |
| `reference`      | `string` | —        | Copied into the debit's metadata. Defaults to `orderId`.                                  |
| `customerMsisdn` | `string` | —        | Optional payer number.                                                                    |
| `currency`       | `string` | —        | Defaults to `XOF`.                                                                        |
| `payload`        | `object` | —        | Extra keys merged into the host's `{ nom_marchand, code_marchand, reference }` block.     |
| `extra`          | `object` | —        | Legacy top-level fields some backends still read (`fees`, `appInfo`, …).                  |

**Handlers**

| Handler       | Type                            | Note                                                                                                                                           |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `onIdentical` | `(message) => Promise<boolean>` | Asked when the host flags a duplicate. `true` retries once; `false` → `DECLINED`. Falls back to the configured `confirm`, then `wx.showModal`. |

**Returns** `Promise<{ txnid, confirmedIdentical, sent, raw }>` — `sent` is exactly what went on the wire (for your records); `confirmedIdentical` is `true` when the payment went through on the duplicate-retry path.

**Throws**

| Code         | When                                                       | `uncertain` |
| ------------ | ---------------------------------------------------------- | :---------: |
| `INVALID`    | A bad order — caught before anything leaves the app.       |      —      |
| `REFUSED`    | The host said no on its grounds (insufficient balance…).   |   `false`   |
| `CANCELLED`  | The user closed the sheet.                                 |   `false`   |
| `DECLINED`   | The user said no to the duplicate prompt. Nothing debited. |   `false`   |
| `TIMEOUT`    | The host did not answer. **Money may have moved.**         |   `true`    |
| `HOST_ERROR` | An unnamed failure. **Money may have moved.**              |   `true`    |

> ⚠️ **After an `uncertain` error, do not let the user pay again until you have verified.** The SDK runs the payment and tells you the truth; recording the debt, verifying an uncertain outcome, and retrying fulfilment are **your app's** job — see [What this is not](#-what-this-is-not).

---

### 📇 `miniSDK.contacts()`

The device's contact book, in one shape — whichever of the three the host sent.

```javascript
const contacts = await miniSDK.contacts();
// [{ name: 'Abdoulaye Ndiaye', msisdn: ['777917330'] }, …]
```

**Returns** `Promise<Array<{ name, msisdn: string[] }>>` — `msisdn` is always an array; entries with no number are dropped.
**Throws** `DENIED` when the user refused the permission, `UNAVAILABLE` with no host.

---

### 🔗 `miniSDK.deeplink(options?)`

What the host kept from the URL it opened you from. **One-shot**: the host clears its copy once read, so publish what you get.

```javascript
const params = await miniSDK.deeplink({ launch: options }); // in onLaunch/onShow
if (params?.page) routeTo(params.page, params.id);
```

| Param            | Type      | Default | Note                                                                                                                                                                          |
| ---------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options.launch` | `*`       | —       | Your FULL launch/show options — the host's `MiniStartOptions.params` arrives there as `referrerInfo.extraData` / `extendData` (not `query`). A one-shot host copy still wins. |
| `options.once`   | `boolean` | `true`  | Answer `null` when the resolved params match the last ones handed out, so calling it on every `onShow` never double-routes. Pass `false` to always resolve.                   |

**Returns** `Promise<Object<string,string> | null>` — a flat map of lower-cased keys: one or two leading `?` stripped (the issued link is `…/miniapps/<appId>??a=b`), slash-form and glued keys expanded, a JSON string read as a map. `null` when nothing arrived (a normal state, not an error).

> 🔁 `onShow` carries the SAME options again on every resume from background. The SDK handles this: `deeplink()` is **one-shot by default**, fingerprinting the resolved params and returning `null` for a repeat, so you can call it on every `onShow` without re-routing on an app switch. Pass `{once: false}` to always resolve, and `miniSDK.resetDeeplink()` to clear the memory on a fresh cold launch.

> 🧭 **The params are data, never identity or price.** A `msisdn` in the link does not replace `user()`, a `montant` never prices an order. Mask them for logs with [`miniSDK.helpers.maskParams`](#-helpers--escape-hatch).

---

### 📷 `miniSDK.scan(options?)`

The host camera, with its failures told apart.

```javascript
const { code, albumAllowed } = await miniSDK.scan({ cameraOnly: true });
```

| Param                | Type      | Default | Note                                                                                                                                                            |
| -------------------- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options.cameraOnly` | `boolean` | `true`  | Refuse the album (the album is how a screenshot gets in). If the host cannot open the camera-only scanner, the SDK retries with the album allowed and flags it. |

**Returns** `Promise<{ code, albumAllowed }>` — `albumAllowed` warns you the picture may not be live.
**Throws** `CANCELLED` · `DENIED` · `UNAVAILABLE` · `HOST_ERROR`.

---

### 🛡️ `miniSDK.screen`

Keep a sensitive screen — a paid QR, a rolling code — out of screenshots and recordings. Android uses `FLAG_SECURE`; iOS uses the host's `block_screen` plugin.

```javascript
await miniSDK.screen.protect(true); // when the code is painted
await miniSDK.screen.protect(false); // when it leaves — ALWAYS, the host mask is host-wide
```

| Method                   | Returns                            | Note                                                                                             |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `screen.protect(on)`     | `Promise<{ platform, masked }>`    | Mask or unmask on whichever platform this is. Not simulated — blocking a screenshot has no cost. |
| `screen.block(activate)` | `Promise<boolean>`                 | The iOS host mask alone (low-level).                                                             |
| `screen.platform()`      | `'ios' \| 'android' \| 'devtools'` | Synchronous.                                                                                     |

> 🔁 **`false` is as important as `true`.** The host mask does not lift itself when your view closes.

---

### 🧪 `miniSDK.supports(capability)`

Whether a capability can be called here.

```javascript
if (miniSDK.supports('pay')) {
  /* a host is present */
}
if (miniSDK.supports('scan')) {
  /* wx.scanCode exists */
}
```

Host plugins can't be detected one by one (the host exposes no registry), so `supports('pay')` answers **"a host is present"**; a wx-level API like `'scan'` is checked for real. Under `simulate`, always `true`. **Returns** `boolean`.

---

## 🧯 Errors

Every rejection is a `HostError`. **Branch on `error.code`, show `error.message`, send `error.raw` (or `error.toJSON()`) to telemetry** — never parse the host's text yourself.

```javascript
import { miniSDK } from './sdk/index.js';

try {
  await miniSDK.pay(order);
} catch (err) {
  if (miniSDK.isHostError(err) && err.code === miniSDK.ERROR_CODES.REFUSED) {
    toast(err.message); // "Opération refusée." — user-safe, French
  } else if (err.uncertain) {
    await verifyBeforeRetry(order); // the money may have moved
  }
}
```

**`HostError`** carries: `code`, `message` (user-safe French), `api`, `raw` (the host's untouched payload), `hostMessage` (the host's own text), `uncertain`, and `toJSON()` (a telemetry-safe view).

**`miniSDK.ERROR_CODES`**

| Code          | Meaning                                                                       | `uncertain` |
| ------------- | ----------------------------------------------------------------------------- | :---------: |
| `UNAVAILABLE` | No host, or a host without this plugin (DevTools, an older app).              |      —      |
| `TIMEOUT`     | The host did not answer in time. For a payment, the money **may** have moved. |   `true`    |
| `CANCELLED`   | The user closed the host's sheet.                                             |      —      |
| `DENIED`      | A permission the user or host refused (camera, contacts).                     |      —      |
| `REFUSED`     | The host refused on its own grounds (balance, wrong PIN…).                    |      —      |
| `DECLINED`    | The user said no to the identical-transaction prompt. Nothing debited.        |      —      |
| `INVALID`     | The call was wrong before it left the app.                                    |      —      |
| `HOST_ERROR`  | The host failed for a reason it did not name. For a payment, **uncertain**.   |   `true`    |

---

## 🧩 Helpers & escape hatch

Pure helpers the SDK uses, exposed because apps reuse them. Under `miniSDK.helpers`:

| Helper                       | Signature                                   | What it does                                                 |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `normaliseMsisdn(raw)`       | `(string) => string`                        | Strip `+221`/`221`/`00221`, spaces, dots → bare digits.      |
| `isSenegalMobile(digits)`    | `(string) => boolean`                       | Is it a nine-digit Senegalese mobile (`7XXXXXXXX`)?          |
| `identityOf(user)`           | `(object) => { msisdn, fullName, … }`       | A raw host user record → a clean identity.                   |
| `normaliseContacts(res)`     | `(*) => Contact[]`                          | Any `contactList` shape → one list.                          |
| `normaliseParams(input)`     | `(*) => Object<string,string>`              | A query string / params map / launch options → one flat map. |
| `maskParams(params)`         | `(object) => object`                        | Mask phone-number values for logs and toasts.                |
| `buildHostPayload(order)`    | `(order) => object`                         | The exact `merchantPay` request the SDK would send.          |
| `readIdenticalPrompt(error)` | `(HostError) => { txnid, message } \| null` | Is this the duplicate-payment prompt, and its txnid?         |
| `CONTINUE_ACTION`            | `'1'`                                       | The string the host needs to proceed past a duplicate.       |

For a plugin the SDK does not wrap yet, `miniSDK.raw` is the low level:

| Member                         | Signature       | Note                                                                   |
| ------------------------------ | --------------- | ---------------------------------------------------------------------- |
| `raw.invoke(api, data, opts?)` | `=> Promise<*>` | One `invokeNativePlugin` call, envelope + timeout + typed errors.      |
| `raw.withRetry(fn, opts?)`     | `=> Promise<*>` | Exponential backoff; never retries `CANCELLED`/`DENIED`/`UNAVAILABLE`. |
| `raw.hasHost()`                | `=> boolean`    | Is a host with native plugins present?                                 |

---

## 🧪 Simulation & DevTools

There is no host in DevTools. Turn on `simulate` and every call answers from fixtures — no host, nothing to mock:

```javascript
miniSDK.configure({ simulate: true, fixtures: { identicalOnce: true } });

const { txnid } = await miniSDK.pay(order); // resolves a fake MP-DEV-… txnid
```

Flip `identicalOnce` to rehearse the duplicate-payment flow, override any fixture to drive a screen. The real host is used the moment `simulate` is `false`.

To rehearse a **deep link** — including the new launch-options door, which is not a `wx` call the fake host could stand in for — build sample options with `mockLaunchOptions` (from `sdk/mock/host.js`) and hand them to `deeplink`:

```javascript
import { mockLaunchOptions } from './sdk/mock/host.js';

const launch = mockLaunchOptions({ page: 'detail', id: '42' }); // extraData door, the real one
const params = await miniSDK.deeplink({ launch }); // { page: 'detail', id: '42' }
// door: 'extraData' (default) · 'extendData' · 'query' · 'doubleQuestion' (the ?? path form)
```

---

## 🔒 How it ships (and why obfuscated)

The readable source lives in [`sdk/`](./sdk). What partners install is a **single obfuscated `dist/sdk/index.js`** — the whole graph bundled and mangled, so it cannot be read or patched in place. The build is **deterministic** (fixed seed, pinned tools), and the SHA-256 manifest makes a tampered copy detectable.

> ℹ️ Obfuscation deters tampering; it does not make reverse-engineering impossible (anything running in the app can be inspected). The manifest is the integrity half. Full observations of the native side are in [`HOST_CONTRACT.md`](./HOST_CONTRACT.md).

---

## 📋 Scripts reference

| Script                | What it does                                                                         |
| --------------------- | ------------------------------------------------------------------------------------ |
| `yarn test`           | Vitest against the readable source, Node env with a `wx` stub (74 tests).            |
| `yarn lint`           | ESLint 9 — strictest set on `sdk/**` (it ships to every partner).                    |
| `yarn build`          | Bundle + obfuscate `sdk/` → `dist/sdk/` (deterministic, fixed seed).                 |
| `yarn smoke:dist`     | Import and exercise the **obfuscated** bundle — obfuscation can't break it silently. |
| `yarn manifest`       | Write the SHA-256 manifest over `dist/sdk/`.                                         |
| `yarn manifest:check` | Fail if the committed manifest is stale (CI).                                        |
| `yarn release`        | test → lint → build → smoke → manifest, in order.                                    |

**Releasing:** bump `version`, add the CHANGELOG section, `yarn release`, commit `dist/` with the source, tag `vX.Y.Z`, push. CI reruns everything, proves `dist/` matches the source, installs the commit and checks the installed file is obfuscated, then cuts the GitHub release. Publish the CLI with `npm publish --access public` (the npm package ships `cli/` only; the SDK travels through GitHub).

---

## 🗂️ Layout

```
sdk/                 ← readable SOURCE (edited here, tested here)
  index.js             miniSDK — the frozen facade
  core/                errors · config · invoke
  apis/                user · login · pay · contacts · deeplink · screen · scan
  helpers/             msisdn + identity
  mock/                a fake host for the SDK's own tests (not shipped)
  VERSION
dist/sdk/            ← PUBLISHED build, vendored into mini-programs (committed)
  index.js             one obfuscated bundle of the whole sdk/ graph
  manifest.json        file + sha256, generated
  VERSION
cli/                 the npx updater (zero dependencies, Node 18+)
scripts/             build-sdk · build-manifest · smoke-dist
HOST_CONTRACT.md     every plugin as observed in production + open questions for the host team
```

---

## 🧾 What this is not

It does not take your money decisions. `pay` runs **one** payment and tells you exactly what happened; recording a debt before the debit, verifying an uncertain outcome, and retrying fulfilment are your app's job (the fleet's boilerplate documents the rules). It does not call the auth broker: `login()` gives you the code, your HTTP layer exchanges it.

---

## 📜 License

`UNLICENSED` — internal to Sonatel / Orange. See [`HOST_CONTRACT.md`](./HOST_CONTRACT.md) for what the host actually does and [`CHANGELOG.md`](./CHANGELOG.md) for what changed.

---

<p align="center">
  Built for the Max It mini-program fleet by the <strong>Sonatel</strong> Shared Foundations team.<br/>
  A host quirk the SDK doesn't cover yet? Open an issue — it belongs here, so every app gets the fix.
</p>
