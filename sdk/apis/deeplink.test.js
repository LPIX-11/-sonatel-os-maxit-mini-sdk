import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deeplink, resetDeeplink, normaliseParams, maskParams } from './deeplink.js';
import { mockLaunchOptions } from '../mock/host.js';
import { configure, resetConfig } from '../core/config.js';

const ok = (data) => ({ result: 'success', status_code: 200, data });

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
  resetDeeplink();
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

  it('reads the issued link with two question marks: no key is ever `?msisdn`', () => {
    const tail = '??msisdn=783064988&montant=5000&nbtickets=2&description=Concert%20Dakar';
    const expected = {
      msisdn: '783064988',
      montant: '5000',
      nbtickets: '2',
      description: 'Concert Dakar',
    };
    expect(
      normaliseParams(`https://sugu.orange-sonatel.com/miniapps/mp5xbscjct620te8${tail}`)
    ).toEqual(expected);
    expect(normaliseParams(tail)).toEqual(expected);
    expect(normaliseParams({ '?msisdn': '783064988', '&montant': '5000' })).toEqual({
      msisdn: '783064988',
      montant: '5000',
    });
  });

  it('reads MiniStartOptions.params off the launch options: referrerInfo.extraData, extendData', () => {
    const tail = '??msisdn=783064988&nbtickets=2';
    const launch = { path: 'pages/home/index', query: {}, scene: 1001 };
    const expected = { msisdn: '783064988', nbtickets: '2' };
    expect(
      normaliseParams({ ...launch, referrerInfo: { appId: 'sugu', extraData: tail } })
    ).toEqual(expected);
    expect(normaliseParams({ ...launch, extendData: tail })).toEqual(expected);
    // An SDK that already parsed the string into a map.
    expect(
      normaliseParams({
        ...launch,
        referrerInfo: { extraData: { Msisdn: '783064988', nbtickets: 2 } },
      })
    ).toEqual(expected);
    // A host that serialises a JSON object instead of a query string.
    expect(
      normaliseParams({ ...launch, extendData: '{"msisdn":"783064988","nbtickets":2}' })
    ).toEqual(expected);
    // The host's params win over the compile-condition query; a path with its own `?` counts too.
    expect(
      normaliseParams({
        path: 'pages/home/index?id=fromPath',
        query: { id: 'fromQuery', extra: '1' },
        referrerInfo: { extraData: 'id=fromHost' },
      })
    ).toEqual({ id: 'fromHost', extra: '1' });
    // The ordinary tap on the store tile: nothing.
    expect(normaliseParams({ ...launch, referrerInfo: {} })).toEqual({});
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

  it('reads the new host door with no host API at all', async () => {
    expect(
      await deeplink({
        launch: {
          path: 'pages/home/index',
          query: {},
          scene: 1001,
          referrerInfo: { appId: 'sugu', extraData: '??msisdn=783064988&nbtickets=2' },
        },
      })
    ).toEqual({ msisdn: '783064988', nbtickets: '2' });
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

describe('deeplink — one-shot across the onShow repeat', () => {
  it('returns the link once, then null when onShow repeats the same options', async () => {
    const launch = mockLaunchOptions({ page: 'detail', id: '42' }); // extraData door
    expect(await deeplink({ launch })).toEqual({ page: 'detail', id: '42' });
    expect(await deeplink({ launch })).toBeNull(); // the resume: same options, already handled
  });

  it('the SAME link tapped again is a fresh tap when the host hands it over again (0.1.2)', async () => {
    // The host's getDeeplinkParams is one-shot on its side: an answer = a new tap.
    const launch = { referrerInfo: { extraData: '??page=x' } };
    globalThis.wx = {
      invokeNativePlugin: (call) =>
        call.success({ result: 'success', status_code: 200, data: { params: { page: 'x' } } }),
    };
    expect(await deeplink({ launch })).toEqual({ page: 'x' });
    // The onShow that follows: same options, the host has nothing left → a resume.
    globalThis.wx = {
      invokeNativePlugin: (call) =>
        call.success({ result: 'success', status_code: 200, data: { params: {} } }),
    };
    expect(await deeplink({ launch })).toBeNull();
    // A second tap of the same link: the host hands the same words over again → routes.
    globalThis.wx = {
      invokeNativePlugin: (call) =>
        call.success({ result: 'success', status_code: 200, data: { params: { page: 'x' } } }),
    };
    expect(await deeplink({ launch })).toEqual({ page: 'x' });
  });

  it('the host’s late copy of a link already read off the launch options is NOT a second tap (0.1.3)', async () => {
    // Cold start: the options door carries the tap, the host bridge is not
    // ready yet — its first call fails and the host KEEPS its copy.
    const launch = { referrerInfo: { extraData: '??page=x&qty=2' } };
    globalThis.wx = {
      invokeNativePlugin: (call) => call.fail({ errMsg: 'plugin not ready' }),
    };
    expect(await deeplink({ launch })).toEqual({ page: 'x', qty: '2' });
    // A resume (return from a payment overlay): the same options AND the host
    // now answers the surviving copy of the SAME tap → swallowed once.
    globalThis.wx = {
      invokeNativePlugin: (call) =>
        call.success({
          result: 'success',
          status_code: 200,
          data: { params: { page: 'x', qty: '2' } },
        }),
    };
    expect(await deeplink({ launch })).toBeNull();
    // The host cleared it; a plain resume stays a resume.
    globalThis.wx = {
      invokeNativePlugin: (call) =>
        call.success({ result: 'success', status_code: 200, data: { params: {} } }),
    };
    expect(await deeplink({ launch })).toBeNull();
    // A genuine re-tap of the same link: the host hands the words over AGAIN → routes.
    globalThis.wx = {
      invokeNativePlugin: (call) =>
        call.success({
          result: 'success',
          status_code: 200,
          data: { params: { page: 'x', qty: '2' } },
        }),
    };
    expect(await deeplink({ launch })).toEqual({ page: 'x', qty: '2' });
  });

  it('still resolves a genuinely new link after a repeat', async () => {
    const a = mockLaunchOptions({ page: 'a' });
    const b = mockLaunchOptions({ page: 'b' });
    expect(await deeplink({ launch: a })).toEqual({ page: 'a' });
    expect(await deeplink({ launch: a })).toBeNull();
    expect(await deeplink({ launch: b })).toEqual({ page: 'b' });
  });

  it('once:false always resolves, and resetDeeplink clears the memory', async () => {
    const launch = mockLaunchOptions({ page: 'x' });
    expect(await deeplink({ launch, once: false })).toEqual({ page: 'x' });
    expect(await deeplink({ launch, once: false })).toEqual({ page: 'x' });
    // default once:true now records it…
    expect(await deeplink({ launch })).toEqual({ page: 'x' });
    expect(await deeplink({ launch })).toBeNull();
    // …until a fresh launch clears it.
    resetDeeplink();
    expect(await deeplink({ launch })).toEqual({ page: 'x' });
  });
});

describe('mockLaunchOptions — rehearsing the new door in DevTools', () => {
  it('round-trips params through every door', async () => {
    for (const door of ['extraData', 'extendData', 'query', 'doubleQuestion']) {
      resetDeeplink();
      const launch = mockLaunchOptions({ page: 'detail', id: '42' }, { door });
      expect(await deeplink({ launch })).toEqual({ page: 'detail', id: '42' });
    }
  });
});
