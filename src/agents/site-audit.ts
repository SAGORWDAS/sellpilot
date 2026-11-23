import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/db';
import { leads, suppressions } from '@/db/schema';
import { extractText, fetchPage, findSubpages } from '@/lib/crawl';
import { extractEmails } from '@/lib/email-extract';
import { NotFound } from '@/lib/errors';
import type { SiteAudit } from '@/lib/schemas';

function pickHook(audit: SiteAudit): string {
  if (!audit.reachable) return 'their website appears to be down or unreachable';
  if (!audit.mobileFriendly) return 'their website is hard to use on a phone';
  if (!audit.https) return 'their website shows a "not secure" warning in browsers';
  if (!audit.hasContactForm) return 'their website has no easy way for customers to get in touch';
  if (audit.issues.some((i) => i.includes('outdated'))) return 'their website looks dated';
  return 'their website could do more to turn visitors into customers';
}

export async function auditLead(
  db: Database,
  input: { organizationId: string; leadId: string },
): Promise<void> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)))
    .limit(1);
  if (!lead) throw new NotFound('Lead not found');
  if (!['discovered', 'audited'].includes(lead.status)) return;

  let audit: SiteAudit = {
    reachable: false,
    https: false,
    mobileFriendly: false,
    hasContactForm: false,
    title: null,
    issues: ['Website did not load'],
    summary: 'The website could not be reached.',
  };
  let email: string | null = lead.email;

  if (lead.website) {
    const page = await fetchPage(lead.website);
    if (page) {
      const { title, text } = extractText(page.html);
      const https = new URL(page.url).protocol === 'https:';
      const mobileFriendly = /<meta[^>]+name=["']viewport["'][^>]+width=device-width/i.test(page.html);
      const hasContactForm = /<form[\s>]/i.test(page.html);
      const yearMatch = /(?:©|copyright)\s*(?:\(c\)\s*)?(\d{4})/i.exec(page.html);
      const staleYear = yearMatch?.[1] ? Number(yearMatch[1]) < new Date().getFullYear() - 2 : false;

      const issues: string[] = [];
      if (!https) issues.push('No HTTPS security');
      if (!mobileFriendly) issues.push('Not mobile-friendly');
      if (!hasContactForm) issues.push('No contact form');
      if (staleYear) issues.push(`Copyright year looks outdated (${yearMatch![1]})`);

      audit = {
        reachable: true,
        https,
        mobileFriendly,
        hasContactForm,
        title,
        issues,
        summary:
          issues.length > 0
            ? `Website audit found: ${issues.join('; ').toLowerCase()}.`
            : 'Website is in decent shape; pitch on results rather than fixes.',
      };

      if (!email) {
        let emails = extractEmails(page.html, page.url);
        if (emails.length === 0) {
          for (const sub of findSubpages(page.html, page.url, 2)) {
            const subPage = await fetchPage(sub);
            if (!subPage) continue;
            emails = extractEmails(subPage.html, subPage.url);
            if (emails.length > 0) break;
          }
        }
        email = emails[0] ?? null;
      }
    }
  }

  let status: 'audited' | 'suppressed' = 'audited';
  if (email) {
    const [suppressed] = await db
      .select()
      .from(suppressions)
      .where(inArray(suppressions.email, [email.toLowerCase()]))
      .limit(1);
    if (suppressed) status = 'suppressed';
  }

  await db
    .update(leads)
    .set({
      audit,
      hook: pickHook(audit),
      email,
      status,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, lead.id));
}