// Optional AI assistance. The rest of the application never depends on this module working.
// Only text the user typed into the AI form is sent to the provider: no profiles, messages or files.
// The prompts and the Claude call live in the model package (model/src/assistant.ts);
// this file handles access, the daily limit and the messages users see.
import { AssistantError, createAssistant, FEATURES, type AssistFailure, type AssistFeature } from '@peerconnect/model';
import type { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { HttpError, log } from '../lib/core.js';
import { COLLABORATORS, required, route } from '../lib/route.js';

export const aiAvailable = () => !!config.ai.apiKey;

const assistant = config.ai.apiKey ? createAssistant({ apiKey: config.ai.apiKey, model: config.ai.model }) : null;

const UNAVAILABLE = 'AI assistance is not available right now. Everything else keeps working.';

/** What the user is told for each way the assistant can fail. */
function userFacingError(reason: AssistFailure) {
  switch (reason) {
    case 'declined': return new HttpError(422, 'AI_DECLINED', 'The assistant could not help with that request.');
    case 'empty': return new HttpError(503, 'AI_UNAVAILABLE', 'The assistant returned no answer. Please try again.');
    case 'busy': return new HttpError(503, 'AI_BUSY', 'The assistant is busy. Please try again shortly.');
    default: return new HttpError(503, 'AI_UNAVAILABLE', UNAVAILABLE);
  }
}

async function isEnabled() {
  const setting = await one(`SELECT value FROM platform_settings WHERE key = 'ai_enabled'`);
  return aiAvailable() && setting?.value !== false;
}

export function aiRoutes(router: Router) {
  const tag = 'AI';

  route(router, {
    tag, method: 'get', path: '/api/ai/status', summary: 'Whether AI features are available', access: COLLABORATORS,
    handler: async ({ user }) => {
      const { n } = (await one(`SELECT count(*)::int AS n FROM ai_usage WHERE user_id = $1 AND created_at > now() - interval '1 day'`, [user.id]))!;
      return { available: await isEnabled(), used: n, dailyLimit: config.ai.dailyLimit };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/ai/assist', summary: 'Run an optional AI assistance feature', access: COLLABORATORS, status: 200,
    body: z.object({ feature: z.enum(Object.keys(FEATURES) as [AssistFeature]), input: required(12000) }),
    handler: async ({ user, body }) => {
      if (!assistant || !(await isEnabled())) throw new HttpError(503, 'AI_UNAVAILABLE', UNAVAILABLE);
      // The insert is conditional, so concurrent requests cannot pass the daily limit.
      const reserved = await one(`INSERT INTO ai_usage (user_id, feature) SELECT $1, $2 WHERE (SELECT count(*) FROM ai_usage WHERE user_id = $1 AND created_at > now() - interval '1 day') < $3 RETURNING id`, [user.id, body.feature, config.ai.dailyLimit]);
      if (!reserved) throw new HttpError(429, 'AI_LIMIT_REACHED', `You have reached today's limit of ${config.ai.dailyLimit} AI requests.`);
      try {
        const answer = await assistant.ask(body.feature, body.input);
        return { aiGenerated: true, ...answer };
      } catch (error) {
        // A failed request does not count towards the daily limit.
        await q('DELETE FROM ai_usage WHERE id = $1', [reserved.id]);
        const reason = error instanceof AssistantError ? error.reason : 'failed';
        if (reason === 'bad_key') log.error('AI provider rejected the configured API key');
        if (reason === 'failed') log.warn('AI request failed', { status: error instanceof AssistantError ? error.status : undefined });
        throw userFacingError(reason);
      }
    },
  });
}
