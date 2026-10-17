import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { QuizTraceService } from '@/lib/persistence/quiz-trace';
import {
  readQuizHistory,
  readQuizAttempt,
  loadQuizForPlay,
} from '@/lib/persistence/quiz-trace-read';
import { QuizTraceError } from '@/lib/quiz/trace-validation';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
export const runtime = 'nodejs';

async function handle(req: Request) {
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      const url = new URL(req.url),
        parts = url.pathname.slice('/api/quiz-trace/'.length).split('/').map(decodeURIComponent);
      if (req.method !== 'GET' && !isSameOriginJsonRequest(req))
        return Response.json({ error: { code: 'INVALID_ORIGIN' } }, { status: 403, headers });
      if (Number(req.headers.get('content-length') ?? 0) > 2000000)
        throw new QuizTraceError('PAYLOAD_TOO_LARGE', 413);
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const service = new QuizTraceService(provider),
        owner = principal.ownerId;
      let result: unknown;
      if (req.method === 'GET') {
        if (parts[0] === 'history')
          result = await readQuizHistory(provider, owner, url.searchParams.get('stageId') ?? '');
        else if (parts[0] === 'restore')
          result = await loadQuizForPlay(
            provider,
            owner,
            url.searchParams.get('stageId') ?? '',
            url.searchParams.get('sceneId') ?? '',
          );
        else if (parts[0] === 'attempts' && parts.length === 2)
          result = await readQuizAttempt(provider, owner, parts[1]);
        else throw new QuizTraceError('NOT_FOUND', 404);
      } else {
        const text = await req.text();
        if (text.length > 2000000) throw new QuizTraceError('PAYLOAD_TOO_LARGE', 413);
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          throw new QuizTraceError('INVALID_JSON', 400);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new QuizTraceError('INVALID_REQUEST', 400);
        if (req.method === 'POST' && parts[0] === 'prepare')
          result = await service.prepare(owner, body);
        else if (req.method === 'PUT' && parts[0] === 'attempts' && parts[2] === 'draft')
          result = await service.saveDraft(owner, parts[1], body);
        else if (req.method === 'POST' && parts[0] === 'attempts' && parts[2] === 'submission')
          result = await service.submit(owner, parts[1], body);
        else throw new QuizTraceError('NOT_FOUND', 404);
      }
      return Response.json(result, { headers });
    } catch (e) {
      if (e instanceof QuizTraceError)
        return Response.json({ error: { code: e.code } }, { status: e.status, headers });
      // Never log question text, student answers, model config or credentials.
      return Response.json({ error: { code: 'QUIZ_TRACE_UNAVAILABLE' } }, { status: 503, headers });
    }
  });
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
