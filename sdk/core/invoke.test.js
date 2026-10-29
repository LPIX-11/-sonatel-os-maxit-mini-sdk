import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke, withRetry, hasHost } from './invoke.js';
import { configure, resetConfig } from './config.js';

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
});
afterEach(() => vi.useRealTimers());

describe('invoke', () => {
  it('rejects UNAVAILABLE without a host', async () => {
    expect(hasHost()).toBe(false);
    await expect(invoke('userInfos', {})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('resolves res.data on a success envelope (strict) and the raw answer when not strict', async () => {
    wx.invokeNativePlugin = vi.fn((c) =>
      c.success({ result: 'success', status_code: 200, data: { x: 1 } })
    );
    expect(await invoke('a', {})).toEqual({ x: 1 });
    expect(await invoke('a', {}, { strict: false })).toEqual({
      result: 'success',
      status_code: 200,
      data: { x: 1 },
    });
  });

  it('sends NO data key when data is undefined (contactList answers empty otherwise)', async () => {
    wx.invokeNativePlugin = vi.fn((c) =>
      c.success({ result: 'success', status_code: 200, data: {} })
    );
    await invoke('contactList', undefined);
    expect(wx.invokeNativePlugin.mock.calls[0][0]).not.toHaveProperty('data');
    await invoke('userInfos', {});
    expect(wx.invokeNativePlugin.mock.calls[1][0]).toHaveProperty('data');
  });

  it('turns a failure envelope on success into a classified HostError with the raw payload', async () => {
    const envelope = { result: 'fail', status_code: 400, message: 'Solde insuffisant', txnid: 'T' };
    wx.invokeNativePlugin = vi.fn((c) => c.success(envelope));
    await expect(invoke('merchantPay', { a: 1 })).rejects.toMatchObject({
      code: 'REFUSED',
      raw: envelope,
      hostMessage: 'Solde insuffisant',
    });
  });

  it('turns the fail callback into a classified HostError', async () => {
    wx.invokeNativePlugin = vi.fn((c) => c.fail({ errMsg: 'invokeNativePlugin:fail cancel' }));
    await expect(invoke('x', {})).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('times out when the host never answers, and ignores a late answer', async () => {
    vi.useFakeTimers();
    let late;
    wx.invokeNativePlugin = vi.fn((c) => {
      late = c;
    });
    const p = invoke('x', {}, { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT', uncertain: true });
    expect(() => late.success({ result: 'success', status_code: 200 })).not.toThrow();
  });

  it('uses the configured timeout', async () => {
    vi.useFakeTimers();
    configure({ timeoutMs: 50 });
    wx.invokeNativePlugin = vi.fn(() => {});
    const p = invoke('x', {});
    vi.advanceTimersByTime(60);
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('catches a throwing host', async () => {
    wx.invokeNativePlugin = vi.fn(() => {
      throw new Error('boom');
    });
    await expect(invoke('x', {})).rejects.toMatchObject({ code: 'HOST_ERROR' });
  });
});

describe('withRetry', () => {
  it('retries with backoff and returns the first success', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(new Error('1')).mockResolvedValueOnce('ok');
    const p = withRetry(fn, { maxAttempts: 3, baseDelay: 10 });
    await vi.runAllTimersAsync();
    expect(await p).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never retries a cancel, a denial or an absent host', async () => {
    for (const code of ['CANCELLED', 'DENIED', 'UNAVAILABLE']) {
      const fn = vi.fn().mockRejectedValue(Object.assign(new Error(), { code }));
      await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toMatchObject({ code });
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('throws the last error after the attempts are spent', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('still down'));
    const p = withRetry(fn, { maxAttempts: 3, baseDelay: 1 });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow('still down');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
