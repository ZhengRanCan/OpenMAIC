import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { QuizTraceError } from '@/lib/quiz/trace-validation';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { readSimulatedLearningLoopConfig } from '@/lib/server/quiz-learning-loop/config';
import { QuizPracticeService } from '@/lib/server/quiz-practice';

export const maxDuration = 45;

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const locator = { attemptId: id, versionId: id, submissionId: id, reviewId: id };
const lookup = z.strictObject(locator);
const action = z.discriminatedUnion('action', [
  z.strictObject({
    ...locator,
    action: z.literal('accept'),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)
      .max(24),
    retryToken: z.uuid().optional(),
  }),
  z.strictObject({ ...locator, action: z.literal('submit'), choice: z.enum(['A', 'B', 'C', 'D']) }),
  z.strictObject({ ...locator, action: z.literal('help'), helpId: z.uuid() }),
]);

function handle(req: NextRequest, method: 'GET' | 'POST') {
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      if (method === 'POST' && !isSameOriginJsonRequest(req))
        return Response.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
      if (
        process.env.OPENMAIC_QUIZ_FEEDBACK !== 'true' ||
        process.env.OPENMAIC_QUIZ_PRACTICE !== 'true'
      )
        return Response.json({ status: 'disabled' }, { headers });
      const config = readSimulatedLearningLoopConfig();
      if (config?.sourceNature !== 'synthetic')
        return Response.json({ status: 'disabled' }, { headers });
      const service = new QuizPracticeService(
        await getServerPersistenceProvider(process.env.DATABASE_URL ?? ''),
      );
      const options = (source: z.infer<typeof lookup>, language = 'en-US') => ({
        owner: principal.ownerId,
        locator: source,
        environment: config.memoryEnvironmentId,
        language,
      });
      if (method === 'GET') {
        const input = lookup.safeParse(Object.fromEntries(req.nextUrl.searchParams));
        if (!input.success)
          return Response.json({ error: 'INVALID_LOCATOR' }, { status: 400, headers });
        return Response.json(await service.read(options(input.data)), { headers });
      }
      const input = action.safeParse(await req.json().catch(() => null));
      if (!input.success)
        return Response.json({ error: 'INVALID_ACTION' }, { status: 400, headers });
      const body = input.data;
      const result =
        body.action === 'accept'
          ? await service.accept(options(body, body.language), body.retryToken)
          : body.action === 'submit'
            ? await service.submit(options(body), body.choice)
            : await service.help(options(body), body.helpId);
      return Response.json(result, { headers });
    } catch (error) {
      const status = error instanceof QuizTraceError ? error.status : 503;
      return Response.json({ error: 'QUIZ_PRACTICE_UNAVAILABLE' }, { status, headers });
    }
  });
}

export const GET = (req: NextRequest) => handle(req, 'GET');
export const POST = (req: NextRequest) => handle(req, 'POST');
