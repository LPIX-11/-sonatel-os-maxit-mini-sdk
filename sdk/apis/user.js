// ============================================================================
// miniSDK.user() — the authenticated host user.
//
// There is no login screen in a Max It mini-program: the host already
// authenticated the user and hands them over. This is the app's ONLY
// identity source. The SDK never invents one: with no host and no
// simulation, it throws UNAVAILABLE, and the app shows its "open the host
// app" state rather than impersonating a fixed number.
// ============================================================================

import { invoke, withRetry, wait } from '../core/invoke.js';
import { isSimulated, fixtures, delay, log } from '../core/config.js';
import { HostError, ERROR_CODES } from '../core/errors.js';
import { identityOf } from '../helpers/msisdn.js';

/** The plugin's api_name. */
export const API = 'userInfos';

/** The plugin is not ready the instant the app launches. */
const WARMUP_MS = 300;

/**
 * @typedef {Object} HostUser
 * @property {string} msisdn - nine digits
 * @property {string|null} fullName
 * @property {string|null} firstName
 * @property {string|null} lastName
 */

/**
 * The host user.
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=4]
 * @returns {Promise<HostUser>}
 * @throws {HostError} UNAVAILABLE when the host has no user to give
 */
export const user = async ({ maxAttempts = 4 } = {}) => {
  if (isSimulated()) {
    await delay();
    return identityOf(fixtures().user);
  }

  await wait(WARMUP_MS);
  const res = await withRetry(
    async () => {
      const answer = await invoke(API, {}, { strict: false });
      const raw = answer && answer.data && answer.data.user;
      if (!raw) {
        throw new HostError(ERROR_CODES.HOST_ERROR, {
          api: API,
          raw: answer,
          hostMessage: 'empty user',
        });
      }
      return raw;
    },
    { maxAttempts, baseDelay: 500 }
  );

  const identity = identityOf(res);
  if (!identity.msisdn) {
    log('warn', API, 'host user has no msisdn');
    throw new HostError(ERROR_CODES.UNAVAILABLE, { api: API, raw: res, hostMessage: 'no msisdn' });
  }
  return identity;
};
