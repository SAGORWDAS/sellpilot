import { z } from 'zod';

export type CsvLead = {
  businessName: string;
  email: string;
  website: string | null;
  phone: string | null;
  city: string | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_MAP: Record<string, keyof CsvLead> = {
  name: 'businessName',
  business: 'businessName',
  businessname: 'businessName',
  company: 'businessName',
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  website: 'website',
  url: 'website',
  site: 'website',
  phone: 'phone',
  telephone: 'phone',
  city: 'city',
  location: 'city',
  address: 'city',
};

const emailSchema = z.string().email();

export function parseLeadCsv(text: string, limit = 500): { rows: CsvLead[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], skipped: 0 };

  const headers = parseCsvLine(lines[0]!.toLowerCase()).map(
    (h) => HEADER_MAP[h.replace(/\s+/g, '')] ?? null,
  );
  if (!headers.includes('email')) return { rows: [], skipped: lines.length - 1 };

  const rows: CsvLead[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (const line of lines.slice(1, limit + 1)) {
    const cells = parseCsvLine(line);
    const record: Partial<CsvLead> = {};
    headers.forEach((key, i) => {
      const value = cells[i];
      if (key && value) record[key] = value;
    });
    const email = record.email?.toLowerCase();
    if (!email || !emailSchema.safeParse(email).success || seen.has(email)) {
      skipped++;
      continue;
    }
    seen.add(email);
    rows.push({
      businessName: record.businessName || email.split('@')[1] || email,
      email,
      website: record.website ?? null,
      phone: record.phone ?? null,
      city: record.city ?? null,
    });
  }
  skipped += Math.max(0, lines.length - 1 - limit);
  return { rows, skipped };
}