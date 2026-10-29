// ============================================================================
// miniSDK.scan() — the host camera, with its failures told apart.
//
// `wx.scanCode` answers every failure through the same callback: the user
// closing the camera, the permission refused, a host that cannot open the
// scanner. Each becomes its own code so the page can say what to do next.
//
// Camera-only by default: the album is how a screenshot gets in. If the
// host refuses the camera-only variant outright, the call is retried with
// the album allowed and says so (`albumAllowed`).
// ============================================================================

import { runtime } from '../core/invoke.js';
import { isSimulated, fixtures, delay } from '../core/config.js';
import { HostError, ERROR_CODES, classifyHostFailure } from '../core/errors.js';

/** The wx API name (not a host plugin). */
export const API = 'scanCode';

/**
 * One `wx.scanCode` call.
 * @param {Object} w
 * @param {boolean} cameraOnly
 * @returns {Promise<string>} the trimmed code
 */
const scanOnce = (w, cameraOnly) =>
  new Promise((resolve, reject) => {
    w.scanCode({
      onlyFromCamera: cameraOnly,
      scanType: ['qrCode', 'barCode'],
      success: (res) => resolve(String((res && (res.result || res.code)) || '').trim()),
      fail: (err) => reject(classifyHostFailure(API, err)),
    });
  });

/**
 * @typedef {Object} ScanResult
 * @property {string} code - what the camera read
 * @property {boolean} albumAllowed - the picture may have come from the album
 */

/**
 * Open the host scanner once.
 * @param {Object} [options]
 * @param {boolean} [options.cameraOnly=true] - refuse the album
 * @returns {Promise<ScanResult>}
 * @throws {HostError} CANCELLED · DENIED · UNAVAILABLE · HOST_ERROR
 */
export const scan = async ({ cameraOnly = true } = {}) => {
  if (isSimulated()) {
    await delay();
    return { code: fixtures().scanCode, albumAllowed: !cameraOnly };
  }
  const w = runtime();
  if (!w || typeof w.scanCode !== 'function') {
    throw new HostError(ERROR_CODES.UNAVAILABLE, { api: API });
  }
  try {
    const code = await scanOnce(w, cameraOnly);
    return { code, albumAllowed: !cameraOnly };
  } catch (err) {
    if (cameraOnly && err.code === ERROR_CODES.HOST_ERROR) {
      // The host could not open the camera-only scanner: once more with the
      // album allowed, flagged, so the caller knows a picture may come back.
      const code = await scanOnce(w, false);
      return { code, albumAllowed: true };
    }
    throw err;
  }
};
