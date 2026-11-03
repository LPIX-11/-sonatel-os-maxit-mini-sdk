// ============================================================================
// miniSDK.pay(order, options) — an Orange Money merchant payment, done.
//
//   const { txnid } = await miniSDK.pay({
//     amount: 2000, receiver: 467652, receiverName: 'Ma Boutique',
//     orderId: 'ORD-1', description: 'Pass journée',
//   });
//
// What the SDK handles so the app does not:
//   • the HOST PAYLOAD: the app describes the order in plain terms; the SDK
//     builds what the host's `merchantPay` expects (see buildHostPayload and
//     HOST_CONTRACT.md) — including the nested `payload` block the host reads
//     the merchant and the reference from, and the correlation key under
//     BOTH spellings the host has read (`idService` AND `serviceId`, one
//     value): whichever build of the host runs, the debit carries it.
//   • the host's "identical transaction — continuer ?" prompt: the host
//     refuses a second identical payment (same payer, merchant, amount) for
//     ~15 min and returns a txnid ON THE FAILURE; on the user's yes, the SDK
//     retries ONCE with `{txnid, caction: '1'}` — the flag MUST be a string,
//     the host's typed request rejects a number. The user's no is DECLINED.
//   • the result's shape: the host is not consistent about the id's name.
//   • the error's meaning: CANCELLED / REFUSED are "nothing debited";
//     TIMEOUT / HOST_ERROR carry `uncertain: true` — the money MAY have
//     moved, and the app must not simply let the user pay again.
//   • the WAIT: a payment is given PAY_TIMEOUT_MS (10 min), not the generic
//     30 s — the host's PIN sheet alone outlasts that.
// ============================================================================

import { invoke, runtime } from '../core/invoke.js';
import { isSimulated, fixtures, delay, confirmHandler, log } from '../core/config.js';
import { HostError, ERROR_CODES, hostMessageOf } from '../core/errors.js';

/** The plugin's api_name. */
export const API = 'merchantPay';

/** The caction value that says "the user confirmed this identical transaction". A STRING. */
export const CONTINUE_ACTION = '1';

/** The currency the host debits in. */
export const CURRENCY = 'XOF';

/**
 * How long a payment may take before the SDK gives up on the host. The
 * generic call timeout (30 s) is for plugins that answer at once; a
 * `merchantPay` runs the host's resume sheet, the PIN and the network, with
 * the mini-program in the background — minutes, not seconds. A 30-s cut
 * raised TIMEOUT (« uncertain ») while the customer was still typing their
 * PIN, and the host's real answer, arriving later, was dropped as a late
 * reply (2026-11-03). Ten minutes: long enough for any PIN, short enough
 * that a host that truly died does not hang the app for ever.
 */
export const PAY_TIMEOUT_MS = 10 * 60 * 1000;

/** Wordings the host uses for the identical-transaction prompt. */
const DUPLICATE_PATTERNS = [/continuer\s*\??$/, /identique/, /similaire/, /m[êe]me transaction/];

/** Keys the host is known to use for the transaction id. */
const TXN_ID_KEYS = ['txnid', 'trxReference', 'transactionId', 'reference', 'transactionID'];

/** The order fields the SDK requires before anything leaves the app. */
const REQUIRED = ['amount', 'receiver', 'receiverName', 'description'];

let simulatedIdenticalDone = false;

/**
 * Whether a value can be a transaction id at all. The host fills the
 * failure's `txnid` from its error string and, when that string carries no
 * id, hands the WHOLE message back in its place ("CODE:…;MESSAGE:…") or the
 * literal "null".
 * @param {*} value
 * @returns {boolean}
 */
const looksLikeTxnid = (value) => {
  const id = String(value == null ? '' : value).trim();
  if (!id || id.length > 64) {
    return false;
  }
  if (/^(null|undefined|none)$/i.test(id)) {
    return false;
  }
  return !/[\s;:]/.test(id);
};

