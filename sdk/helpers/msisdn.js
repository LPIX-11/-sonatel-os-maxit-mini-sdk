// ============================================================================
// MSISDN + IDENTITY — the host's user as every backend accepts them.
//
// The host hands the msisdn as the subscriber registered it (`+221 77…`,
// `22177…`, with spaces) and the name as two free fields (`undefined` when
// one is missing). Normalised once, here.
// ============================================================================

/**
 * Strip what people and contact books add: `+221`, `221`, `00221`, spaces,
 * dots, dashes.
 * @param {*} raw
 * @returns {string} the digits left — nine when it is a Senegalese mobile
 */
export const normaliseMsisdn = (raw) => {
  let digits = String(raw === undefined || raw === null ? '' : raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  if (digits.startsWith('00221')) {
    digits = digits.slice(5);
  } else if (digits.startsWith('221') && digits.length === 12) {
    digits = digits.slice(3);
  }
  return digits;
};

/**
 * @param {string} digits
 * @returns {boolean}
 */
export const isSenegalMobile = (digits) => /^7[0-9]{8}$/.test(digits);

/**
 * The host's user record as an identity: the msisdn in its nine-digit form,
 * the name from whichever parts exist (a missing part never reads
 * « undefined »).
 * @param {{msisdn?: *, firstName?: *, lastName?: *}|null|undefined} user
 * @returns {{msisdn: string|null, fullName: string|null, firstName: string|null, lastName: string|null}}
 */
export const identityOf = (user) => {
  const clean = (p) => {
    const s = p === undefined || p === null ? '' : String(p).trim();
    return s && s !== 'undefined' && s !== 'null' ? s.replace(/\s+/g, ' ') : '';
  };
  const firstName = clean(user && user.firstName);
  const lastName = clean(user && user.lastName);
  const digits = normaliseMsisdn(user && user.msisdn);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return {
    msisdn: digits || null,
    fullName: fullName || null,
    firstName: firstName || null,
    lastName: lastName || null,
  };
};
