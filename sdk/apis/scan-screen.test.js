import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scan } from './scan.js';
import { screen } from './screen.js';
import { configure, resetConfig } from '../core/config.js';

beforeEach(() => {
  globalThis.__resetWx();
  resetConfig();
  configure({ fixtures: { latencyMs: 0 } });
});

describe('scan', () => {
  it('is camera-only by default and returns the trimmed code', async () => {
    wx.scanCode = vi.fn((o) => o.success({ result: '  EV-ABC \n' }));
    expect(await scan()).toEqual({ code: 'EV-ABC', albumAllowed: false });
    expect(wx.scanCode.mock.calls[0][0]).toMatchObject({
      onlyFromCamera: true,
      scanType: ['qrCode', 'barCode'],
    });
  });

  it('retries with the album when the host refuses the camera-only scanner, flagged', async () => {
    wx.scanCode = vi.fn((o) =>
      o.onlyFromCamera
        ? o.fail({ errMsg: 'scanCode:fail invalid parameter' })
        : o.success({ result: 'EV-X' })
    );
    expect(await scan()).toEqual({ code: 'EV-X', albumAllowed: true });
    expect(wx.scanCode).toHaveBeenCalledTimes(2);
  });

  it('does not retry a cancel or a refused permission', async () => {
    wx.scanCode = vi.fn((o) => o.fail({ errMsg: 'scanCode:fail cancel' }));
    await expect(scan()).rejects.toMatchObject({ code: 'CANCELLED' });
    wx.scanCode = vi.fn((o) => o.fail({ errMsg: 'scanCode:fail auth deny' }));
    await expect(scan()).rejects.toMatchObject({ code: 'DENIED' });
    expect(wx.scanCode).toHaveBeenCalledTimes(1);
  });

  it('is UNAVAILABLE without a scanner, and simulated on demand', async () => {
    await expect(scan()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    configure({ simulate: true });
    expect(await scan()).toEqual({ code: 'DEV-SCAN-0001', albumAllowed: false });
  });
});

describe('screen.protect', () => {
  it('uses FLAG_SECURE on Android, both ways', async () => {
    wx.getSystemInfoSync = () => ({ platform: 'android' });
    wx.setVisualEffectOnCapture = vi.fn(({ success }) => success({}));
    expect(await screen.protect(true)).toEqual({ platform: 'android', masked: true });
    expect(wx.setVisualEffectOnCapture.mock.calls[0][0].visualEffect).toBe('hidden');
    await screen.protect(false);
    expect(wx.setVisualEffectOnCapture.mock.calls[1][0].visualEffect).toBe('none');
  });

  it('asks the host on iOS, both ways, and reports a refusal as unmasked', async () => {
    wx.getSystemInfoSync = () => ({ platform: 'ios' });
    wx.invokeNativePlugin = vi.fn((c) => c.success({ result: 'success', status_code: 200 }));
    expect(await screen.protect(true)).toEqual({ platform: 'ios', masked: true });
    expect(wx.invokeNativePlugin.mock.calls[0][0]).toMatchObject({
      api_name: 'block_screen',
      data: { activate: true },
    });
    await screen.protect(false);
    expect(wx.invokeNativePlugin.mock.calls[1][0].data).toEqual({ activate: false });
    wx.invokeNativePlugin = vi.fn((c) => c.fail({ errMsg: 'nope' }));
    expect((await screen.protect(true)).masked).toBe(false);
  });

  it('is inert in DevTools', async () => {
    expect(await screen.protect(true)).toEqual({ platform: 'devtools', masked: false });
  });
});
