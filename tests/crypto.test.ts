import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';

describe('secret encryption', () => {
  it('round-trips a secret', () => {
    const enc = encryptSecret('smtp-password-123');
    expect(enc).not.toContain('smtp-password-123');
    expect(decryptSecret(enc)).toBe('smtp-password-123');
  });

  it('produces a different ciphertext every time', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered payloads', () => {
    const enc = encryptSecret('secret');
    const parts = enc.split('.');
    const data = Buffer.from(parts[3]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptSecret('garbage')).toThrow();
    expect(() => decryptSecret('v2.a.b.c')).toThrow();
  });
});