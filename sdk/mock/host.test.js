import { describe, it, expect, beforeEach } from 'vitest';
import { createMockHost, installMockHost } from './host.js';
import { miniSDK, resetConfig } from '../index.js';

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
});

describe('mock host', () => {
  it('answers the SDK like the phone does, envelopes included', async () => {
    const mock = installMockHost(
      { deeplink: { page: 'demo' } },
      { latencyMs: 0, identicalOnce: true }
    );
    expect(mock).not.toBeNull();
    expect(miniSDK.supports('pay')).toBe(true);

    expect(await miniSDK.login()).toBe('DEV-CODE-0001');
    expect(await miniSDK.contacts()).toHaveLength(3);

    const confirms = [];
    const paid = await miniSDK.pay(
      { amount: 1000, receiver: 1, receiverName: 'M', message: 'm' },
      { onIdentical: async (m) => (confirms.push(m), true) }
    );
    expect(confirms).toHaveLength(1);
    expect(paid).toMatchObject({ txnid: 'MP-MOCK-DUP', confirmedIdentical: true });
    expect(mock.calls.filter((c) => c.api === 'merchantPay')[1].data.caction).toBe('1');

    expect(await miniSDK.deeplink()).toEqual({ page: 'demo' });
    expect(await miniSDK.deeplink()).toBeNull(); // one-shot, like the host
  });

  it('does not replace a real host', () => {
    wx.invokeNativePlugin = () => {};
    expect(installMockHost()).toBeNull();
  });

  it('answers contactList empty when handed a data key, like the real plugin', async () => {
    const mock = createMockHost({}, { latencyMs: 0 });
    const res = await new Promise((resolve) =>
      mock.invokeNativePlugin({ api_name: 'contactList', data: {}, success: resolve })
    );
    expect(res.data.contacts).toEqual([]);
  });
});
