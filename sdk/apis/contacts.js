// ============================================================================
// miniSDK.contacts() — the device's contact book, through the host.
//
// Called WITHOUT a `data` field: the plugin answers empty when handed one.
// The answer comes in three shapes in the wild (`{data: {contacts}}`,
// `{contacts}`, `{data: [...]}`); all three read as one list.
// ============================================================================

import { invoke } from '../core/invoke.js';
import { isSimulated, fixtures, delay } from '../core/config.js';

/** The plugin's api_name. */
export const API = 'contactList';

/**
 * @typedef {Object} Contact
 * @property {string} name
 * @property {string[]} msisdn - one or more numbers, as the phone stores them
 */

/**
 * The `contactList` answer in one shape, whatever the host sent.
 * @param {*} res
 * @returns {Contact[]}
 */
export const normaliseContacts = (res) => {
  const candidate =
    (res && res.data && res.data.contacts) || (res && res.contacts) || (res && res.data);
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate
    .map((c) => ({
      name: String((c && c.name) || '').trim(),
      msisdn: Array.isArray(c && c.msisdn)
        ? c.msisdn.map(String)
        : c && c.msisdn
          ? [String(c.msisdn)]
          : [],
    }))
    .filter((c) => c.msisdn.length);
};

/**
 * The device's contacts.
 * @returns {Promise<Contact[]>}
 * @throws {HostError} DENIED when the user refused, UNAVAILABLE without a host
 */
export const contacts = async () => {
  if (isSimulated()) {
    await delay();
    return fixtures().contacts.map((c) => ({ name: c.name, msisdn: [...c.msisdn] }));
  }
  const res = await invoke(API, undefined, { strict: false });
  return normaliseContacts(res);
};
