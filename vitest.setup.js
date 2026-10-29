// ============================================================================
// Vitest setup — a minimal `wx` runtime stub. Each test replaces
// `wx.invokeNativePlugin` (or installs the mock host) as it needs.
// ============================================================================

import { vi } from 'vitest';

const makeWx = () => ({
  invokeNativePlugin: undefined,
  showModal: vi.fn(({ success }) => success && success({ confirm: true })),
  getSystemInfoSync: () => ({ platform: 'devtools' }),
  scanCode: undefined,
  setVisualEffectOnCapture: undefined,
});

globalThis.wx = makeWx();
globalThis.__resetWx = () => {
  globalThis.wx = makeWx();
};
