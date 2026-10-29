// ============================================================================
// INVOKE — the one place wx.invokeNativePlugin is called.
//
// Turns the host's callback API into a Promise, validates the
// `{result, status_code, data}` envelope when asked, keeps the host's RAW
// payload on every rejection (a failed call can still carry fields the
// caller needs — the payment retry reads the txnid off exactly this), and
// times out: a host that never answers must not hang a page forever.
// ============================================================================

import { HostError, ERROR_CODES, classifyHostFailure, hostMessageOf } from './errors.js';
import { timeoutMs as configuredTimeout, log } from './config.js';

/** @returns {Object|null} the wx global, null outside the runtime */
export const runtime = () => (typeof wx !== 'undefined' ? wx : null);

/** @returns {boolean} whether a host with native plugins is present */
export const hasHost = () => {
  const w = runtime();
  return Boolean(w && typeof w.invokeNativePlugin === 'function');
};

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call one host plugin.
 *
 * @param {string} api - the plugin's api_name
 * @param {Object} [data] - the payload; `undefined` sends NO data key (some
 *   plugins answer empty when handed one — contactList)
 * @param {Object} [options]
 * @param {boolean} [options.strict=true] - validate the envelope and resolve
 *   `res.data`; false resolves the raw answer
 * @param {number} [options.timeoutMs] - defaults to the configured timeout
 * @returns {Promise<*>}
 * @throws {HostError}
 */
export const invoke = (api, data, { strict = true, timeoutMs } = {}) => {
  const w = runtime();
  if (!w || typeof w.invokeNativePlugin !== 'function') {
    return Promise.reject(new HostError(ERROR_CODES.UNAVAILABLE, { api }));
  }
  const limit = timeoutMs || configuredTimeout();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        log('warn', api, 'host did not answer in time', { timeoutMs: limit });
        reject(new HostError(ERROR_CODES.TIMEOUT, { api }));
      }
    }, limit);
    const done = (fn) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const call = { api_name: api };
    if (data !== undefined) {
      call.data = data;
    }
    call.success = done((res) => {
      if (!strict) {
        resolve(res);
        return;
      }
      if (res && res.result === 'success' && res.status_code === 200) {
        resolve(res.data);
        return;
      }
      // A "success" callback carrying a failure envelope: the host's way of
      // saying no. Classified by its words, raw kept.
      log('warn', api, 'host answered a failure envelope', { hostMessage: hostMessageOf(res) });
      reject(classifyHostFailure(api, res));
    });
    call.fail = done((err) => {
      log('warn', api, 'host call failed', { hostMessage: hostMessageOf(err) });
      reject(classifyHostFailure(api, err));
    });

    try {
      w.invokeNativePlugin(call);
    } catch (err) {
      done(reject)(classifyHostFailure(api, err));
    }
  });
};

/**
 * Retry an async function with exponential backoff. Native plugins may not
 * be ready at app launch, so the first attempt legitimately fails.
 *
 * @param {() => Promise<*>} fn
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3]
 * @param {number} [options.baseDelay=500] - ms, doubles each retry
 * @param {(err: Error) => boolean} [options.shouldRetry] - default: never on
 *   CANCELLED, DENIED or UNAVAILABLE
 * @returns {Promise<*>}
 */
export const withRetry = async (fn, { maxAttempts = 3, baseDelay = 500, shouldRetry } = {}) => {
  const retryable =
    shouldRetry ||
    ((err) =>
      !(
        err &&
        (err.code === ERROR_CODES.CANCELLED ||
          err.code === ERROR_CODES.DENIED ||
          err.code === ERROR_CODES.UNAVAILABLE)
      ));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && retryable(err)) {
        await wait(baseDelay * Math.pow(2, attempt - 1));
      } else {
        break;
      }
    }
  }
  throw lastError;
};
