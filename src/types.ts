import { z } from 'zod';

export const EVENT_TYPES = [
  'commit',
  'pr_opened',
  'pr_merged',
  'pr_closed',
  'issue_opened',
  'issue_closed',
  'release',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  id: z.string(),
  repo: z.string(),
  type: EventTypeSchema,
  timestamp: z.string(),
  actor: z.string(),
  title: z.string(),
  url: z.string(),
  shortId: z.string(),
});
export type Event = z.infer<typeof EventSchema>;

export const DatasetSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number(),
  repos: z.array(z.string()),
  funds: z.record(z.string(), z.array(z.string())).default({}),
  events: z.array(EventSchema),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const ConfigSchema = z.object({
  fund: z.string().optional(),
  repos: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected "owner/name"')),
  /** When true, fetch adds every public repo in each org the token user belongs to. */
  include_all_org_repos: z.boolean().optional().default(false),
});
export type Config = z.infer<typeof ConfigSchema>;
