// ============================================================================
// miniSDK.screen — keep a sensitive screen (a paid QR, a code) out of
// screenshots and recordings.
//
//   await miniSDK.screen.protect(true);    // when the code is painted
//   await miniSDK.screen.protect(false);   // when it leaves — ALWAYS
//
// Two masks, one call: Android's `setVisualEffectOnCapture('hidden')`
// (FLAG_SECURE — screenshots, recordings and the switcher thumbnail go
// black) and, on iOS where that runtime call masks nothing, the host's
// `block_screen` plugin. The host's mask is HOST-WIDE and does not lift
// itself when the view closes, so `false` is as important a call as `true`.
//
// Never simulated, deliberately: blocking a screenshot has no cost, and a
// dev shortcut once hid a non-working plugin for months.
// ============================================================================

import { invoke, runtime, hasHost } from '../core/invoke.js';
import { log } from '../core/config.js';

/** The plugin's api_name. */
export const API = 'block_screen';

/** @returns {'ios'|'android'|'devtools'} */
export const platform = () => {
  try {
    const w = runtime();
    const p = w && typeof w.getSystemInfoSync === 'function' && w.getSystemInfoSync().platform;
    return p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'devtools';
  } catch (_e) {
    return 'devtools';
  }
};

/**
 * The host's capture mask (iOS).
 * @param {boolean} activate
 * @returns {Promise<boolean>} true when the host accepted
 */
export const block = async (activate = true) => {
  if (!hasHost()) {
    return false;
  }
  try {
    const res = await invoke(API, { activate: activate === true }, { strict: false });
    return Boolean(res && res.result === 'success' && res.status_code === 200);
  } catch (err) {
    log('warn', API, 'block_screen failed', { code: err && err.code });
    return false;
  }
};

/**
 * The runtime's capture mask (Android).
 * @param {boolean} hidden
 * @returns {Promise<boolean>}
 */
const visualEffect = (hidden) =>
  new Promise((resolve) => {
    const w = runtime();
    if (!w || typeof w.setVisualEffectOnCapture !== 'function') {
      resolve(false);
      return;
    }
    w.setVisualEffectOnCapture({
      visualEffect: hidden ? 'hidden' : 'none',
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });

/**
 * Mask (or unmask) the screen in captures, on whichever platform this is.
 * @param {boolean} on
 * @returns {Promise<{platform: string, masked: boolean}>}
 */
export const protect = async (on = true) => {
  const p = platform();
  const masked = p === 'ios' ? await block(on) : await visualEffect(on);
  log('info', API, `capture mask ${on ? 'on' : 'off'}`, { platform: p, masked });
  return { platform: p, masked };
};

export const screen = { protect, block, platform };
