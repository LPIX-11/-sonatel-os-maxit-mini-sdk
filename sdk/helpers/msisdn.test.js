import { describe, it, expect } from 'vitest';
import { normaliseMsisdn, isSenegalMobile, identityOf } from './msisdn.js';

describe('normaliseMsisdn', () => {
  it('reduces every shape to the nine digits', () => {
    for (const raw of [
      '771234567',
      '+221771234567',
      '221771234567',
      '00221771234567',
      '77 123 45 67',
      '77.123.45.67',
    ]) {
      expect(normaliseMsisdn(raw)).toBe('771234567');
    }
    expect(normaliseMsisdn(null)).toBe('');
    expect(isSenegalMobile('771234567')).toBe(true);
    expect(isSenegalMobile('331234567')).toBe(false);
  });
});

describe('identityOf', () => {
  it('builds the name from the parts that exist, never « undefined »', () => {
    expect(identityOf({ msisdn: '770000001', firstName: 'Fatou', lastName: 'Sarr' })).toEqual({
      msisdn: '770000001',
      fullName: 'Fatou Sarr',
      firstName: 'Fatou',
      lastName: 'Sarr',
    });
    expect(identityOf({ firstName: 'undefined', lastName: undefined }).fullName).toBeNull();
    expect(identityOf(null)).toEqual({
      msisdn: null,
      fullName: null,
      firstName: null,
      lastName: null,
    });
  });
});
