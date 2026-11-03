// ============================================================================
// miniSDK.pay — the money rules under test: a bad payload never leaves the
// app; the identical prompt is handled with exactly one retry carrying the
// txnid and caction "1" (a string); a decline is DECLINED; a refusal is
// certain; a timeout or an unnamed failure is uncertain.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pay,
  buildHostPayload,
  readIdenticalPrompt,
  txnidOf,
  CONTINUE_ACTION,
  resetPaySimulation,
  withoutEmpty,
} from './pay.js';
import { configure, resetConfig } from '../core/config.js';
import { HostError } from '../core/errors.js';

const PAYLOAD = {
  amount: 2000,
  receiver: 467652,
  receiverName: 'Ma Boutique',
  description: 'Pass journée',
  orderId: 'ORD-1',
};

const ok = (data) => ({ result: 'success', status_code: 200, data });
const dup = (txnid = 'MP-DUP-1') => ({
  result: 'fail',
  status_code: 400,
  message: 'Vous venez d effectuer une transaction identique. Continuer ?',
  txnid,
});

/** A host whose answers are queued, in order. */
const host = (...answers) => {
  const fn = vi.fn((call) => {
    const next = answers.shift();
    call.success(typeof next === 'function' ? next(call.data) : next);
  });
  wx.invokeNativePlugin = fn;
  return fn;
};

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
  resetPaySimulation();
  configure({ fixtures: { latencyMs: 0 } });
});

