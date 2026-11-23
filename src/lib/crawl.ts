import { ValidationError } from '@/lib/errors';

const UA = 'Mozilla/5.0 (compatible; SellPilot/1.0)';
const MAX_HTML = 2_000_000;
const MAX_TEXT = 24_000;

export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Enter a valid URL', { url: 'Enter a valid URL.' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only http and https URLs are supported', { url: 'Use http or https.' });
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) {
    throw new ValidationError('That URL is not reachable', { url: 'Use a public website URL.' });
  }
  return url;
}

export function extractText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] ? decodeEntities(titleMatch[1]).trim() : null;
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return { title, text };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export async function fetchPage(
  rawUrl: string,
  timeoutMs = 15_000,
): Promise<{ url: string; html: string } | null> {
  const url = assertPublicUrl(rawUrl);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html') && !type.includes('application/xhtml')) return null;
    const html = (await res.text()).slice(0, MAX_HTML);
    return { url: res.url || url.toString(), html };
  } catch {
    return null;
  }
}

const SUBPAGE_PATTERN = /about|contact|pricing|service|product|feature/i;

export function findSubpages(html: string, baseUrl: string, limit = 2): string[] {
  const base = new URL(baseUrl);
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href) continue;
    try {
      const abs = new URL(href, base);
      if (abs.hostname !== base.hostname) continue;
      if (abs.pathname === base.pathname) continue;
      if (!SUBPAGE_PATTERN.test(abs.pathname)) continue;
      abs.hash = '';
      found.add(abs.toString());
      if (found.size >= limit) break;
    } catch {
      continue;
    }
  }
  return [...found];
}

export async function crawlOffer(urls: string[]): Promise<string> {
  const sections: string[] = [];
  let total = 0;

  for (const raw of urls.slice(0, 3)) {
    const page = await fetchPage(raw);
    if (!page) continue;
    const { title, text } = extractText(page.html);
    const section = `## Page: ${page.url}\nTitle: ${title ?? ''}\n${text}`;
    sections.push(section);
    total += section.length;
    if (total >= MAX_TEXT) break;

    for (const sub of findSubpages(page.html, page.url)) {
      const subPage = await fetchPage(sub);
      if (!subPage) continue;
      const extracted = extractText(subPage.html);
      const subSection = `## Page: ${subPage.url}\nTitle: ${extracted.title ?? ''}\n${extracted.text}`;
      sections.push(subSection);
      total += subSection.length;
      if (total >= MAX_TEXT) break;
    }
    if (total >= MAX_TEXT) break;
  }

  return sections.join('\n\n').slice(0, MAX_TEXT);
}