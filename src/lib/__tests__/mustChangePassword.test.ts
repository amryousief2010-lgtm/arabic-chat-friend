import { describe, it, expect } from 'vitest';
import { mustChangePassword, validateNewPassword } from '@/lib/mustChangePassword';

describe('mustChangePassword', () => {
  it('is true only when the metadata flag is set', () => {
    expect(mustChangePassword({ user_metadata: { must_change_password: true } })).toBe(true);
    expect(mustChangePassword({ user_metadata: { must_change_password: 'true' } })).toBe(true);
    expect(mustChangePassword({ user_metadata: { must_change_password: false } })).toBe(false);
    expect(mustChangePassword({ user_metadata: {} })).toBe(false);
    expect(mustChangePassword(null)).toBe(false);
  });
});

describe('validateNewPassword', () => {
  it('rejects short, letters-only, digits-only and mismatched passwords', () => {
    expect(validateNewPassword('ab1', 'ab1')).toMatch(/٨|8/);
    expect(validateNewPassword('abcdefgh', 'abcdefgh')).toMatch(/حروف وأرقام/);
    expect(validateNewPassword('12345678', '12345678')).toMatch(/حروف وأرقام/);
    expect(validateNewPassword('abcd1234', 'abcd1235')).toMatch(/متطابقتين/);
  });
  it('accepts a valid matching password', () => {
    expect(validateNewPassword('Soha2026x', 'Soha2026x')).toBeNull();
  });
});
