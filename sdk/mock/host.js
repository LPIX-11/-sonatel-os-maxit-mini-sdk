// ============================================================================
// MOCK HOST — a fake `wx.invokeNativePlugin` for DevTools and tests.
//
// TCMPP DevTools has no host, so every plugin call fails there. Installing
// this once in a dev build makes the simulator answer like the phone does,
// envelopes included — so pages that call `wx.invokeNativePlugin` directly
// work too, not only the SDK (the SDK's own `simulate` flag already covers
// the SDK). Never ship it: guard the call with your dev flag.
//
//   import { installMockHost } from './sdk/mock/host.js';
//   if (__DEV__ && !miniSDK.supports('host')) installMockHost();
// ============================================================================

import { DEFAULT_FIXTURES } from '../core/config.js';

/**
 * Build a `invokeNativePlugin` function answering the known plugins.
 * @param {Object} [fixtures] - overrides of DEFAULT_FIXTURES
 * @param {Object} [options]
 * @param {number} [options.latencyMs=120]
 * @param {boolean} [options.identicalOnce=false] - the first merchantPay
 *   answers the identical-transaction prompt
 * @returns {{invokeNativePlugin: Function, calls: Array<Object>, state: Object}}
 */
export const createMockHost = (fixtures = {}, { latencyMs = 120, identicalOnce = false } = {}) => {
  const fx = { ...DEFAULT_FIXTURES, ...fixtures };
  const state = { identicalPending: identicalOnce, deeplinkRead: false };
  const calls = [];
  const ok = (data) => ({ result: 'success', status_code: 200, data });
  const ko = (message, extra = {}) => ({ result: 'fail', status_code: 400, message, ...extra });

  const handlers = {
    userInfos: () => ok({ user: { ...fx.user } }),
    login: () => ok({ code: fx.loginCode }),
    merchantPay: (data) => {
      if (data.serviceId !== undefined && data.idService !== undefined) {
        return ko('serviceId and idService are exclusive');
      }
      if (!data.payload || typeof data.payload !== 'object') {
        return ko('payload block missing');
      }
      if (state.identicalPending && !data.txnid) {
        state.identicalPending = false;
        return ko('Vous venez d effectuer une transaction identique. Continuer ?', {
          txnid: 'MP-MOCK-DUP',
        });
      }
      if (data.txnid && data.caction !== '1') {
        return ko('caction must be the string "1"');
      }
      return ok({ txnid: data.txnid || fx.txnid() });
    },
    contactList: (data) =>
      data !== undefined
        ? ok({ contacts: [] })
        : ok({ contacts: fx.contacts.map((c) => ({ ...c })) }),
    block_screen: () => ok({}),
    getDeeplinkParams: () => {
      if (state.deeplinkRead || !fx.deeplink) {
        return ok({ params: null });
      }
      state.deeplinkRead = true; // one-shot, like the host
      return ok({ params: { ...fx.deeplink } });
    },
  };

  const invokeNativePlugin = (call) => {
    calls.push({ api: call.api_name, data: call.data });
    const handler = handlers[call.api_name];
    setTimeout(() => {
      if (!handler) {
        if (typeof call.fail === 'function') {
          call.fail({ errMsg: `invokeNativePlugin:fail unknown api ${call.api_name}` });
        }
        return;
      }
      const answer = handler(call.data);
      if (answer.result === 'success') {
        call.success && call.success(answer);
      } else {
        // The phone's host answers failures through `success` with a failure
        // envelope; mirror that.
        call.success && call.success(answer);
      }
    }, latencyMs);
  };

  return { invokeNativePlugin, calls, state };
};

/**
 * Install the mock on the `wx` global when the runtime has no host.
 * @param {Object} [fixtures]
 * @param {Object} [options] - see createMockHost
 * @returns {ReturnType<typeof createMockHost>|null} the mock, or null when a real host exists
 */
export const installMockHost = (fixtures, options) => {
  if (typeof wx === 'undefined') {
    return null;
  }
  if (typeof wx.invokeNativePlugin === 'function' && !wx.invokeNativePlugin.__mock) {
    return null;
  }
  const mock = createMockHost(fixtures, options);
  mock.invokeNativePlugin.__mock = true;
  wx.invokeNativePlugin = mock.invokeNativePlugin;
  return mock;
};
