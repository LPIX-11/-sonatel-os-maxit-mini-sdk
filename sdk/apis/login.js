// ============================================================================
// miniSDK.login() — the one-time code the auth broker exchanges for a token.
//
// The host mints a short-lived code bound to the user; the app POSTs it to
// `{GATEWAY_URL}/auth/session {code, appId}` and gets its upstream token
// back. No secret ever ships in the mini-program.
// ============================================================================

import { invoke, withRetry, wait } from '../core/invoke.js';
import { isSimulated, fixtures, delay } from '../core/config.js';
import { HostError, ERROR_CODES } from '../core/errors.js';

/** The plugin's api_name. */
export const API = 'login';

/** The host needs a moment after launch before it can mint a code. */
const WARMUP_MS = 1000;

/**
 * A one-time login code.
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3]
 * @returns {Promise<string>}
 * @throws {HostError}
 */
export const login = async ({ maxAttempts = 3 } = {}) => {
  if (isSimulated()) {
    await delay();
    return fixtures().loginCode;
  }

  await wait(WARMUP_MS);
  return withRetry(
    async () => {
      const answer = await invoke(API, {}, { strict: false });
      const code = (answer && answer.data && answer.data.code) || (answer && answer.code);
      if (!code) {
        throw new HostError(ERROR_CODES.HOST_ERROR, {
          api: API,
          raw: answer,
          hostMessage: 'no code',
        });
      }
      return String(code);
    },
    { maxAttempts, baseDelay: 500 }
  );
};
