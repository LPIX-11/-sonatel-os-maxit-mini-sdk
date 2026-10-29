# maxit-mini-sdk

The Max It host, as one object. Everything a mini-program does through `wx.invokeNativePlugin` — identity, login, Orange Money payment, contacts, deep links, screen protection — with plain results and typed errors, and the host's quirks handled once instead of in every app.

```javascript
import { miniSDK } from './sdk/index.js';

const user = await miniSDK.user(); // { msisdn: '770000001', fullName: 'Fatou Sarr', … }
const code = await miniSDK.login(); // one-time code for the auth broker

const { txnid } = await miniSDK.pay({
  amount: 2000,
  receiver: 467652, // the merchant code
  receiverName: 'Ma Boutique',
  orderId: 'ORD-1', // your order id: the correlation key and the reference default to it
  description: 'Pass journée',
});
```

You describe the order; the SDK builds the host's request — the nested `payload` block (`nom_marchand`, `code_marchand`, `reference`), **one** correlation key (`serviceId` or `idService`, never both: the host refuses the pair), the description under both names the host has used. `result.sent` is what went on the wire.

The identical-transaction prompt, the string `caction`, the txnid hidden on a failure, the contact list that answers empty when handed a `data` key, the one-shot deep link, the host-wide capture mask: all inside.

## Install into a mini-program

```bash
npx @sonatel-os/maxit-mini-sdk update
```

That writes the `sdk/` folder into your project (verified against a signed manifest) and nothing else: no `node_modules`, no build step, TCMPP packs the folder as it packs your pages. Run the same command to update; it prints what changed.

```bash
npx @sonatel-os/maxit-mini-sdk update 0.2.0     # a given version
npx @sonatel-os/maxit-mini-sdk update --dir utils/sdk
npx @sonatel-os/maxit-mini-sdk check            # exit 2 when an update exists
npx @sonatel-os/maxit-mini-sdk version
```

Never edit the vendored folder: a fix belongs here so every app gets it.

## API

| Call                                    | Resolves                                                               | Throws (`HostError.code`)                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `miniSDK.user()`                        | `{ msisdn, fullName, firstName, lastName }` — nine digits, a real name | `UNAVAILABLE` (no host, no msisdn)                                                                            |
| `miniSDK.login()`                       | the one-time code (string)                                             | `UNAVAILABLE`, `HOST_ERROR`                                                                                   |
| `miniSDK.pay(payload, { onIdentical })` | `{ txnid, confirmedIdentical, raw }`                                   | `INVALID` · `CANCELLED` · `REFUSED` · `DECLINED` (nothing debited) · `TIMEOUT` · `HOST_ERROR` (**uncertain**) |
| `miniSDK.contacts()`                    | `[{ name, msisdn: [] }]`                                               | `DENIED`, `UNAVAILABLE`                                                                                       |
| `miniSDK.deeplink({ launch })`          | `{ page, id, … }` or `null`                                            | never (no link is a normal state)                                                                             |
| `miniSDK.scan({ cameraOnly })`          | `{ code, albumAllowed }`                                               | `CANCELLED`, `DENIED`, `UNAVAILABLE`                                                                          |
| `miniSDK.screen.protect(on)`            | `{ platform, masked }`                                                 | never                                                                                                         |
| `miniSDK.supports(name)`                | boolean                                                                | —                                                                                                             |

### Errors

```javascript
try {
  await miniSDK.pay(payload);
} catch (err) {
  if (err.code === miniSDK.ERROR_CODES.CANCELLED) return; // nothing debited
  if (err.code === 'DECLINED') return; // nothing debited
  if (err.uncertain) return showVerifying(); // the money MAY have moved
  showToast(err.message); // French, user-safe
  telemetry.warn('PAIEMENT', err.hostMessage, err.toJSON()); // the host's own words
}
```

`err.raw` is the host's payload, untouched. `err.uncertain` is true after a `TIMEOUT` or `HOST_ERROR` on a payment: do not let the user simply pay again without a verification step.

### Configuration

```javascript
miniSDK.configure({
  simulate: __DEV__ && SIMULATE, // answer fixtures instead of calling the host
  fixtures: { user: { msisdn: '780000000', firstName: 'Awa', lastName: 'Bâ' } },
  log: (level, api, message, ctx) => log[level](`[sdk:${api}] ${message}`, ctx),
  confirm: (message) => myDialog(message), // your UI for the identical prompt
  timeoutMs: 30000,
});
```

The SDK logs nothing on its own and never reads your constants: you tell it what "dev" means. For DevTools, where there is no host at all, `sdk/mock/host.js` installs a fake `wx.invokeNativePlugin` that answers like the phone, envelopes included:

```javascript
import { installMockHost } from './sdk/mock/host.js';
if (__DEV__ && !miniSDK.supports('host'))
  installMockHost({ deeplink: { page: 'demo' } }, { identicalOnce: true });
```

## What this is not

It does not take your money decisions. `pay` runs one payment and tells you exactly what happened; recording a debt before the debit, verifying an uncertain outcome, retrying a fulfilment are your app's job (the fleet's boilerplate documents the rules). It does not call the auth broker: `login()` gives you the code, your HTTP layer exchanges it.

## Host contract

[`HOST_CONTRACT.md`](HOST_CONTRACT.md) lists every plugin as **observed** in production: envelopes, field names, the inconsistencies, the open questions for the host team. When the host changes, that file changes first, then the SDK, then a release.

## Development

```bash
yarn install
yarn test            # vitest, node, a wx stub
yarn lint
yarn manifest        # regenerate sdk/manifest.json + VERSION from package.json
```

Releasing: bump `version` in `package.json`, add the CHANGELOG section, `yarn release`, commit, tag `vX.Y.Z`, push the tag. CI verifies lint, tests, manifest freshness and runs the updater against the commit, then creates the GitHub release. Publish the CLI with `npm publish --access public` from the same commit (the package ships `cli/` only; the SDK itself travels through GitHub).

## Layout

```
sdk/                 ← vendored into mini-programs
  index.js           miniSDK
  core/              errors · config · invoke
  apis/              user · login · pay · contacts · deeplink · screen · scan
  helpers/           msisdn + identity
  mock/              the DevTools host
  manifest.json      files + sha256, generated
  VERSION
cli/                 the npx updater (zero dependencies, Node 18+)
scripts/             build-manifest
HOST_CONTRACT.md     what the host does, as observed
```