/**
 * First plausible transaction id on an object.
 * @param {*} source
 * @returns {string} '' when none
 */
export const txnidOf = (source) => {
  if (!source || typeof source !== 'object') {
    return '';
  }
  for (const key of TXN_ID_KEYS) {
    if (looksLikeTxnid(source[key])) {
      return String(source[key]).trim();
    }
  }
  return '';
};

/**
 * If `error` is the host's identical-transaction prompt AND carries an id,
 * `{txnid, message}`; otherwise null (the caller handles the failure as it
 * would have).
 * @param {HostError|Error} error
 * @returns {{txnid: string, message: string}|null}
 */
export const readIdenticalPrompt = (error) => {
  if (!error) {
    return null;
  }
  const message = String(error.hostMessage || error.message || '').trim();
  const haystack = message.toLowerCase();
  if (!DUPLICATE_PATTERNS.some((re) => re.test(haystack))) {
    return null;
  }
  const raw = error.raw || null;
  const txnid = txnidOf(error) || txnidOf(raw) || txnidOf(raw && raw.data);
  return txnid ? { txnid, message } : null;
};

/**
 * A field as the host will read it: trimmed, and EMPTY for anything that is
 * not a value — null, undefined, and the strings a template literal makes of
 * them ("null", "undefined"), which a host would otherwise record as a key.
 * @param {*} value
 * @returns {string}
 */
const text = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  const s = String(value).trim();
  return /^(null|undefined)$/i.test(s) ? '' : s;
};

/**
 * The body without any empty slot: a null, an undefined or an empty string
 * never reaches the host, at the top level or inside `payload` — the host
 * copies what it finds into the debit (`serviceId`, `metadata.reference`),
 * and a null there is a debit nobody can tie to an order.
 * @param {Object} body
 * @returns {Object}
 */
export const withoutEmpty = (body) => {
  /** @type {Object} */
  const out = {};
  Object.keys(body || {}).forEach((k) => {
    const v = body[k];
    if (v === undefined || v === null) {
      return;
    }
    if (typeof v === 'string' && text(v) === '') {
      return;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = withoutEmpty(v);
      if (Object.keys(inner).length) {
        out[k] = inner;
      }
      return;
    }
    out[k] = v;
  });
  return out;
};

/**
 * The correlation key the host records on the debit (the exact-match key of
 * a later verification), ONE value sent under BOTH spellings. The host source
 * read on 2026-10-21/30 (samea-mobile `MiniAppPayReq.fromMap`) copies
 * `idService` into the Orange Money debit's `serviceId`; which spelling the
 * build in the customers' hands reads is not something a mini-program can
 * know, and BRT — the one app whose key is PROVEN in the ledger — has always
 * sent both. Until 0.1.5 the SDK sent one key only, on the belief that the
 * host refused the pair: no such refusal exists in the host's code.
 * `idService`, `serviceId` and `orderId` are read in that order; two
 * different values are a contradiction the app must resolve, not a choice
 * the SDK makes.
 * @param {Object} order
 * @returns {{value: string}|null}
 * @throws {HostError} INVALID when serviceId and idService differ
 */
export const correlationOf = (order) => {
  const serviceId = text(order.serviceId);
  const idService = text(order.idService);
  if (serviceId && idService && serviceId !== idService) {
    throw new HostError(ERROR_CODES.INVALID, {
      api: API,
      hostMessage: 'serviceId et idService doivent porter la même valeur',
    });
  }
  const value = idService || serviceId || text(order.orderId);
  return value ? { value } : null;
};

/**
 * Validate the order before anything leaves the app.
 * @param {Object} order
 * @throws {HostError} INVALID
 */
