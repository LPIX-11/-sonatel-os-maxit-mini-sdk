// ============================================================================
// miniSDK.transfer() — an Orange Money transfer from the user to another
// subscriber, through the host's `transfertMoney` plugin.
//
// What the SDK owns here (HOST_CONTRACT.md § transfertMoney, read in the
// host's source):
//   • the REQUEST: the host needs a receiver and an amount, nothing else. It
//     takes the SENDER from its own session and computes the FEES itself —
//     a `sender` or `fees` an app sends is never read, so none is sent.
//   • the WAIT: the user reads the host's summary and types a PIN; the call
//     gets the payment's ten minutes, not the generic thirty seconds.
//   • the REFUSALS the host words its own way: « User cancelled » and
//     « Pin is required » are both the user backing out before any debit.
//   • the RESULT: `{ txnid, sender }`. The host may answer a success without
//     a transaction id; that is still a success, with `txnid: null`.
//
// TIMEOUT / HOST_ERROR carry `uncertain: true` — the money MAY have moved.
// ============================================================================

import { invoke } from '../core/invoke.js';
import { HostError, ERROR_CODES, isHostError } from '../core/errors.js';
import { isSimulated, fixtures, delay } from '../core/config.js';
import { normaliseMsisdn, isSenegalMobile } from '../helpers/msisdn.js';
import { PAY_TIMEOUT_MS } from './pay.js';

/** The plugin's api_name (the host's spelling). */
export const API = 'transfertMoney';

/** What the host answers when the user backs out, before any debit. */
const BACKED_OUT = ['user cancelled', 'pin is required'];

/** What the host answers when it could not read the request. */
const UNREADABLE = 'input body';

/**
 * @typedef {Object} Transfer
 * @property {number} amount - XOF, a positive integer
 * @property {string} receiver - the receiver's number, any spelling
 * @property {string} [receiverName] - shown on the host's summary
 * @property {string} [message] - shown on the host's summary
 */

/**
 * Why a transfer cannot leave the app, or an empty list.
 * @param {Transfer} transfer
 * @returns {string[]}
 */
const problemsOf = (transfer) => {
  const problems = [];
  if (!Number.isInteger(transfer.amount) || transfer.amount <= 0) {
    problems.push('amount must be a positive integer');
  }
  if (!isSenegalMobile(normaliseMsisdn(transfer.receiver))) {
    problems.push('receiver must be a Senegalese mobile number');
  }
  return problems;
};

/**
 * The exact `transfertMoney` request the SDK sends.
 * @param {Transfer} transfer
 * @returns {{receiver: string, amount: number, receiverName?: string, message?: string}}
 * @throws {HostError} INVALID when the transfer cannot be sent
 */
export const buildTransferPayload = (transfer) => {
  if (!transfer || typeof transfer !== 'object') {
    throw new HostError(ERROR_CODES.INVALID, {
      api: API,
      hostMessage: 'transfer is not an object',
    });
  }
  const problems = problemsOf(transfer);
  if (problems.length) {
    throw new HostError(ERROR_CODES.INVALID, { api: API, hostMessage: problems.join(' · ') });
  }
  const body = { receiver: normaliseMsisdn(transfer.receiver), amount: transfer.amount };
  if (transfer.receiverName) {
    body.receiverName = String(transfer.receiverName);
  }
  if (transfer.message) {
    body.message = String(transfer.message);
  }
  return body;
};

/**
 * Read the host's own wording of a refusal. The generic classifier would
 * file « Pin is required » under REFUSED (a wrong PIN); here it is the user
 * closing the PIN pad, and nothing was debited.
 * @param {*} error
 * @returns {*} the same error, or a sharper one
 */
const sharpen = (error) => {
  if (!isHostError(error)) {
    return error;
  }
  const said = String(error.hostMessage || '').toLowerCase();
  const details = { api: API, raw: error.raw, hostMessage: error.hostMessage };
  if (BACKED_OUT.some((words) => said.includes(words))) {
    return new HostError(ERROR_CODES.CANCELLED, details);
  }
  if (said.includes(UNREADABLE)) {
    return new HostError(ERROR_CODES.INVALID, details);
  }
  return error;
};

/**
 * One transfertMoney call.
 * @param {Object} body - the host request
 * @returns {Promise<{txnid: string|null, sender: string|null, raw: *}>}
 */
const transferOnce = async (body) => {
  try {
    const data = await invoke(API, body, { timeoutMs: PAY_TIMEOUT_MS });
    const txnid = data && data.txnid ? String(data.txnid) : null;
    const sender = data && data.sender ? normaliseMsisdn(data.sender) : null;
    return { txnid, sender, raw: data };
  } catch (error) {
    throw sharpen(error);
  }
};

/**
 * A simulated transfer: a fake txnid after a short delay, or the failure the
 * `transferFails` fixture names (an ERROR_CODES value) so a screen's refusal
 * and uncertainty states can be rehearsed in DevTools.
 * @returns {Promise<{txnid: string, sender: string, raw: null}>}
 */
const simulateTransfer = async () => {
  await delay();
  const fx = fixtures();
  if (fx.transferFails) {
    throw new HostError(fx.transferFails, { api: API, hostMessage: 'simulated' });
  }
  return { txnid: fx.txnid(), sender: normaliseMsisdn(fx.user.msisdn), raw: null };
};

/**
 * Send money from the user to another subscriber. The host shows its own
 * summary (fees included) and asks the PIN; the app never sees either.
 *
 * @param {Transfer} request
 * @returns {Promise<{txnid: string|null, sender: string|null, sent: Object, raw: *}>}
 *   `sent` is the request that left the app.
 * @throws {HostError} INVALID (nothing left the app) · CANCELLED (the user
 *   backed out, nothing debited) · REFUSED (balance, limits) · TIMEOUT ·
 *   HOST_ERROR (`uncertain: true` — verify before offering to pay again) ·
 *   UNAVAILABLE without a host
 */
export const transfer = async (request) => {
  const sent = buildTransferPayload(request);
  const result = isSimulated() ? await simulateTransfer() : await transferOnce(sent);
  return { ...result, sent };
};
