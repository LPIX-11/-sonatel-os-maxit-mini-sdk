// ============================================================================
// CONFIGURATION — one call at boot, then every API reads it.
//
//   miniSDK.configure({
//     simulate: __DEV__ && SIMULATE,   // answer fixtures instead of calling the host
//     fixtures: { user: {…} },         // override any default fixture
//     log: (level, api, message, ctx) => …,   // your logger; silent by default
//     confirm: (message) => Promise<boolean>, // your dialog for the identical prompt
//     timeoutMs: 30000,
//   });
//
// Nothing here reads the app's constants: the app decides what "dev" means.
// ============================================================================

/** The canned answers a simulated host gives. Every one can be overridden. */
export const DEFAULT_FIXTURES = Object.freeze({
  user: Object.freeze({ msisdn: '770000001', firstName: 'Dev', lastName: 'User' }),
  loginCode: 'DEV-CODE-0001',
  /** @returns {string} a fresh fake transaction id */
  txnid: () => `MP-DEV-${Date.now()}`,
  /** Make the first payment of the process answer the identical prompt. */
  identicalOnce: false,
  contacts: Object.freeze([
    { name: 'Abdoulaye Ndiaye', msisdn: ['777917330'] },
    { name: 'Fatou Sow', msisdn: ['776335377'] },
    { name: 'Ousmane Diop', msisdn: ['775236991'] },
  ]),
  /** @type {Object<string,string>|null} what a deep link carried; null = none */
  deeplink: null,
  scanCode: 'DEV-SCAN-0001',
  /** Simulated latency, ms. */
  latencyMs: 300,
});

const state = {
  simulate: false,
  fixtures: { ...DEFAULT_FIXTURES },
  log: null,
  confirm: null,
  timeoutMs: 30000,
};

/**
 * Configure the SDK. Partial: only the keys given change.
 * @param {Object} [options]
 * @param {boolean} [options.simulate]
 * @param {Object} [options.fixtures]
 * @param {(level: string, api: string, message: string, ctx?: Object) => void} [options.log]
 * @param {(message: string) => Promise<boolean>} [options.confirm]
 * @param {number} [options.timeoutMs]
 * @returns {void}
 */
export const configure = (options = {}) => {
  if (typeof options.simulate === 'boolean') {
    state.simulate = options.simulate;
  }
  if (options.fixtures && typeof options.fixtures === 'object') {
    state.fixtures = { ...state.fixtures, ...options.fixtures };
  }
  if (typeof options.log === 'function' || options.log === null) {
    state.log = options.log;
  }
  if (typeof options.confirm === 'function' || options.confirm === null) {
    state.confirm = options.confirm;
  }
  if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    state.timeoutMs = options.timeoutMs;
  }
};

/** @returns {boolean} */
export const isSimulated = () => state.simulate;

/** @returns {Object} the fixtures in force */
export const fixtures = () => state.fixtures;

/** @returns {number} */
export const timeoutMs = () => state.timeoutMs;

/** @returns {((message: string) => Promise<boolean>)|null} */
export const confirmHandler = () => state.confirm;

/**
 * Log through the app's logger when one was given. Never throws.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} api
 * @param {string} message
 * @param {Object} [ctx]
 */
export const log = (level, api, message, ctx) => {
  if (!state.log) {
    return;
  }
  try {
    state.log(level, api, message, ctx);
  } catch (_e) {
    // A logger must never break the SDK.
  }
};

/** Test hook: back to defaults. */
export const resetConfig = () => {
  state.simulate = false;
  state.fixtures = { ...DEFAULT_FIXTURES };
  state.log = null;
  state.confirm = null;
  state.timeoutMs = 30000;
};

/**
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
export const delay = (ms = state.fixtures.latencyMs) =>
  new Promise((resolve) => setTimeout(resolve, ms));
