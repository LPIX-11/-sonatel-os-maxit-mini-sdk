# Host contract — what the Max It host actually does

The plugins a mini-program reaches through `wx.invokeNativePlugin`, as **observed** in production mini-programs (2025–2026). This is the SDK's source of truth and the document the host team is asked to confirm or correct. Every entry says what was seen, not what was promised.

## Envelope

A success answers through `success(res)` with:

```json
{ "result": "success", "status_code": 200, "data": { … } }
```

A **failure may also come through `success`**, with a failure envelope (`result: "fail"`, a `status_code`, a `message`, and sometimes extra fields such as `txnid`). The `fail(err)` callback carries `{ errMsg }` and is used for runtime-level refusals (unknown API, cancelled sheet, denied permission). The SDK treats both roads the same way and keeps the raw payload on `HostError.raw`.

Plugins are **not ready the instant the app launches**: the first `userInfos` or `login` can fail for a few hundred milliseconds. The SDK waits and retries.

## `userInfos`

- Request: `{}`.
- Answer: `data.user = { msisdn, firstName, lastName, … }`.
- Observed: the msisdn arrives **as the subscriber registered it** — `+221 77…`, `221 77…`, `00221…`, with spaces. `firstName`/`lastName` may be missing, and a missing one has been seen serialised as the string `"undefined"`. Backends that validate the msisdn at nine characters answered a bare 400 to a share of real users (stadium, 2026-10-28). The SDK normalises both.

## `login`

- Request: `{}`.
- Answer: `data.code` (seen at top level as `code` on some builds): a one-time code, exchanged by the app against `POST {GATEWAY_URL}/auth/session { code, appId }` on the mini-app auth broker. No client secret is involved.

## `merchantPay`

- Request:

| Field                               | Type   | Note                                                                                                                                                                        |
| ----------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amount`                            | number | XOF                                                                                                                                                                         |
| `receiver`                          | number | the **merchant code** (the account the money lands on), never the msisdn, never 0                                                                                           |
| `receiverName`                      | string | merchant display name                                                                                                                                                       |
| `orderDescription`, `message`       | string | what the customer reads on the sheet (both names have been used; the SDK sends both)                                                                                        |
| `orderId`                           | string | the app's order id                                                                                                                                                          |
| `serviceId` **or** `idService`      | string | the correlation key the host records on the debit (the exact-match key for a later verification). **Exclusive: the host accepts one of the two, never both** (2026-10).     |
| `reference`                         | string | copied by the host into the debit's metadata                                                                                                                                |
| `payload`                           | object | `{ nom_marchand, code_marchand, reference }` — the block the host reads the merchant and the reference from. A **replace, not a merge**, on the native side: send it whole. |
| `currency`                          | string | `XOF`                                                                                                                                                                       |
| `customerMsisdn`                    | string | optional                                                                                                                                                                    |
| `merchantMsisdn`, `fees`, `appInfo` | —      | older fields some apps still send; tolerated, not required (pass them through `extra` if your backend reads them)                                                           |

- Observed: `amount` has been accepted both as a number and as a string.

- Answer: `data.txnid` — also seen as `trxReference`, `transactionId`, `reference`.
- **Identical transaction.** The host refuses a second identical payment (same payer, merchant, amount) for about 15 minutes with a `success` failure envelope whose message ends in « … continuer ? » (variants: « identique », « similaire », « même transaction ») and which **carries a `txnid`** at the top level of the envelope. To proceed, the app calls `merchantPay` again with the same payload plus `txnid` and **`caction: '1'` — a string**: the host's typed request has `caction` as a nullable string and a number fails its type check before the payment runs (fixed in production 2026-10-24).
- Observed: when the error string carries no id, the host has put the **whole message** in `txnid` (`CODE:2040;MESSAGE:…;TXNID:null`) or the literal `"null"`. The SDK refuses those as ids.
- A 0 F amount is refused by the host with a message the decline patterns do not know. Do not send free items through the sheet.
- After a `TIMEOUT` or an unnamed failure the debit **may have happened**: the SDK marks the error `uncertain`. An app that sells things needs a verification step before letting the user pay again (the fleet uses the txn-verify oracle on the mini-app gateway).

## `contactList`

- Request: **none** — the plugin answers an empty list when handed a `data` field (observed 2026-10).
- Answer: seen as `{ data: { contacts } }`, `{ contacts }` and `{ data: [ … ] }`. Each contact: `{ name, msisdn }` with `msisdn` a string or an array of strings.
- A refused permission arrives through `fail` with an `auth deny`-style message.

## `block_screen`

- Request: `{ activate: true | false }`.
- Effect: masks the screen in captures on **iOS**, where the runtime's `wx.setVisualEffectOnCapture` masks nothing. **Host-wide**: it does not lift itself when the view closes; `false` must be called. On Android the runtime call works (`FLAG_SECURE`).

## `getDeeplinkParams`

- Request: `{}`.
- Answer: `data.params` — the map of everything after the « ? » of the URL the host opened the mini-program from (`https://<host>/mini-apps/<appId>?a=b`). **One-shot**: the host clears its copy once read. `null`/absent when nothing is pending.
- Observed: links are also issued in a **slash form** (`…/mini-apps/<appId>/a=b&c=d`). The host's router captures `:id` with `.*`, so the tail arrives glued to the app id, as one key or one value. The SDK expands both.
- The launch options' `query` is a second source (DevTools compile condition; a host passing `MiniStartOptions.params`). The host's wins.

## Not plugins, but handled

- `wx.scanCode` — `onlyFromCamera` is honoured; a host that cannot open the camera-only variant fails with a generic message, and the SDK retries with the album allowed, flagged.
- `wx.setVisualEffectOnCapture` — Android only in practice.

## Open questions for the host team

1. Is there a plugin registry / version the mini-program can read, so `supports()` can answer per plugin?
2. The documented spelling of the order id on `merchantPay` (`serviceId` vs `idService`).
3. A share plugin contract (`appInfo` semantics, file path vs data URI) — not wrapped until confirmed.
4. Whether the slash-form deep link will be parsed host-side (the `?` form already works).