describe('pay — the wait', () => {
  it('waits for the host longer than the generic 30-s timeout: a PIN takes a while', async () => {
    vi.useFakeTimers();
    try {
      wx.invokeNativePlugin = vi.fn((call) => {
        setTimeout(() => call.success(ok({ txnid: 'MP-LATE' })), 90 * 1000);
      });
      const p = pay(PAYLOAD);
      // Nothing happens at 30 s…
      await vi.advanceTimersByTimeAsync(31 * 1000);
      // …and the host's answer at 90 s is the result, not a late reply dropped.
      await vi.advanceTimersByTimeAsync(60 * 1000);
      await expect(p).resolves.toMatchObject({ txnid: 'MP-LATE' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('still gives up on a host that never answers, as uncertain', async () => {
    vi.useFakeTimers();
    try {
      wx.invokeNativePlugin = vi.fn(() => {});
      const p = pay(PAYLOAD);
      const settled = expect(p).rejects.toMatchObject({ code: 'TIMEOUT', uncertain: true });
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 10);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pay — validation', () => {
  it('refuses a bad payload before anything leaves the app', async () => {
    const h = host(ok({ txnid: 'X' }));
    for (const bad of [
      null,
      {},
      { ...PAYLOAD, amount: 0 },
      { ...PAYLOAD, amount: 'abc' },
      { ...PAYLOAD, receiver: 0 },
      { ...PAYLOAD, receiverName: '' },
    ]) {
      await expect(pay(bad)).rejects.toMatchObject({ code: 'INVALID' });
    }
    expect(h).not.toHaveBeenCalled();
  });

  it('refuses an order without any reference, and serviceId + idService with different values', async () => {
    const h = host(ok({ txnid: 'X' }));
    await expect(pay({ ...PAYLOAD, orderId: undefined })).rejects.toMatchObject({
      code: 'INVALID',
    });
    await expect(pay({ ...PAYLOAD, serviceId: 'A', idService: 'B' })).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect(h).not.toHaveBeenCalled();
  });
});

describe('pay — the host payload', () => {
  it('builds the host request from a plain order: the key under both spellings, the nested payload block', () => {
    expect(buildHostPayload(PAYLOAD)).toEqual({
      amount: 2000,
      currency: 'XOF',
      receiver: 467652,
      receiverName: 'Ma Boutique',
      orderId: 'ORD-1',
      orderDescription: 'Pass journée',
      message: 'Pass journée',
      idService: 'ORD-1',
      serviceId: 'ORD-1',
      reference: 'ORD-1',
      payload: { nom_marchand: 'Ma Boutique', code_marchand: '467652', reference: 'ORD-1' },
    });
  });

  it('sends the correlation key under BOTH spellings, from a bare orderId (0.1.5)', () => {
    // The host source reads `idService` (samea-mobile MiniAppPayReq.fromMap);
    // the build in the field may read the other name; BRT, whose key is
    // proven in the Orange Money ledger, sends both. So does the SDK now.
    const body = buildHostPayload({ ...PAYLOAD, orderId: 'TEV-9' });
    expect(body.idService).toBe('TEV-9');
    expect(body.serviceId).toBe('TEV-9');
  });

  it('one value, whichever spelling the app used — both always leave', () => {
    const a = buildHostPayload({ ...PAYLOAD, serviceId: 'SVC-1' });
    expect(a.serviceId).toBe('SVC-1');
    expect(a.idService).toBe('SVC-1');

    const b = buildHostPayload({ ...PAYLOAD, idService: 'maxStore.app' });
    expect(b.idService).toBe('maxStore.app');
    expect(b.serviceId).toBe('maxStore.app');

    const same = buildHostPayload({ ...PAYLOAD, serviceId: 'S', idService: 'S' });
    expect(same.idService).toBe('S');
    expect(same.serviceId).toBe('S');
  });

  it('lets the app set the reference, the customer, the currency, and pass extras through', () => {
    const body = buildHostPayload({
      ...PAYLOAD,
      reference: 'E2E-9',
      customerMsisdn: '770000001',
      currency: 'XOF',
      payload: { canal: 'MP' },
      extra: { appInfo: 'my-app', fees: 0 },
    });
    expect(body.reference).toBe('E2E-9');
    expect(body.payload).toEqual({
      nom_marchand: 'Ma Boutique',
      code_marchand: '467652',
      reference: 'E2E-9',
      canal: 'MP',
    });
    expect(body.customerMsisdn).toBe('770000001');
    expect(body).toMatchObject({ appInfo: 'my-app', fees: 0 });
  });

  it('is what goes on the wire, and comes back on the result as `sent`', async () => {
    const h = host(ok({ txnid: 'MP-1' }));
    const res = await pay(PAYLOAD);
    expect(h.mock.calls[0][0].data).toEqual(buildHostPayload(PAYLOAD));
    expect(res.sent).toEqual(buildHostPayload(PAYLOAD));
  });
});

describe('pay — results', () => {
  it('resolves the txnid whatever name the host gave it, raw kept', async () => {
    for (const data of [{ txnid: 'A' }, { trxReference: 'B' }, { transactionId: 'C' }]) {
      host(ok(data));
      const res = await pay(PAYLOAD);
      expect(res.txnid).toBe(Object.values(data)[0]);
      expect(res.raw).toEqual(data);
      expect(res.confirmedIdentical).toBe(false);
    }
  });

  it('a success without an id is a HOST_ERROR, uncertain', async () => {
    host(ok({}));
    await expect(pay(PAYLOAD)).rejects.toMatchObject({ code: 'HOST_ERROR', uncertain: true });
  });
});

describe('pay — the identical-transaction prompt', () => {
  it('asks, then retries ONCE with the txnid and caction "1" (a string)', async () => {
    const h = host(dup('MP-DUP-9'), ok({ txnid: 'MP-DUP-9' }));
    const onIdentical = vi.fn().mockResolvedValue(true);
    const res = await pay(PAYLOAD, { onIdentical });
    expect(onIdentical).toHaveBeenCalledWith(expect.stringMatching(/identique/));
    expect(res).toMatchObject({ txnid: 'MP-DUP-9', confirmedIdentical: true });
    expect(h).toHaveBeenCalledTimes(2);
    expect(h.mock.calls[1][0].data).toMatchObject({ txnid: 'MP-DUP-9', caction: '1' });
    expect(typeof h.mock.calls[1][0].data.caction).toBe('string');
    expect(CONTINUE_ACTION).toBe('1');
  });

  it('DECLINED when the user says no — nothing debited, no retry', async () => {
    const h = host(dup());
    await expect(pay(PAYLOAD, { onIdentical: async () => false })).rejects.toMatchObject({
      code: 'DECLINED',
      uncertain: false,
    });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('uses the configured confirm, then the host dialog, when no onIdentical is given', async () => {
    host(dup(), ok({ txnid: 'T' }));
    const confirm = vi.fn().mockResolvedValue(true);
    configure({ confirm });
    await pay(PAYLOAD);
    expect(confirm).toHaveBeenCalled();

    configure({ confirm: null });
    host(dup(), ok({ txnid: 'T2' }));
    const res = await pay(PAYLOAD);
    expect(wx.showModal).toHaveBeenCalled();
    expect(res.txnid).toBe('T2');
  });

  it('does not loop if the host prompts again on the retry', async () => {
    const h = host(dup('A'), dup('B'));
    await expect(pay(PAYLOAD, { onIdentical: async () => true })).rejects.toBeInstanceOf(HostError);
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('a prompt without a usable txnid is not retried (unattributable)', async () => {
    host({ result: 'fail', status_code: 400, message: 'transaction identique. Continuer ?' });
    const onIdentical = vi.fn();
    await expect(pay(PAYLOAD, { onIdentical })).rejects.toMatchObject({ code: 'HOST_ERROR' });
    expect(onIdentical).not.toHaveBeenCalled();
  });
});

describe('pay — failures', () => {
  it('a refusal (insufficient balance) is REFUSED and certain', async () => {
    host({ result: 'fail', status_code: 400, message: 'Solde insuffisant' });
    await expect(pay(PAYLOAD)).rejects.toMatchObject({ code: 'REFUSED', uncertain: false });
  });

  it('a cancel is CANCELLED and certain', async () => {
    wx.invokeNativePlugin = vi.fn((c) => c.fail({ errMsg: 'merchantPay:fail cancel' }));
    await expect(pay(PAYLOAD)).rejects.toMatchObject({ code: 'CANCELLED', uncertain: false });
  });

  it('an unnamed failure is uncertain: the app must verify before letting the user pay again', async () => {
    host({ result: 'fail', status_code: 500, message: 'Erreur interne' });
    await expect(pay(PAYLOAD)).rejects.toMatchObject({ code: 'HOST_ERROR', uncertain: true });
  });
});

describe('pay — simulation', () => {
  it('answers a fake txnid without a host', async () => {
    configure({ simulate: true });
    const res = await pay(PAYLOAD);
    expect(res.txnid).toMatch(/^MP-DEV-/);
    expect(res.raw.simulated).toBe(true);
  });

  it('can rehearse the identical prompt once', async () => {
    configure({ simulate: true, fixtures: { identicalOnce: true } });
    const onIdentical = vi.fn().mockResolvedValue(true);
    const first = await pay(PAYLOAD, { onIdentical });
    expect(onIdentical).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ txnid: 'MP-DEV-DUP', confirmedIdentical: true });
    const second = await pay(PAYLOAD, { onIdentical });
    expect(onIdentical).toHaveBeenCalledTimes(1);
    expect(second.confirmedIdentical).toBe(false);
  });
});

describe('readIdenticalPrompt / txnidOf', () => {
  it('reads the id off the error, its raw payload or raw.data', () => {
    const e = new HostError('HOST_ERROR', {
      hostMessage: 'Transaction identique détectée — continuer ?',
      raw: { data: { txnid: 'X' } },
    });
    expect(readIdenticalPrompt(e)).toEqual({ txnid: 'X', message: e.hostMessage });
  });

  it('refuses the host’s whole error string or "null" standing in for the id', () => {
    expect(txnidOf({ txnid: 'CODE:2040;MESSAGE:identique;TXNID:null' })).toBe('');
    expect(txnidOf({ txnid: 'null' })).toBe('');
    expect(txnidOf({ reference: 'MP260924.1108.A12345' })).toBe('MP260924.1108.A12345');
  });

  it('returns null on non-duplicate wordings', () => {
    expect(
      readIdenticalPrompt(
        new HostError('REFUSED', { hostMessage: 'Paiement refusé', raw: { txnid: 'X' } })
      )
    ).toBeNull();
    expect(readIdenticalPrompt(null)).toBeNull();
  });
});

describe('pay — nothing null ever reaches the host (2026-11-03)', () => {
  const flat = (o, prefix = '') =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? flat(v, `${prefix}${k}.`)
        : [[`${prefix}${k}`, v]]
    );

  it('builds a body with no null, undefined or empty value, top level and inside payload', () => {
    const body = buildHostPayload({
      ...PAYLOAD,
      reference: null,
      idService: undefined,
      serviceId: null,
      customerMsisdn: '',
      receiverName: 'Ma Boutique',
      payload: { note: null, lieu: 'Dakar' },
      extra: { canal: undefined, via: 'lien' },
    });
    for (const [key, value] of flat(body)) {
      expect(value, key).not.toBeNull();
      expect(value, key).not.toBeUndefined();
      expect(value === '' ? key : '', key).toBe('');
    }
    expect(body.idService).toBe('ORD-1');
    expect(body.serviceId).toBe('ORD-1');
    expect(body.reference).toBe('ORD-1');
    expect(body.payload).toEqual({
      nom_marchand: 'Ma Boutique',
      code_marchand: '467652',
      reference: 'ORD-1',
      lieu: 'Dakar',
    });
    expect(body.via).toBe('lien');
    expect(body).not.toHaveProperty('canal');
  });

  it('reads the strings "null" and "undefined" as no value, and refuses an order whose only key is one of them', async () => {
    const body = buildHostPayload({ ...PAYLOAD, reference: 'null', idService: 'undefined' });
    expect(body.reference).toBe('ORD-1');
    expect(body.idService).toBe('ORD-1');
    const h = host(ok({ txnid: 'X' }));
    await expect(pay({ ...PAYLOAD, orderId: 'null' })).rejects.toMatchObject({ code: 'INVALID' });
    expect(h).not.toHaveBeenCalled();
  });

  it('withoutEmpty drops empty nested blocks and keeps zero and false', () => {
    expect(withoutEmpty({ a: null, b: '', c: { d: undefined }, e: 0, f: false, g: ' x ' })).toEqual(
      { e: 0, f: false, g: ' x ' }
    );
  });
});
