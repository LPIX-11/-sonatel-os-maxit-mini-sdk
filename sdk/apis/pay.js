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
//     the merchant and the reference from, and the ONE correlation key
//     (`serviceId` OR `idService`, never both: the host refuses the pair).
//   • the host's "identical transaction — continuer ?" prompt: the host
//     refuses a second identical payment (same payer, merchant, amount) for
//     ~15 min and returns a txnid ON THE FAILURE; on the user's yes, the SDK
//     retries ONCE with `{txnid, caction: '1'}` — the flag MUST be a string,
//     the host's typed request rejects a number. The user's no is DECLINED.
//   • the result's shape: the host is not consistent about the id's name.
//   • the error's meaning: CANCELLED / REFUSED are "nothing debited";
//     TIMEOUT / HOST_ERROR carry `uncertain: true` — the money MAY have
//     moved, and the app must not simply let the user pay again.
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
 * @param {*} value
 * @returns {string}
 */
const text = (value) => (value === undefined || value === null ? '' : String(value).trim());

/**
 * The ONE correlation key the host accepts: `idService` or `serviceId`,
 * never both. **`idService` is the name the host actually reads** — its
 * request model (samea-mobile `MiniAppPayReq.fromMap`) copies `idService`
 * into the Orange Money debit's `serviceId` and ignores a top-level
 * `serviceId` — so a bare `orderId`, and a pair given with one value,
 * resolve to `idService`. An explicit `serviceId` alone is kept under that
 * name for a host build that reads it.
 * @param {Object} order
 * @returns {{key: 'serviceId'|'idService', value: string}|null}
 * @throws {HostError} INVALID when both are given with different values
 */
export const correlationOf = (order) => {
  const serviceId = text(order.serviceId);
  const idService = text(order.idService);
  if (serviceId && idService && serviceId !== idService) {
    throw new HostError(ERROR_CODES.INVALID, {
      api: API,
      hostMessage: 'serviceId et idService sont exclusifs : un seul des deux',
    });
  }
  if (serviceId && !idService) {
    return { key: 'serviceId', value: serviceId };
  }
  const value = idService || text(order.orderId);
  return value ? { key: 'idService', value } : null;
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
    problems.push('orderId (ou serviceId) manquant : le débit doit porter une référence');
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
 *   message · ONE of idService / serviceId (idService by default: the name the
 *   host reads) · reference · customerMsisdn ·
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
      reference: reference || null,
      ...(order.payload && typeof order.payload === 'object' ? order.payload : {}),
    },
    ...(order.extra && typeof order.extra === 'object' ? order.extra : {}),
  };
  if (text(order.orderId)) {
    body.orderId = text(order.orderId);
  }
  if (correlation) {
    body[correlation.key] = correlation.value;
  }
  if (reference) {
    body.reference = reference;
  }
  if (text(order.customerMsisdn)) {
    body.customerMsisdn = text(order.customerMsisdn);
  }
  return body;
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
  const data = await invoke(API, body);
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
 *   debit (the exact-match key for a later verification), under the name the
 *   host reads; defaults to orderId
 * @param {string} [order.serviceId] - the same key under the other spelling,
 *   for a host build that reads it — give ONE of idService / serviceId, never both
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
