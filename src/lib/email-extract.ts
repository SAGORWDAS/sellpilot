const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const MAILTO_RE = /mailto:([^"'?>\s]+)/gi;

const ASSET_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js', 'json', 'woff', 'woff2', 'ttf', 'ico', 'mp4', 'webm']);
const JUNK_DOMAINS = ['example.com', 'example.org', 'domain.com', 'email.com', 'sentry.io', 'wixpress.com', 'sentry-next.wixpress.com', 'godaddy.com', 'cloudflare.com'];
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|privacy|webmaster|u\d|.*\.(png|jpg|gif|svg))$/;
const BUSINESS_PREFIXES = ['info', 'contact', 'hello', 'office', 'admin', 'sales', 'enquiries', 'inquiries', 'mail', 'reception', 'bookings'];

export function extractEmails(html: string, siteUrl: string | null): string[] {
  const found = new Map<string, number>();

  const add = (raw: string, bonus: number) => {
    const email = raw.toLowerCase().trim().replace(/\.$/, '');
    if (!EMAIL_RE.test(email)) {
      EMAIL_RE.lastIndex = 0;
      return;
    }
    EMAIL_RE.lastIndex = 0;
    const [local, domain] = email.split('@') as [string, string];
    const tld = domain.split('.').pop() ?? '';
    if (ASSET_TLDS.has(tld)) return;
    if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return;
    if (JUNK_LOCAL.test(local)) return;
    if (local.length > 64 || domain.length > 253) return;
    found.set(email, (found.get(email) ?? 0) + bonus);
  };

  for (const m of html.matchAll(MAILTO_RE)) {
    if (m[1]) add(decodeURIComponent(m[1]), 4);
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    add(m[0], 1);
  }

  let siteDomain: string | null = null;
  if (siteUrl) {
    try {
      siteDomain = new URL(siteUrl).hostname.replace(/^www\./, '');
    } catch {
      siteDomain = null;
    }
  }

  const scored = [...found.entries()].map(([email, bonus]) => {
    const [local, domain] = email.split('@') as [string, string];
    let score = bonus;
    if (siteDomain && (domain === siteDomain || domain.endsWith(`.${siteDomain}`))) score += 10;
    const prefixIndex = BUSINESS_PREFIXES.indexOf(local);
    if (prefixIndex >= 0) score += 5 - prefixIndex * 0.1;
    if (/\d{4,}/.test(local)) score -= 2;
    return { email, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.email);
}