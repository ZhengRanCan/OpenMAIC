import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { QuizTraceError } from '@/lib/quiz/trace-validation';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { QuizFeedbackService } from '@/lib/server/quiz-feedback';
import { readSimulatedLearningLoopConfig } from '@/lib/server/quiz-learning-loop/config';

export const maxDuration = 45;

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const locator = {
  attemptId: identifier,
  versionId: identifier,
  submissionId: identifier,
  reviewId: identifier,
};
const lookup = z.strictObject(locator);
const request = z.strictObject({
  ...locator,
  language: z
    .string()
    .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
    .max(32),
  retryToken: z.uuid().optional(),
});

function handle(req: NextRequest, method: 'GET' | 'POST') {
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      if (method === 'POST' && !isSameOriginJsonRequest(req))
        return Response.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
      if (process.env.OPENMAIC_QUIZ_FEEDBACK !== 'true')
        return Response.json({ status: 'disabled' }, { headers });
      const config = readSimulatedLearningLoopConfig();
      if (config?.sourceNature !== 'synthetic')
        return Response.json({ status: 'disabled' }, { headers });
      const parsed =
        method === 'GET'
          ? lookup.safeParse(Object.fromEntries(req.nextUrl.searchParams))
          : request.safeParse(await req.json().catch(() => null));
      if (!parsed.success)
        return Response.json({ error: 'INVALID_LOCATOR' }, { status: 400, headers });
      const service = new QuizFeedbackService(
        await getServerPersistenceProvider(process.env.DATABASE_URL ?? ''),
      );
      const options = {
        owner: principal.ownerId,
        locator: parsed.data,
        environment: config.memoryEnvironmentId,
        language:
          'language' in parsed.data && typeof parsed.data.language === 'string'
            ? parsed.data.language
            : 'en-US',
      };
      const result =
        method === 'GET'
          ? await service.read(options)
          : await service.generate(
              options,
              'retryToken' in parsed.data && typeof parsed.data.retryToken === 'string'
                ? parsed.data.retryToken
                : undefined,
            );
      return Response.json(result, { headers });
    } catch (error) {
      const status = error instanceof QuizTraceError ? error.status : 503;
      return Response.json({ error: 'QUIZ_FEEDBACK_UNAVAILABLE' }, { status, headers });
    }
  });
}

export const GET = (req: NextRequest) => handle(req, 'GET');
export const POST = (req: NextRequest) => handle(req, 'POST');
