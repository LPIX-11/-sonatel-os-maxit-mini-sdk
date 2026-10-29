import { describe, it, expect } from 'vitest';
import {
  HostError,
  ERROR_CODES,
  classifyHostFailure,
  isHostError,
  hostMessageOf,
} from './errors.js';

describe('HostError', () => {
  it('carries a stable code, a French message, the raw payload and the uncertainty flag', () => {
    const err = new HostError(ERROR_CODES.TIMEOUT, { api: 'merchantPay', raw: { a: 1 } });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HostError');
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toMatch(/trop de temps/);
    expect(err.raw).toEqual({ a: 1 });
    expect(err.uncertain).toBe(true);
    expect(isHostError(err)).toBe(true);
    expect(isHostError(new Error('x'))).toBe(false);
  });

  it('is certain for a cancel, a refusal, a denial, a decline', () => {
    ['CANCELLED', 'REFUSED', 'DENIED', 'DECLINED', 'INVALID', 'UNAVAILABLE'].forEach((code) => {
      expect(new HostError(code).uncertain).toBe(false);
    });
    expect(new HostError('HOST_ERROR').uncertain).toBe(true);
  });

  it('falls back to HOST_ERROR on an unknown code and serialises without the raw payload', () => {
    const err = new HostError('WHATEVER', { api: 'x', raw: { secret: 1 }, hostMessage: 'boom' });
    expect(err.code).toBe('HOST_ERROR');
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      name: 'HostError',
      code: 'HOST_ERROR',
      api: 'x',
      message: 'Une erreur est survenue.',
      hostMessage: 'boom',
      uncertain: true,
    });
  });
});

describe('classifyHostFailure', () => {
  const code = (msg) => classifyHostFailure('api', { errMsg: msg }).code;

  it('reads the host’s words', () => {
    expect(code('scanCode:fail cancel')).toBe('CANCELLED');
    expect(code('Opération annulée par le client')).toBe('CANCELLED');
    expect(code('scanCode:fail auth deny')).toBe('DENIED');
    expect(code('system permission denied')).toBe('DENIED');
    expect(code('Solde insuffisant')).toBe('REFUSED');
    expect(code('Transaction rejetée')).toBe('REFUSED');
    expect(code('request:fail timeout')).toBe('TIMEOUT');
    expect(code('invokeNativePlugin:fail undefined api foo')).toBe('UNAVAILABLE');
  });

  it('never reads silence as a cancel', () => {
    expect(classifyHostFailure('api', undefined).code).toBe('HOST_ERROR');
    expect(classifyHostFailure('api', {}).code).toBe('HOST_ERROR');
    expect(code('Something odd happened')).toBe('HOST_ERROR');
  });

  it('keeps the host text and the raw payload', () => {
    const raw = { message: 'PIN incorrect', txnid: 'X' };
    const err = classifyHostFailure('merchantPay', raw);
    expect(err.hostMessage).toBe('PIN incorrect');
    expect(err.raw).toBe(raw);
    expect(err.api).toBe('merchantPay');
  });
});

describe('hostMessageOf', () => {
  it('reads message, errMsg, msg or a nested data.message', () => {
    expect(hostMessageOf({ message: 'a' })).toBe('a');
    expect(hostMessageOf({ errMsg: 'b' })).toBe('b');
    expect(hostMessageOf({ data: { message: 'c' } })).toBe('c');
    expect(hostMessageOf('d')).toBe('d');
    expect(hostMessageOf(null)).toBe('');
  });
});
