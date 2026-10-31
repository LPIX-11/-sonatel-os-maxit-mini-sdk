#!/usr/bin/env node
// ============================================================================
// Prove the OBFUSCATED bundle still runs and still exposes the public API.
// The vitest suite runs against the readable source; this runs against what
// partners actually install, so obfuscation can never silently break it.
//
//   node scripts/smoke-dist.mjs
// ============================================================================

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST_INDEX = join(ROOT, 'dist', 'sdk', 'index.js');

const assert = (cond, message) => {
  if (!cond) {
    throw new Error(message);
  }
};

const main = async () => {
  // A minimal mini-program runtime: simulate mode never reaches it, but the
  // bundle references `wx`/`globalThis`, so they must exist.
  globalThis.wx = {
    showModal: ({ success }) => success && success({ confirm: true }),
    getRealtimeLogManager: () => null,
    reportEvent: () => {},
  };

  const { miniSDK } = await import(pathToFileURL(DIST_INDEX).href);

  const expected = (await readFile(join(ROOT, 'dist', 'sdk', 'VERSION'), 'utf8')).trim();
  assert(miniSDK && typeof miniSDK === 'object', 'miniSDK did not load from the bundle');
  assert(miniSDK.VERSION === expected, `VERSION mismatch: ${miniSDK.VERSION} != ${expected}`);
  for (const m of ['configure', 'user', 'login', 'pay', 'contacts', 'deeplink', 'scan', 'screen']) {
    assert(typeof miniSDK[m] === 'function' || typeof miniSDK[m] === 'object', `missing ${m}`);
  }

  // Exercise the money path in simulation — the real test that the obfuscated
  // control flow is intact: validation, the host payload, a resolved txnid.
  miniSDK.configure({ simulate: true, fixtures: { latencyMs: 0 } });

  await miniSDK
    .pay({ amount: 0, receiver: 1, receiverName: 'X', description: 'x', orderId: 'O' })
    .then(() => {
      throw new Error('a zero amount should have been refused');
    })
    .catch((e) =>
      assert(e && e.code === 'INVALID', `bad amount should be INVALID, got ${e && e.code}`)
    );

  const res = await miniSDK.pay({
    amount: 2000,
    receiver: 467652,
    receiverName: 'Ma Boutique',
    description: 'Pass journée',
    orderId: 'ORD-1',
  });
  assert(/^MP-DEV-/.test(res.txnid), `simulated txnid unexpected: ${res.txnid}`);

  // The host payload must still carry the exact keys the host reads.
  const sent = miniSDK.helpers.buildHostPayload({
    amount: 2000,
    receiver: 467652,
    receiverName: 'Ma Boutique',
    description: 'Pass journée',
    orderId: 'ORD-1',
  });
  for (const key of ['amount', 'currency', 'receiver', 'idService', 'reference', 'payload']) {
    assert(key in sent, `host payload lost key ${key}`);
  }
  for (const key of ['nom_marchand', 'code_marchand', 'reference']) {
    assert(key in sent.payload, `host payload.payload lost key ${key}`);
  }

  console.log(`✔ obfuscated bundle runs — miniSDK ${miniSDK.VERSION}, pay simulated ${res.txnid}`);
};

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
