import { describe, expect, it } from 'vitest';
import { extractEmails } from '../src/lib/email-extract';

describe('extractEmails', () => {
  it('prefers same-domain business addresses', () => {
    const html = `
      <a href="mailto:info@acmeplumbing.com.au">Email us</a>
      <p>webdesign@someagency.com made this site</p>
      <p>random.person1987@gmail.com</p>`;
    expect(extractEmails(html, 'https://acmeplumbing.com.au')[0]).toBe('info@acmeplumbing.com.au');
  });

  it('filters asset false-positives and junk', () => {
    const html = `
      logo@2x.png hero@3x.jpg
      noreply@acme.com abuse@acme.com
      someone@example.com
      contact@acme.com`;
    expect(extractEmails(html, 'https://acme.com')).toEqual(['contact@acme.com']);
  });

  it('ranks business prefixes over personal-looking addresses', () => {
    const html = 'zzzz.qqqq@acme.com hello@acme.com';
    expect(extractEmails(html, 'https://acme.com')[0]).toBe('hello@acme.com');
  });

  it('returns nothing for pages without emails', () => {
    expect(extractEmails('<p>call us on 0400 000 000</p>', 'https://acme.com')).toEqual([]);
  });
});