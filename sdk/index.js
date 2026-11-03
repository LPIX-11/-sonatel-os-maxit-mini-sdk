// ============================================================================
// miniSDK — the Max It host, as one object.
//
//   import { miniSDK } from './sdk/index.js';
//
//   miniSDK.configure({ simulate: __DEV__ && SIMULATE, log });
//   const user  = await miniSDK.user();            // { msisdn, fullName, … }
//   const code  = await miniSDK.login();           // one-time code for the auth broker
//   const { txnid } = await miniSDK.pay({ amount, receiver, receiverName, message, serviceId });
//   const book  = await miniSDK.contacts();        // [{ name, msisdn: [] }]
//   const link  = await miniSDK.deeplink({ launch: options });   // { page, id, … } | null
//   const read  = await miniSDK.scan();            // { code }
//   await miniSDK.screen.protect(true);
//
// Every call resolves plain data or rejects a HostError with a stable `code`
// (miniSDK.ERROR_CODES), a French user-safe `message`, the host's `raw`
// payload and, on a payment, `uncertain` when the money may have moved.
//
// Vendored: this folder is copied into the mini-program by
// `npx @sonatel-os/maxit-mini-sdk update`. Do not edit it in place; a fix
// belongs in the SDK repo so every app gets it.
// ============================================================================

import { configure, resetConfig, isSimulated, DEFAULT_FIXTURES } from './core/config.js';
import { hasHost, runtime, invoke, withRetry } from './core/invoke.js';
import { HostError, ERROR_CODES, isHostError } from './core/errors.js';
import { user, API as USER_API } from './apis/user.js';
import { login, API as LOGIN_API } from './apis/login.js';
import {
  pay,
  buildHostPayload,
  readIdenticalPrompt,
  CONTINUE_ACTION,
  API as PAY_API,
} from './apis/pay.js';
import { contacts, normaliseContacts, API as CONTACTS_API } from './apis/contacts.js';
import {
  deeplink,
  resetDeeplink,
  normaliseParams,
  maskParams,
  API as DEEPLINK_API,
} from './apis/deeplink.js';
import { screen, API as SCREEN_API } from './apis/screen.js';
import { scan, API as SCAN_API } from './apis/scan.js';
import { normaliseMsisdn, isSenegalMobile, identityOf } from './helpers/msisdn.js';

/** The SDK version, kept in step with sdk/VERSION by the release script. */
export const VERSION = '0.1.5';

/** The host plugins this SDK speaks to, by SDK method. */
export const HOST_APIS = Object.freeze({
  user: USER_API,
  login: LOGIN_API,
  pay: PAY_API,
  contacts: CONTACTS_API,
  deeplink: DEEPLINK_API,
  screen: SCREEN_API,
  scan: SCAN_API,
});

/**
 * Whether a capability can be called here. Host plugins cannot be detected
 * one by one (the host exposes no registry), so `supports('pay')` answers
 * "a host is present"; a wx-level API (`scan`) is checked for real.
 * @param {'host'|keyof typeof HOST_APIS} capability
 * @returns {boolean}
 */
export const supports = (capability) => {
  if (isSimulated()) {
    return true;
  }
  if (capability === 'scan') {
    const w = runtime();
    return Boolean(w && typeof w.scanCode === 'function');
  }
  return hasHost();
};

export const miniSDK = Object.freeze({
  VERSION,
  configure,
  supports,
  user,
  login,
  pay,
  contacts,
  deeplink,
  resetDeeplink,
  scan,
  screen,
  HostError,
  ERROR_CODES,
  isHostError,
  HOST_APIS,
  /** Lower-level pieces, for the rare plugin the SDK does not wrap yet. */
  raw: Object.freeze({ invoke, withRetry, hasHost }),
  /** Pure helpers an app may reuse. */
  helpers: Object.freeze({
    normaliseMsisdn,
    isSenegalMobile,
    identityOf,
    normaliseContacts,
    normaliseParams,
    maskParams,
    readIdenticalPrompt,
    buildHostPayload,
    CONTINUE_ACTION,
  }),
});

export default miniSDK;

export {
  configure,
  resetConfig,
  DEFAULT_FIXTURES,
  user,
  login,
  pay,
  contacts,
  deeplink,
  resetDeeplink,
  scan,
  screen,
  HostError,
  ERROR_CODES,
  isHostError,
  invoke,
  withRetry,
  hasHost,
  normaliseMsisdn,
  isSenegalMobile,
  identityOf,
  normaliseContacts,
  normaliseParams,
  maskParams,
  readIdenticalPrompt,
  buildHostPayload,
  CONTINUE_ACTION,
};
