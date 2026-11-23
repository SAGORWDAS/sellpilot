import { describe, expect, it } from 'vitest';
import { parseLeadCsv } from '../src/lib/csv';

describe('parseLeadCsv', () => {
  it('maps flexible headers and validates emails', () => {
    const csv = `Company,E-mail,Website,Phone
Acme Plumbing,info@acme.com,https://acme.com,0400111222
Bad Row,not-an-email,,
Beta Electric,hello@beta.com.au,,
Acme Plumbing,info@acme.com,,`;
    const { rows, skipped } = parseLeadCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      businessName: 'Acme Plumbing',
      email: 'info@acme.com',
      website: 'https://acme.com',
      phone: '0400111222',
    });
    expect(skipped).toBe(2);
  });

  it('handles quoted commas', () => {
    const csv = `name,email,city
"Smith, Jones & Co",office@sj.com,"Sydney, NSW"`;
    const { rows } = parseLeadCsv(csv);
    expect(rows[0]?.businessName).toBe('Smith, Jones & Co');
    expect(rows[0]?.city).toBe('Sydney, NSW');
  });

  it('requires an email column', () => {
    const { rows, skipped } = parseLeadCsv('name,phone\nAcme,123\nBeta,456');
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it('falls back to domain when name missing', () => {
    const { rows } = parseLeadCsv('email\ninfo@acme.com');
    expect(rows[0]?.businessName).toBe('acme.com');
  });
});