// ============================================================================
// HOST ERRORS — one error class, a stable code, a user-safe French message,
// and the host's raw payload kept on `raw`.
//
// The host answers every failure through the same callback with a free-text
// message. Apps used to regex that text in a dozen places; here it is read
// once. Branch on `error.code`, show `error.message`, send `error.raw` to
// telemetry.
// ============================================================================

/**
 * The codes an app branches on.
 * @readonly
 * @enum {string}
 */
export const ERROR_CODES = Object.freeze({
  /** No host, or a host without this plugin (DevTools, an older app). */
  UNAVAILABLE: 'UNAVAILABLE',
  /** The host did not answer in time. For a payment: the money MAY have moved. */
  TIMEOUT: 'TIMEOUT',
  /** The user closed the host's sheet (payment, camera, picker). */
  CANCELLED: 'CANCELLED',
  /** A permission the user or the host refused (camera, contacts). */
  DENIED: 'DENIED',
  /** The host refused the operation on its own grounds (insufficient balance, wrong PIN…). */
  REFUSED: 'REFUSED',
  /** The user said no to the identical-transaction prompt. Nothing was debited. */
  DECLINED: 'DECLINED',
  /** The call was wrong before it left the app (bad payload). */
  INVALID: 'INVALID',
  /** The host failed for a reason it did not name. For a payment: uncertain. */
  HOST_ERROR: 'HOST_ERROR',
});

/** What the user may read, per code. */
const MESSAGES = Object.freeze({
  UNAVAILABLE: 'Cette fonction n’est pas disponible dans cette version de l’application.',
  TIMEOUT: 'Le service met trop de temps à répondre.',
  CANCELLED: 'Opération annulée.',
  DENIED: 'Accès refusé.',
  REFUSED: 'Opération refusée.',
  DECLINED: 'Paiement annulé. Aucun débit effectué.',
  INVALID: 'Demande invalide.',
  HOST_ERROR: 'Une erreur est survenue.',
});

/** Codes after which money MAY have moved on a payment. */
const UNCERTAIN_CODES = new Set([ERROR_CODES.TIMEOUT, ERROR_CODES.HOST_ERROR]);

/**
 * The one error the SDK throws.
 */
export class HostError extends Error {
  /**
   * @param {string} code - an ERROR_CODES value
   * @param {Object} [details]
   * @param {string} [details.api] - the plugin or wx API name
   * @param {string} [details.message] - overrides the default user-safe line
   * @param {*} [details.raw] - the host's payload, untouched
   * @param {string} [details.hostMessage] - the host's own text, for telemetry
   */
  constructor(code, { api = '', message, raw = null, hostMessage = '' } = {}) {
    super(message || MESSAGES[code] || MESSAGES.HOST_ERROR);
    this.name = 'HostError';
    this.code = ERROR_CODES[code] ? code : ERROR_CODES.HOST_ERROR;
    this.api = api;
    this.raw = raw;
    this.hostMessage = hostMessage;
    /** True when the operation may have had an effect despite the error. */
    this.uncertain = UNCERTAIN_CODES.has(this.code);
  }

  /** @returns {Object} a telemetry-safe view (no PII beyond what the host said) */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      api: this.api,
      message: this.message,
      hostMessage: this.hostMessage,
      uncertain: this.uncertain,
    };
  }
}

/** @param {*} err @returns {boolean} */
export const isHostError = (err) => err instanceof HostError;

/** Fragments hosts use for a refused permission. */
const DENIED_HINTS = ['auth deny', 'auth denied', 'permission', 'authorize', 'unauthorized'];
/** Fragments hosts use for an absent API. */
const UNAVAILABLE_HINTS = ['not support', 'undefined api', 'unknown api', 'no such', 'not exist'];
/** Fragments hosts use when the user closed the sheet. */
const CANCEL_HINTS = ['cancel', 'annul'];
/** Fragments the payment host uses when it refuses on its own grounds. */
const REFUSED_HINTS = ['insuffisant', 'insufficient', 'pin', 'refus', 'declin', 'rejet'];

/**
 * The host's own text, wherever it put it.
 * @param {*} raw
 * @returns {string}
 */
export const hostMessageOf = (raw) => {
  if (!raw) {
    return '';
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return String(raw.message || raw.errMsg || raw.msg || (raw.data && raw.data.message) || '');
};

/**
 * Sort a host failure into a code, by its words. Unknown words are
 * HOST_ERROR, never CANCELLED: a silent failure must not read as "the user
 * changed their mind".
 * @param {string} api
 * @param {*} raw - the host's failure payload
 * @returns {HostError}
 */
export const classifyHostFailure = (api, raw) => {
  const hostMessage = hostMessageOf(raw);
  const text = hostMessage.toLowerCase();
  const has = (hints) => hints.some((h) => text.includes(h));
  let code = ERROR_CODES.HOST_ERROR;
  if (has(UNAVAILABLE_HINTS)) {
    code = ERROR_CODES.UNAVAILABLE;
  } else if (has(DENIED_HINTS)) {
    code = ERROR_CODES.DENIED;
  } else if (has(CANCEL_HINTS)) {
    code = ERROR_CODES.CANCELLED;
  } else if (has(REFUSED_HINTS)) {
    code = ERROR_CODES.REFUSED;
  } else if (text.includes('timeout') || text.includes('timed out')) {
    code = ERROR_CODES.TIMEOUT;
  }
  return new HostError(code, { api, raw, hostMessage });
};
