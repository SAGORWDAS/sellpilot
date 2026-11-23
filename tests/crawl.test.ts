import { describe, expect, it } from 'vitest';
import { assertPublicUrl, extractText, findSubpages } from '../src/lib/crawl';
import { ValidationError } from '../src/lib/errors';

describe('extractText', () => {
  it('strips scripts, styles and tags, keeps title', () => {
    const html = `<html><head><title>Acme &amp; Co</title><style>.x{color:red}</style></head>
      <body><script>alert(1)</script><h1>We build websites</h1><p>Fast &amp; affordable.</p></body></html>`;
    const { title, text } = extractText(html);
    expect(title).toBe('Acme & Co');
    expect(text).toContain('We build websites');
    expect(text).toContain('Fast & affordable.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('decodes numeric entities', () => {
    expect(extractText('<p>&#8212; &#x2764;</p>').text).toBe('— ❤');
  });
});

describe('assertPublicUrl', () => {
  it('accepts public https URLs', () => {
    expect(assertPublicUrl('https://example.com').hostname).toBe('example.com');
  });

  it('blocks private and local targets', () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1/x',
      'http://10.0.0.5',
      'http://192.168.1.1',
      'http://172.16.0.1',
      'http://169.254.169.254/latest',
      'http://[::1]/',
      'http://printer.local',
      'file:///etc/passwd',
      'ftp://example.com',
    ]) {
      expect(() => assertPublicUrl(url)).toThrow(ValidationError);
    }
  });

  it('rejects garbage', () => {
    expect(() => assertPublicUrl('not a url')).toThrow(ValidationError);
  });
});

describe('findSubpages', () => {
  it('finds same-origin about/contact links only', () => {
    const html = `
      <a href="/about-us">About</a>
      <a href="https://other.com/contact">Other</a>
      <a href="/contact#form">Contact</a>
      <a href="/blog/post-1">Blog</a>`;
    const links = findSubpages(html, 'https://acme.com/');
    expect(links).toEqual(['https://acme.com/about-us', 'https://acme.com/contact']);
  });
});