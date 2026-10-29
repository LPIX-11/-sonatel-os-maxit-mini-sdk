import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contacts, normaliseContacts } from './contacts.js';
import { configure, resetConfig } from '../core/config.js';

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
  configure({ fixtures: { latencyMs: 0 } });
});

describe('normaliseContacts', () => {
  it('reads the three shapes seen in the wild into one list', () => {
    const list = [{ name: 'Fatou Sow', msisdn: ['776335377'] }];
    expect(normaliseContacts({ data: { contacts: list } })).toEqual(list);
    expect(normaliseContacts({ contacts: list })).toEqual(list);
    expect(normaliseContacts({ data: list })).toEqual(list);
  });

  it('wraps a single msisdn, drops entries without one, trims names', () => {
    expect(
      normaliseContacts({ contacts: [{ name: ' A ', msisdn: '770000001' }, { name: 'B' }, null] })
    ).toEqual([{ name: 'A', msisdn: ['770000001'] }]);
    expect(normaliseContacts(null)).toEqual([]);
  });
});

describe('contacts', () => {
  it('calls the plugin WITHOUT a data key', async () => {
    wx.invokeNativePlugin = vi.fn((c) =>
      c.success({ data: { contacts: [{ name: 'X', msisdn: ['1'] }] } })
    );
    const out = await contacts();
    expect(wx.invokeNativePlugin.mock.calls[0][0]).not.toHaveProperty('data');
    expect(out).toEqual([{ name: 'X', msisdn: ['1'] }]);
  });

  it('a refused permission is DENIED, no host is UNAVAILABLE', async () => {
    wx.invokeNativePlugin = vi.fn((c) => c.fail({ errMsg: 'contactList:fail auth deny' }));
    await expect(contacts()).rejects.toMatchObject({ code: 'DENIED' });
    globalThis.__resetWx();
    await expect(contacts()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('answers a copy of the fixture book when simulated', async () => {
    configure({ simulate: true });
    const a = await contacts();
    a[0].msisdn.push('tampered');
    const b = await contacts();
    expect(b[0].msisdn).toEqual(['777917330']);
  });
});
