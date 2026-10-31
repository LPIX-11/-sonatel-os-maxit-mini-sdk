// ============================================================================
// miniSDK.deeplink() — what the host kept from the URL it opened us from.
//
//   https://<host>/miniapps/<appId>??page=detail&id=42          (as issued since 2026-10-30)
//   https://<host>/mini-apps/<appId>?page=detail&id=42
//   https://<host>/mini-apps/<appId>/page=detail&id=42          (slash form, seen issued)
//
// Two doors, the host's first. (1) The custom host API `getDeeplinkParams`
// — ONE-SHOT, the host clears its copy once read, so the caller publishes
// what it gets. (2) Since 2026-10-30 the host starts the MP with TCMPP's
// `MiniStartOptions.params` — a STRING the runtime hands to App.onLaunch /
// onShow as `options.referrerInfo.extraData` (and `options.extendData`),
// NOT as `options.query`; pass the whole options object in and the SDK
// reads `path?…` → `query` → `extraData` → `extendData`, the later winning.
//
// Shapes read: a query string with one or TWO leading `?` (the issued link
// has `??` — a key never comes out as `?msisdn`), a `k=v&k=v` tail glued to
// the app id (the host's router captures `:id` with `.*`), a JSON object
// serialised in the params string, a map with mixed-case keys.
//
// The params are DATA, never identity nor price: a `msisdn` does not
// replace the host's user, a `montant` never prices anything.
// ============================================================================

import { invoke } from '../core/invoke.js';
import { isSimulated, fixtures, log } from '../core/config.js';

/** The plugin's api_name. */
export const API = 'getDeeplinkParams';

/**
 * Decode one value the way a browser would.
 * @param {*} value
 * @returns {string}
 */
const decodeValue = (value) => {
  const text = String(value === null || value === undefined ? '' : value).replace(/\+/g, ' ');
  try {
    return decodeURIComponent(text).trim();
  } catch (_e) {
    return text.trim();
  }
};

/**
 * `<appId>/a=1&b=2` → `a=1&b=2`.
 * @param {string} text
 * @returns {string}
 */
const afterAppId = (text) => {
  const eq = text.indexOf('=');
  const slash = text.lastIndexOf('/', eq < 0 ? text.length : eq);
  return slash >= 0 ? text.slice(slash + 1) : text;
};

/**
 * A param name as a router reads it: stray `?`, `&` and `/` stripped from
 * the front (the `??` link yields `?msisdn`), lower-cased.
 * @param {string} key
 * @returns {string}
 */
const cleanKey = (key) =>
  decodeValue(key)
    .replace(/^[?&/\s]+/, '')
    .toLowerCase();

/**
 * A JSON object serialised in the params string (`{"id":"42"}`), or null.
 * @param {string} text
 * @returns {Object|null}
 */
const parseJsonObject = (text) => {
  const raw = String(text || '').trim();
  if (!raw.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_e) {
    return null;
  }
};

/**
 * `a=1&b=2` (with or without leading `?`s, or a path before them) → object.
 * @param {string} text
 * @returns {Object<string, string>}
 */
const parseQueryString = (text) => {
  const raw = String(text || '');
  const json = parseJsonObject(raw);
  if (json) {
    return fromMap(json);
  }
  const start = raw.indexOf('?');
  const query = (start >= 0 ? raw.slice(start) : afterAppId(raw)).replace(/^[?&/\s]+/, '');
  const out = {};
  query.split('&').forEach((pair) => {
    if (!pair) {
      return;
    }
    const eq = pair.indexOf('=');
    const key = cleanKey(eq >= 0 ? pair.slice(0, eq) : pair);
    const value = eq >= 0 ? decodeValue(pair.slice(eq + 1)) : '';
    if (key && value) {
      out[key] = value;
    }
  });
  return out;
};

/** Does this text carry `k=v` pairs of its own (the slash-form tail)? */
const isGlued = (text) => /[^&=]+=[^&=]*&[^&=]+=/.test(text) || /\/[^/=&]+=/.test(text);

/**
 * A params map → flat object of non-empty strings with clean keys; a glued
 * `k=v&k=v` key or value is expanded into pairs.
 * @param {Object} source
 * @returns {Object<string, string>}
 */
const fromMap = (source) => {
  const out = {};
  Object.keys(source || {}).forEach((rawKey) => {
    let value = source[rawKey];
    if (Array.isArray(value)) {
      value = value[0];
    }
    if (value === null || value === undefined || typeof value === 'object') {
      return;
    }
    const key = decodeValue(rawKey);
    const text = decodeValue(value);
    if (isGlued(text)) {
      Object.assign(out, parseQueryString(afterAppId(text)));
      return;
    }
    if (isGlued(key)) {
      Object.assign(out, parseQueryString(afterAppId(text ? `${key}=${text}` : key)));
      return;
    }
    const clean = cleanKey(key);
    if (clean && text) {
      out[clean] = text;
    }
  });
  return out;
};

/**
 * One source of a launch-options object, whatever its type: a map, a query
 * string, a JSON string — or nothing.
 * @param {*} source
 * @returns {Object<string, string>}
 */
const fromSource = (source) => {
  if (!source) {
    return {};
  }
  if (typeof source === 'string') {
    return parseQueryString(source);
  }
  return typeof source === 'object' && !Array.isArray(source) ? fromMap(source) : {};
};