const validate = (order) => {
  if (!order || typeof order !== 'object') {
    throw new HostError(ERROR_CODES.INVALID, { api: API, hostMessage: 'order is not an object' });
  }
  const problems = [];
  REQUIRED.forEach((key) => {
    if (text(order[key]) === '') {
      problems.push(`${key} manquant`);
    }
  });
  const amount = Number(order.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    problems.push('amount doit être un nombre > 0');
  }
  if (order.receiver !== undefined && !Number.isFinite(Number(order.receiver))) {
    problems.push('receiver doit être le code marchand (numérique)');
  }
  if (Number(order.receiver) === 0) {
    problems.push('receiver 0 enverrait l’argent nulle part');
  }
  if (!correlationOf(order)) {
    problems.push(
      'orderId (ou idService / serviceId) manquant : le débit doit porter une référence'
    );
  }
  if (problems.length) {
    throw new HostError(ERROR_CODES.INVALID, { api: API, hostMessage: problems.join(' · ') });
  }
};

/**
 * The host's `merchantPay` request, from a plain order.
 *
 * Shape (HOST_CONTRACT.md § merchantPay, as the fleet sends it in 2026-10):
 *   amount · currency · receiver · receiverName · orderId · orderDescription ·
 *   message · idService AND serviceId (the same value — see correlationOf) ·
 *   reference · customerMsisdn ·
 *   payload: { nom_marchand, code_marchand, reference } — the block the host
 *   reads the merchant and the reference from (a replace, not a merge, on the
 *   native side: send it whole) · any `extra` the app wants to pass through.
 *
 * @param {Object} order - see `pay`
 * @returns {Object} what goes on the wire
 */
export const buildHostPayload = (order) => {
  const correlation = correlationOf(order);
  const reference =
    text(order.reference) || text(order.orderId) || (correlation && correlation.value);
  const description = text(order.description);
  const receiverName = text(order.receiverName);
  const body = {
    amount: Number(order.amount),
    currency: text(order.currency) || CURRENCY,
    receiver: Number(order.receiver),
    receiverName,
    orderDescription: description,
    message: description,
    payload: {
      nom_marchand: receiverName,
      code_marchand: String(Number(order.receiver)),
      ...(reference ? { reference } : {}),
      ...(order.payload && typeof order.payload === 'object' ? order.payload : {}),
    },
    ...(order.extra && typeof order.extra === 'object' ? order.extra : {}),
  };
  if (text(order.orderId)) {
    body.orderId = text(order.orderId);
  }
  if (correlation) {
    body.idService = correlation.value;
    body.serviceId = correlation.value;
  }
  if (reference) {
    body.reference = reference;
  }
  if (text(order.customerMsisdn)) {
    body.customerMsisdn = text(order.customerMsisdn);
  }
  // Nothing empty leaves — see withoutEmpty.
  return withoutEmpty(body);
};

/**
 * The host's native dialog, when the app gave no confirm handler.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
const defaultConfirm = (message) =>
  new Promise((resolve) => {
    const w = runtime();
    if (!w || typeof w.showModal !== 'function') {
      resolve(false);
      return;
    }
    w.showModal({
      title: 'Paiement',
      content: message,
      confirmText: 'Continuer',
      cancelText: 'Annuler',
      success: (res) => resolve(Boolean(res && res.confirm)),
      fail: () => resolve(false),
    });
  });

/**
 * One merchantPay call → `{txnid, raw}`.
 * @param {Object} body - the host payload
 * @returns {Promise<{txnid: string, raw: *}>}
 */
const payOnce = async (body) => {
  const data = await invoke(API, body, { timeoutMs: PAY_TIMEOUT_MS });
  const txnid = txnidOf(data) || txnidOf(data && data.data);
  if (!txnid) {
    throw new HostError(ERROR_CODES.HOST_ERROR, {
      api: API,
      raw: data,
      hostMessage: 'success without a transaction id',
    });
  }
  return { txnid, raw: data };
};

/**
 * A simulated payment: a fake txnid after a short delay; once, the identical
 * prompt when the fixture asks for it.
 * @param {Object} body
 * @returns {Promise<{txnid: string, raw: *}>}
 */
