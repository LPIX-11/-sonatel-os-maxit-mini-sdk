import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transfer, buildTransferPayload, API } from './transfer.js';
import { configure, resetConfig } from '../core/config.js';
import { installMockHost } from '../mock/host.js';

const ORDER = { amount: 30000, receiver: '+221 77 000 00 02', receiverName: 'Fatou Sow' };

/** Answer the plugin through `success` with a failure envelope. */
const hostSays = (message) => {
  wx.invokeNativePlugin = vi.fn((c) =>
    c.success({ status_code: 400, result: 'fail', txnid: null, method: API, message })
  );
};

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
  configure({ fixtures: { latencyMs: 0 } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildTransferPayload', () => {
  it('sends the receiver in nine digits and the amount, and nothing the host ignores', () => {
    expect(buildTransferPayload({ ...ORDER, sender: '770000001', fees: 250 })).toEqual({
      receiver: '770000002',
      amount: 30000,
      receiverName: 'Fatou Sow',
    });
  });

  it('carries a message when there is one', () => {
    expect(buildTransferPayload({ ...ORDER, message: 'Loyer' })).toMatchObject({
      message: 'Loyer',
    });
  });

  it.each([
    ['a zero amount', { amount: 0 }],
    ['a negative amount', { amount: -5 }],
    ['a fractional amount', { amount: 10.5 }],
    ['an amount as text', { amount: '30000' }],
    ['a landline', { receiver: '338000000' }],
    ['a short number', { receiver: '7700000' }],
    ['no receiver', { receiver: undefined }],
  ])('refuses %s before anything leaves the app', (_what, patch) => {
    expect(() => buildTransferPayload({ ...ORDER, ...patch })).toThrow(
      expect.objectContaining({ code: 'INVALID', uncertain: false })
    );
  });

  it('refuses a transfer that is not an object', () => {
    expect(() => buildTransferPayload(null)).toThrow(expect.objectContaining({ code: 'INVALID' }));
  });
});

describe('transfer — against the host', () => {
  it('resolves the transaction id and the sender the host debited', async () => {
    const host = installMockHost({
      user: { msisdn: '+221 77 000 00 01', firstName: 'A', lastName: 'D' },
    });
    const out = await transfer(ORDER);
    expect(out.txnid).toEqual(expect.any(String));
    expect(out.sender).toBe('770000001');
    expect(out.sent).toEqual({ receiver: '770000002', amount: 30000, receiverName: 'Fatou Sow' });
    expect(host.calls).toEqual([{ api: API, data: out.sent }]);
  });

  it('is still a success when the host gives no transaction id', async () => {
    wx.invokeNativePlugin = vi.fn((c) =>
      c.success({ status_code: 200, result: 'success', data: { code: 'SUCCEED', txnid: null } })
    );
    await expect(transfer(ORDER)).resolves.toMatchObject({ txnid: null, sender: null });
  });

  it.each([['User cancelled'], ['Pin is required']])(
    'reads « %s » as the user backing out: CANCELLED, nothing debited',
    async (message) => {
      hostSays(message);
      await expect(transfer(ORDER)).rejects.toMatchObject({ code: 'CANCELLED', uncertain: false });
    }
  );

  it('reads « Input body » as INVALID', async () => {
    hostSays('Input body');
    await expect(transfer(ORDER)).rejects.toMatchObject({ code: 'INVALID', uncertain: false });
  });

  it('reads a balance refusal as REFUSED', async () => {
    hostSays('Solde insuffisant pour effectuer cette opération');
    await expect(transfer(ORDER)).rejects.toMatchObject({ code: 'REFUSED', uncertain: false });
  });

  it('flags a failure the host did not name as uncertain', async () => {
    hostSays('Exception: SocketException');
    await expect(transfer(ORDER)).rejects.toMatchObject({ code: 'HOST_ERROR', uncertain: true });
  });

  it('waits past the generic thirty seconds, then gives up as uncertain', async () => {
    vi.useFakeTimers();
    wx.invokeNativePlugin = vi.fn();
    const pending = transfer(ORDER);
    const settled = vi.fn();
    pending.catch(settled);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TIMEOUT', uncertain: true })
    );
  });

  it('is UNAVAILABLE without a host, and nothing was sent', async () => {
    await expect(transfer(ORDER)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('never reaches the host with an invalid transfer', async () => {
    wx.invokeNativePlugin = vi.fn();
    await expect(transfer({ ...ORDER, amount: 0 })).rejects.toMatchObject({ code: 'INVALID' });
    expect(wx.invokeNativePlugin).not.toHaveBeenCalled();
  });
});

describe('transfer — simulated', () => {
  beforeEach(() => configure({ simulate: true }));

  it('answers a fake transaction id without a host', async () => {
    const out = await transfer(ORDER);
    expect(out.txnid).toMatch(/^MP-DEV-/);
    expect(out.sender).toBe('770000001');
    expect(out.sent.receiver).toBe('770000002');
  });

  it('fails the way the fixture says, so a screen can rehearse it', async () => {
    configure({ fixtures: { transferFails: 'TIMEOUT' } });
    await expect(transfer(ORDER)).rejects.toMatchObject({ code: 'TIMEOUT', uncertain: true });
    configure({ fixtures: { transferFails: 'CANCELLED' } });
    await expect(transfer(ORDER)).rejects.toMatchObject({ code: 'CANCELLED', uncertain: false });
  });

  it('still validates the transfer', async () => {
    await expect(transfer({ ...ORDER, receiver: 'x' })).rejects.toMatchObject({ code: 'INVALID' });
  });
});