/**
 * Is this object the runtime's launch/show options rather than a params map?
 * @param {Object} input
 * @returns {boolean}
 */
const looksLikeLaunchOptions = (input) =>
  ['query', 'referrerInfo', 'extendData', 'scene'].some((k) => k in input) ||
  (typeof input.path === 'string' && /^pages\//.test(input.path));

/**
 * `App.onLaunch` / `onShow` options → params: `path?…`, then `query`, then
 * what the host passed through `MiniStartOptions.params`
 * (`referrerInfo.extraData`, `extendData`) — the later wins.
 * @param {Object} options
 * @returns {Object<string, string>}
 */
const fromLaunchOptions = (options) => {
  const path = typeof options.path === 'string' ? options.path : '';
  const referrer =
    options.referrerInfo && typeof options.referrerInfo === 'object' ? options.referrerInfo : {};
  return {
    ...(path.indexOf('?') >= 0 ? parseQueryString(path) : {}),
    ...fromSource(options.query),
    ...fromSource(referrer.extraData),
    ...fromSource(options.extendData),
  };
};

/**
 * Whatever shape the params arrive in → one flat object of non-empty strings
 * with clean lower-cased keys: a query string (one or two leading `?`), a
 * JSON string, the host's `{params}` map, or a launch-options object
 * (`{path, query, scene, referrerInfo, extendData}`).
 * @param {*} input
 * @returns {Object<string, string>}
 */
export const normaliseParams = (input) => {
  if (!input) {
    return {};
  }
  if (typeof input === 'string') {
    return parseQueryString(input);
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return looksLikeLaunchOptions(input) ? fromLaunchOptions(input) : fromMap(input);
};

/** Keys whose values are a phone number and must be masked in any log or toast. */
const PHONE_KEY = /msisdn|phone|tel|numero/;

/**
 * The params with phone numbers masked — what telemetry and a toast may show.
 * @param {Object<string, string>} params
 * @returns {Object<string, string>}
 */
export const maskParams = (params) => {
  const out = {};
  Object.keys(params || {}).forEach((key) => {
    const value = String(params[key]);
    if (PHONE_KEY.test(key)) {
      const digits = value.replace(/\D/g, '');
      out[key] = digits.length < 6 ? '•••' : `${digits.slice(0, 2)}•••••${digits.slice(-2)}`;
    } else {
      out[key] = value;
    }
  });
  return out;
};

/**
 * A stable fingerprint of a resolved param set, for the one-shot guard.
 * @param {Object<string, string>} params
 * @returns {string}
 */
const fingerprint = (params) =>
  JSON.stringify(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k]])
  );

/**
 * The last param set `deeplink()` handed out. The launch-options door is NOT
 * one-shot the way the host's API is: the runtime repeats the SAME options to
 * `App.onShow` on every return from background, so an app reading them each
 * time would re-route on a mere app switch. The SDK remembers the last set and
 * answers `null` for a repeat — the host's one-shot, extended to both doors.
 */
let lastConsumed = null;

/** Forget the last-consumed deep link (a fresh cold launch, or a test). */
export const resetDeeplink = () => {
  lastConsumed = null;
};

/**
 * The deep-link params: the host's one-shot API copy merged over the launch
 * options (where `MiniStartOptions.params` arrives, via
 * `referrerInfo.extraData` / `extendData`). `null` when nothing arrived
 * (DevTools, an ordinary launch, an older host) — a normal state, not an error
 * — and `null` for a REPEAT of the last link, so calling it on every `onShow`
 * is safe and never double-routes.
 * @param {Object} [options]
 * @param {*} [options.launch] - the FULL launch/show options
 *   (`{path, query, scene, referrerInfo, extendData}`), or a query string
 * @param {boolean} [options.once=true] - answer `null` when the resolved params
 *   match the last ones handed out (one-shot across `onShow` repeats). Pass
 *   `false` to always resolve.
 * @returns {Promise<Object<string, string>|null>}
 */
export const deeplink = async ({ launch, once = true } = {}) => {
  let fromHost = null;
  if (isSimulated()) {
    fromHost = fixtures().deeplink;
  } else {
    try {
      const res = await invoke(API, {}, { strict: false });
      const params = res && res.data && res.data.params;
      fromHost = params && typeof params === 'object' && !Array.isArray(params) ? params : null;
    } catch (err) {
      // No host, an older host, or nothing pending: a normal state.
      log('debug', API, 'no host params', { code: err && err.code });
    }
  }
  const hostParams = normaliseParams(fromHost);
  const merged = { ...normaliseParams(launch), ...hostParams };
  if (!Object.keys(merged).length) {
    return null;
  }
  if (once) {
    const fp = fingerprint(merged);
    // The host's door is one-shot on ITS side: it hands the params over once
    // per tap and clears them. So anything it answered is a FRESH tap, even
    // when the words are the same as last time — only the launch options
    // repeat on a resume, and only they are de-duplicated.
    if (fp === lastConsumed && !Object.keys(hostParams).length) {
      log('debug', API, 'deep link already handled; skipping the onShow repeat');
      return null;
    }
    lastConsumed = fp;
  }
  return merged;
};
