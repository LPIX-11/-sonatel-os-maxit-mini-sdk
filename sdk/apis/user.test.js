import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { user } from './user.js';
import { login } from './login.js';
import { configure, resetConfig } from '../core/config.js';

const ok = (data) => ({ result: 'success', status_code: 200, data });

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
  configure({ fixtures: { latencyMs: 0 } });
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/** Run an SDK call under fake timers to its end. */
const run = async (promise) => {
  await vi.runAllTimersAsync();
  return promise;
};

describe('user', () => {
  it('returns the host user normalised: nine digits, a real name', async () => {
    wx.invokeNativePlugin = vi.fn((c) =>
      c.success(
        ok({ user: { msisdn: '+221 77 000 00 01', firstName: ' Fatou ', lastName: undefined } })
      )
    );
    const p = user();
    expect(await run(p)).toEqual({
      msisdn: '770000001',
      fullName: 'Fatou',
      firstName: 'Fatou',
      lastName: null,
    });
  });

  it('retries while the plugin is not ready, then succeeds', async () => {
    let n = 0;
    wx.invokeNativePlugin = vi.fn((c) => {
      n += 1;
      c.success(
        n < 3 ? ok({}) : ok({ user: { msisdn: '771234567', firstName: 'A', lastName: 'B' } })
      );
    });
    const p = user();
    expect((await run(p)).msisdn).toBe('771234567');
    expect(n).toBe(3);
  });

  it('never invents an identity: UNAVAILABLE without a host, or without an msisdn', async () => {
    const p1 = user();
    p1.catch(() => {});
    await expect(run(p1)).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    wx.invokeNativePlugin = vi.fn((c) => c.success(ok({ user: { firstName: 'X' } })));
    const p2 = user({ maxAttempts: 1 });
    p2.catch(() => {});
    await expect(run(p2)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('answers the fixture when simulated, overridable', async () => {
    configure({
      simulate: true,
      fixtures: { user: { msisdn: '221780000000', firstName: 'Awa', lastName: 'Bâ' } },
    });
    const p = user();
    expect(await run(p)).toMatchObject({ msisdn: '780000000', fullName: 'Awa Bâ' });
  });
});

describe('login', () => {
  it('returns the one-time code, wherever the host put it', async () => {
    wx.invokeNativePlugin = vi.fn((c) => c.success(ok({ code: 'ABC' })));
    expect(await run(login())).toBe('ABC');
    wx.invokeNativePlugin = vi.fn((c) => c.success({ code: 123 }));
    expect(await run(login())).toBe('123');
  });

  it('fails HOST_ERROR when the host returns no code, after its attempts', async () => {
    wx.invokeNativePlugin = vi.fn((c) => c.success(ok({})));
    const p = login({ maxAttempts: 2 });
    p.catch(() => {});
    await expect(run(p)).rejects.toMatchObject({ code: 'HOST_ERROR' });
    expect(wx.invokeNativePlugin).toHaveBeenCalledTimes(2);
  });

  it('answers the fixture when simulated', async () => {
    configure({ simulate: true });
    expect(await run(login())).toBe('DEV-CODE-0001');
  });
});
