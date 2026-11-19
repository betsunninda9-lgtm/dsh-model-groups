import z from '@deepseek-ai/schemastery';

// This namespace belongs to the plugin. It is intentionally not rendered as a
// second settings page: editing happens in settings.models.provider-card.
export const Config = z.object({
  // Internal recovery copies can contain legacy authentication fields. Ordinary
  // Settings reads must redact the whole tree; trusted backend reads stay intact.
  bridge: z.object({ providers: z.dict(z.any()).default({}) }).default({}).volatile().role('secret'),
});
