import OpenAI from 'openai';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { Database } from '@/db';
import { apiUsage, orgSettings } from '@/db/schema';
import { assertCampaignBudget } from '@/lib/budget';
import { decryptSecret } from '@/lib/crypto';

const RATES: Record<string, { input: number; output: number }> = {
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(RATES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  const rate = (key ? RATES[key] : RATES['gpt-5-mini'])!;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

const UNSUPPORTED_KEYS = new Set([
  '$schema',
  '$id',
  'id',
  'default',
  'examples',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
]);

export function buildJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;
      out[k] = walk(v);
    }
    if (out['type'] === 'object' || out['properties']) {
      out['additionalProperties'] = false;
      const props = (out['properties'] ?? {}) as Record<string, unknown>;
      out['required'] = Object.keys(props);
    }
    return out;
  };

  return walk(raw) as Record<string, unknown>;
}

async function resolveApiKey(db: Database, organizationId: string): Promise<string> {
  const [settings] = await db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, organizationId))
    .limit(1);
  if (settings?.openaiKeyEnc) return decryptSecret(settings.openaiKeyEnc);
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No OpenAI API key configured (settings or OPENAI_API_KEY)');
  return key;
}

export type CompleteOptions<T> = {
  organizationId: string;
  campaignId?: string | null;
  operation: string;
  tier: 'bulk' | 'smart';
  schema: z.ZodType<T>;
  name: string;
  system: string;
  user: string;
  maxTokens?: number;
};

export async function complete<T>(db: Database, opts: CompleteOptions<T>): Promise<T> {
  if (opts.campaignId) {
    await assertCampaignBudget(db, opts.campaignId);
  }

  const model =
    opts.tier === 'smart'
      ? (process.env.OPENAI_MODEL_SMART ?? 'gpt-5')
      : (process.env.OPENAI_MODEL_BULK ?? 'gpt-5-mini');
  const isReasoning = /^(gpt-5|o\d)/.test(model);
  const client = new OpenAI({ apiKey: await resolveApiKey(db, opts.organizationId) });
  const jsonSchema = buildJsonSchema(opts.schema);

  let lastError = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: opts.system },
        {
          role: 'user',
          content:
            attempt === 0
              ? opts.user
              : `${opts.user}\n\nYour previous answer failed validation: ${lastError}. Return corrected JSON only.`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: opts.name, strict: true, schema: jsonSchema },
      },
      max_completion_tokens: opts.maxTokens ?? 4000,
      ...(isReasoning ? { reasoning_effort: opts.tier === 'smart' ? 'medium' : 'low' } : {}),
    });

    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    await db.insert(apiUsage).values({
      id: uuidv7(),
      organizationId: opts.organizationId,
      campaignId: opts.campaignId ?? null,
      provider: 'openai',
      model,
      operation: opts.operation,
      inputTokens,
      outputTokens,
      costUsd: computeCost(model, inputTokens, outputTokens),
    });

    const content = res.choices[0]?.message?.content;
    if (!content) {
      lastError = 'empty response';
      continue;
    }
    try {
      const parsed = opts.schema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch {
      lastError = 'invalid JSON';
    }
  }
  throw new Error(`LLM output failed validation for ${opts.operation}: ${lastError}`);
}