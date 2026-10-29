import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deeplink, normaliseParams, maskParams } from './deeplink.js';
import { configure, resetConfig } from '../core/config.js';

const ok = (data) => ({ result: 'success', status_code: 200, data });

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
});

describe('normaliseParams', () => {
  it('reads a query string, the slash form, a params map and launch options', () => {
    expect(normaliseParams('?page=detail&id=42')).toEqual({ page: 'detail', id: '42' });
    expect(normaliseParams('/mini-apps/mp123/page=detail&id=42')).toEqual({
      page: 'detail',
      id: '42',
    });
    expect(normaliseParams({ Page: 'Detail', id: 42 })).toEqual({ page: 'Detail', id: '42' });
    expect(normaliseParams({ path: 'pages/index/index', query: { id: '7' } })).toEqual({ id: '7' });
  });

  it('expands a glued tail forwarded as a value or as a key', () => {
    expect(normaliseParams({ id: 'mp123/page=detail&id=42' })).toEqual({
      page: 'detail',
      id: '42',
    });
    expect(normaliseParams({ 'page=detail&id=42': '' })).toEqual({ page: 'detail', id: '42' });
  });

  it('decodes values, drops empties, keeps unknown keys', () => {
    expect(normaliseParams('desc=Grand%20Bal&empty=&montant=5000')).toEqual({
      desc: 'Grand Bal',
      montant: '5000',
    });
    expect(normaliseParams(null)).toEqual({});
  });
});

describe('maskParams', () => {
  it('masks phone numbers and keeps the rest', () => {
    expect(maskParams({ msisdn: '783064988', page: 'x', tel: '12' })).toEqual({
      msisdn: '78•••••88',
      page: 'x',
      tel: '•••',
    });
  });
});

describe('deeplink', () => {
  it('merges the host’s one-shot params over the launch query, host wins', async () => {
    wx.invokeNativePlugin = vi.fn((c) => c.success(ok({ params: { id: '1' } })));
    expect(await deeplink({ launch: { query: { id: '2', page: 'x' } } })).toEqual({
      id: '1',
      page: 'x',
    });
  });

  it('is null with nothing from either source, and when the host has no such API', async () => {
    wx.invokeNativePlugin = vi.fn((c) => c.success(ok({ params: null })));
    expect(await deeplink()).toBeNull();
    globalThis.__resetWx();
    expect(await deeplink()).toBeNull();
    expect(await deeplink({ launch: 'id=3' })).toEqual({ id: '3' });
  });

  it('answers the fixture when simulated', async () => {
    configure({ simulate: true, fixtures: { deeplink: { page: 'demo' } } });
    expect(await deeplink()).toEqual({ page: 'demo' });
  });
});
