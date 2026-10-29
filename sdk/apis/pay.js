// ============================================================================
// miniSDK.pay(payload, options) — an Orange Money merchant payment, done.
//
//   const { txnid } = await miniSDK.pay({ amount, receiver, receiverName, message, serviceId });
//
// What the SDK handles so the app does not:
//   • the payload's required fields and types (INVALID before anything leaves)
//   • the host's "identical transaction — continuer ?" prompt: the host
//     refuses a second identical payment (same payer, merchant, amount) for
//     ~15 min and returns a txnid ON THE FAILURE; on the user's yes, the SDK
//     retries ONCE with `{txnid, caction: '1'}` — the flag MUST be a string,
//     the host's typed request rejects a number. The user's no is DECLINED.
//   • the result's shape: the host is not consistent about the id's name
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

/** Wordings the host uses for the identical-transaction prompt. */
const DUPLICATE_PATTERNS = [/continuer\s*\??$/, /identique/, /similaire/, /m[êe]me transaction/];

/** Keys the host is known to use for the transaction id. */
const TXN_ID_KEYS = ['txnid', 'trxReference', 'transactionId', 'reference', 'transactionID'];

/** The payload fields the host requires. */
const REQUIRED = ['amount', 'receiver', 'receiverName', 'message'];

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
 * Validate the payload before anything leaves the app.
 * @param {Object} payload
 * @throws {HostError} INVALID
 */
const validate = (payload) => {
  const problems = [];
  if (!payload || typeof payload !== 'object') {
    throw new HostError(ERROR_CODES.INVALID, { api: API, hostMessage: 'payload is not an object' });
  }
  REQUIRED.forEach((key) => {
    if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
      problems.push(`${key} manquant`);
    }
  });
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    problems.push('amount doit être un nombre > 0');
  }
  if (payload.receiver !== undefined && !Number.isFinite(Number(payload.receiver))) {
    problems.push('receiver doit être le code marchand (numérique)');
  }
  if (Number(payload.receiver) === 0) {
    problems.push('receiver 0 enverrait l’argent nulle part');
  }
  if (problems.length) {
    throw new HostError(ERROR_CODES.INVALID, { api: API, hostMessage: problems.join(' · ') });
  }
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
 * @param {Object} payload
 * @returns {Promise<{txnid: string, raw: *}>}
 */
const payOnce = async (payload) => {
  const data = await invoke(API, payload);
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
 * @param {Object} payload
 * @returns {Promise<{txnid: string, raw: *}>}
 */
const simulatePay = async (payload) => {
  await delay();
  if (fixtures().identicalOnce && !simulatedIdenticalDone && !payload.txnid) {
    simulatedIdenticalDone = true;
    throw new HostError(ERROR_CODES.HOST_ERROR, {
      api: API,
      hostMessage: 'Vous venez d effectuer une transaction identique. Continuer ?',
      raw: { txnid: 'MP-DEV-DUP' },
    });
  }
  const txnid = payload.txnid || fixtures().txnid();
  return { txnid, raw: { txnid, simulated: true } };
};

/**
 * @typedef {Object} PayResult
 * @property {string} txnid - the Orange Money transaction id
 * @property {boolean} confirmedIdentical - the user confirmed an identical-transaction prompt
 * @property {*} raw - the host's answer, untouched
 */

/**
 * Run an Orange Money merchant payment.
 *
 * @param {Object} payload
 * @param {number} payload.amount - XOF, > 0
 * @param {number|string} payload.receiver - the MERCHANT CODE the money lands on (never 0)
 * @param {string} payload.receiverName - merchant display name
 * @param {string} payload.message - what the customer reads on the sheet
 * @param {string} [payload.serviceId] - your order id, carried into the debit
 *   (what makes a later verification exact); sent as `idService` too
 * @param {string} [payload.reference] - copied by the host into the debit's metadata
 * @param {number} [payload.merchantMsisdn] - the shared merchant-pay line
 * @param {number} [payload.fees=0]
 * @param {string} [payload.appInfo] - application identifier
 * @param {Object} [options]
 * @param {(message: string) => Promise<boolean>} [options.onIdentical] - your
 *   dialog for the identical-transaction prompt; defaults to the configured
 *   `confirm`, then to the host's dialog
 * @returns {Promise<PayResult>}
 * @throws {HostError} INVALID · CANCELLED · REFUSED · DECLINED (nothing
 *   debited) · TIMEOUT · HOST_ERROR (`uncertain: true` — verify before
 *   letting the user pay again)
 */
export const pay = async (payload, { onIdentical } = {}) => {
  validate(payload);
  const body = { ...payload };
  if (body.serviceId && body.idService === undefined) {
    body.idService = body.serviceId;
  }
  const run = isSimulated() ? simulatePay : payOnce;

  try {
    const first = await run(body);
    log('info', API, 'payment confirmed', { txnid: first.txnid });
    return { ...first, confirmedIdentical: false };
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
    const second = await run({ ...body, txnid: prompt.txnid, caction: CONTINUE_ACTION });
    log('info', API, 'identical transaction confirmed', { txnid: second.txnid });
    return { ...second, confirmedIdentical: true };
  }
};

/** Test hook. */
export const resetPaySimulation = () => {
  simulatedIdenticalDone = false;
};
