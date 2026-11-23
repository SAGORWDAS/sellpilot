import { z } from 'zod';

export const projectTypeSchema = z.enum(['service', 'app', 'store', 'saas', 'other']);
export const projectGoalSchema = z.enum(['book_call', 'buy_product', 'install_app', 'signup', 'other']);

export const offerProfileSchema = z.object({
  businessName: z.string(),
  tagline: z.string(),
  description: z.string(),
  offerings: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      price: z.string().nullable(),
    }),
  ),
  valueProps: z.array(z.string()),
  proofPoints: z.array(z.string()),
  targetAudience: z.string(),
  differentiators: z.array(z.string()),
  tone: z.enum(['professional', 'friendly', 'direct']),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});
export type OfferProfile = z.infer<typeof offerProfileSchema>;

export const closeActionSchema = z.object({
  kind: projectGoalSchema,
  url: z.string(),
  instructions: z.string(),
});
export type CloseAction = z.infer<typeof closeActionSchema>;

export const discoveryQuerySchema = z.object({
  kind: z.enum(['places', 'search']),
  query: z.string(),
  location: z.string().nullable(),
});

export const strategySchema = z.object({
  icp: z.string(),
  discoveryQueries: z.array(discoveryQuerySchema),
  angles: z.array(
    z.object({
      name: z.string(),
      hook: z.string(),
      pitch: z.string(),
    }),
  ),
  sequence: z.array(
    z.object({
      step: z.number().int().min(0),
      delayDays: z.number().int().min(0),
      goal: z.string(),
      guidance: z.string(),
    }),
  ),
  objectionHandling: z.array(z.object({ objection: z.string(), response: z.string() })),
  sampleEmail: z.object({ subject: z.string(), body: z.string() }),
});
export type Strategy = z.infer<typeof strategySchema>;

export const audienceSchema = z.object({
  mode: z.enum(['local', 'generic']),
  niche: z.string().nullable(),
  location: z.string().nullable(),
  description: z.string().nullable(),
});
export type Audience = z.infer<typeof audienceSchema>;

export const siteAuditSchema = z.object({
  reachable: z.boolean(),
  https: z.boolean(),
  mobileFriendly: z.boolean(),
  hasContactForm: z.boolean(),
  title: z.string().nullable(),
  issues: z.array(z.string()),
  summary: z.string(),
});
export type SiteAudit = z.infer<typeof siteAuditSchema>;

export const leadSequenceSchema = z.object({
  steps: z.array(z.object({ subject: z.string(), body: z.string() })),
});
export type LeadSequence = z.infer<typeof leadSequenceSchema>;

export const replyCategorySchema = z.enum([
  'interested',
  'question',
  'objection',
  'not_interested',
  'out_of_office',
  'unsubscribe',
  'bounce',
  'other',
]);
export type ReplyCategory = z.infer<typeof replyCategorySchema>;

export const replyDecisionSchema = z.object({
  category: replyCategorySchema,
  shouldReply: z.boolean(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  reasoning: z.string(),
});
export type ReplyDecision = z.infer<typeof replyDecisionSchema>;