const simulatePay = async (body) => {
  await delay();
  if (fixtures().identicalOnce && !simulatedIdenticalDone && !body.txnid) {
    simulatedIdenticalDone = true;
    throw new HostError(ERROR_CODES.HOST_ERROR, {
      api: API,
      hostMessage: 'Vous venez d effectuer une transaction identique. Continuer ?',
      raw: { txnid: 'MP-DEV-DUP' },
    });
  }
  const txnid = body.txnid || fixtures().txnid();
  return { txnid, raw: { txnid, simulated: true } };
};

/**
 * @typedef {Object} PayResult
 * @property {string} txnid - the Orange Money transaction id
 * @property {boolean} confirmedIdentical - the user confirmed an identical-transaction prompt
 * @property {Object} sent - the host payload that was sent (for your records / telemetry)
 * @property {*} raw - the host's answer, untouched
 */

/**
 * Run an Orange Money merchant payment.
 *
 * @param {Object} order - the order, in plain terms
 * @param {number} order.amount - XOF, > 0
 * @param {number|string} order.receiver - the MERCHANT CODE the money lands on (never 0)
 * @param {string} order.receiverName - merchant display name
 * @param {string} order.description - what the customer reads on the sheet
 * @param {string} [order.orderId] - your order id; the correlation key and the
 *   reference default to it
 * @param {string} [order.idService] - the correlation key carried into the
 *   debit (the exact-match key for a later verification); defaults to
 *   orderId. Sent under BOTH spellings, `idService` and `serviceId`
 * @param {string} [order.serviceId] - the same key under the other spelling;
 *   when both are given they must be equal
 * @param {string} [order.reference] - copied by the host into the debit's
 *   metadata; defaults to orderId
 * @param {string} [order.customerMsisdn]
 * @param {string} [order.currency='XOF']
 * @param {Object} [order.payload] - extra fields merged into the host's
 *   nested `payload` block
 * @param {Object} [order.extra] - extra top-level fields passed through as is
 * @param {Object} [options]
 * @param {(message: string) => Promise<boolean>} [options.onIdentical] - your
 *   dialog for the identical-transaction prompt; defaults to the configured
 *   `confirm`, then to the host's dialog
 * @returns {Promise<PayResult>}
 * @throws {HostError} INVALID · CANCELLED · REFUSED · DECLINED (nothing
 *   debited) · TIMEOUT · HOST_ERROR (`uncertain: true` — verify before
 *   letting the user pay again)
 */
export const pay = async (order, { onIdentical } = {}) => {
  validate(order);
  const body = buildHostPayload(order);
  const run = isSimulated() ? simulatePay : payOnce;

  try {
    const first = await run(body);
    log('info', API, 'payment confirmed', { txnid: first.txnid });
    return { ...first, confirmedIdentical: false, sent: body };
  } catch (error) {
    const prompt = readIdenticalPrompt(error);
    if (!prompt) {
      log('warn', API, 'payment failed', {
        code: error.code,
        hostMessage: hostMessageOf(error.raw),
      });
      throw error;
    }

    const confirm = onIdentical || confirmHandler() || defaultConfirm;
    const proceed = await confirm(prompt.message);
    if (!proceed) {
      log('info', API, 'identical transaction declined by the user');
      throw new HostError(ERROR_CODES.DECLINED, {
        api: API,
        raw: error.raw,
        hostMessage: prompt.message,
      });
    }

    // Exactly one retry, not re-wrapped: no loop even if the host prompts again.
    const retryBody = { ...body, txnid: prompt.txnid, caction: CONTINUE_ACTION };
    const second = await run(retryBody);
    log('info', API, 'identical transaction confirmed', { txnid: second.txnid });
    return { ...second, confirmedIdentical: true, sent: retryBody };
  }
};

/** Test hook. */
export const resetPaySimulation = () => {
  simulatedIdenticalDone = false;
};
