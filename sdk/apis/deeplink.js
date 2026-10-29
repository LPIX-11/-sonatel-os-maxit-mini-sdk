// ============================================================================
// miniSDK.deeplink() — what the host kept from the URL it opened us from.
//
//   https://<host>/mini-apps/<appId>?page=detail&id=42
//   https://<host>/mini-apps/<appId>/page=detail&id=42        (slash form, seen issued)
//
// The host stores everything after the « ? » and starts the MP; the MP asks
// through `getDeeplinkParams` — ONE-SHOT, the host clears its copy once
// read, so the caller publishes what it gets. The launch options' `query`
// is the second source (a DevTools compile condition); pass it in and the
// host's params win.
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
 * `a=1&b=2` (with or without a leading `?` or a path before it) → object.
 * @param {string} text
 * @returns {Object<string, string>}
 */
const parseQueryString = (text) => {
  const raw = String(text || '');
  const start = raw.indexOf('?');
  const query = start >= 0 ? raw.slice(start + 1) : afterAppId(raw);
  const out = {};
  query.split('&').forEach((pair) => {
    if (!pair) {
      return;
    }
    const eq = pair.indexOf('=');
    const key = decodeValue(eq >= 0 ? pair.slice(0, eq) : pair).toLowerCase();
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
 * Whatever shape the params arrive in → one flat object of non-empty strings
 * with lower-cased keys: a query string, the host's `{params}` map, or a
 * launch-options object (`{path, query, scene}`).
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
  if (typeof input !== 'object') {
    return {};
  }
  const looksLikeLaunchOptions =
    'query' in input && (typeof input.query === 'object' || typeof input.query === 'string');
  const source = looksLikeLaunchOptions ? input.query : input;
  if (typeof source === 'string') {
    return parseQueryString(source);
  }
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
    if (key && text) {
      out[key.toLowerCase()] = text;
    }
  });
  return out;
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
 * The deep-link params: the host's one-shot copy merged over the launch
 * query. `null` when nothing arrived (DevTools, an ordinary launch, an older
 * host): that is a normal state, not an error.
 * @param {Object} [options]
 * @param {*} [options.launch] - the launch/show options or their `query`
 * @returns {Promise<Object<string, string>|null>}
 */
export const deeplink = async ({ launch } = {}) => {
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
  const merged = { ...normaliseParams(launch), ...normaliseParams(fromHost) };
  return Object.keys(merged).length ? merged : null;
};
