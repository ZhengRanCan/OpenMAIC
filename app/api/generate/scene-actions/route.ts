/**
 * Scene Actions Generation API
 *
 * Generates actions for a scene given its outline and content,
 * then assembles the complete Scene object.
 * This is the second half of the two-step scene generation pipeline.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import {
  generateSceneActions,
  buildCompleteScene,
  buildVisionUserContent,
  type SceneGenerationContext,
  type AgentInfo,
} from '@/lib/generation/generation-pipeline';
import type { SceneOutline } from '@/lib/types/generation';
import type {
  GeneratedSlideContent,
  GeneratedQuizContent,
  GeneratedInteractiveContent,
  GeneratedPBLContent,
} from '@/lib/types/generation';
import type { SpeechAction } from '@/lib/types/action';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { llmApiError } from '@/lib/server/llm-error-response';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import {
  appendFormalTeachingPrompt,
  formalFusionErrorResponse,
  FormalFusionError,
  resolveFormalFusion,
} from '@/lib/fusion/generation-session';
import {
  classifyOutlineContent,
  OutlineContentTypeMismatchError,
  reconcileFusionOutline,
} from '@/lib/generation/outline-reconciliation';

const log = createLogger('Scene Actions API');

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let outlineTitle: string | undefined;
  let resolvedModelString: string | undefined;
  try {
    const body = await req.json();
    const formalFusion = await resolveFormalFusion(req, body.lessonSessionId);
    const {
      outline,
      allOutlines,
      content,
      stageId,
      agents,
      previousSpeeches: incomingPreviousSpeeches,
      userProfile,
      languageDirective,
      fallbackReason,
    } = body as {
      outline: SceneOutline;
      allOutlines: SceneOutline[];
      content:
        | GeneratedSlideContent
        | GeneratedQuizContent
        | GeneratedInteractiveContent
        | GeneratedPBLContent;
      stageId: string;
      agents?: AgentInfo[];
      previousSpeeches?: string[];
      userProfile?: string;
      languageDirective?: string;
      fallbackReason?: {
        reason: 'content-route-fallback';
        requestedType: SceneOutline['type'];
        effectiveType: SceneOutline['type'];
        contentShape: 'slide-shaped' | 'quiz-shaped' | 'interactive-shaped' | 'pbl-shaped' | 'unknown';
      };
    };

    // Validate required fields
    if (!outline) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'outline is required');
    }
    if (!allOutlines || allOutlines.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'allOutlines is required and must not be empty',
      );
    }
    if (!content) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'content is required');
    }
    if (!stageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required');
    }
    if (formalFusion.kind === 'resolved' && !formalFusion.outlines) {
      throw new FormalFusionError('FUSION_CONTEXT_INVALID');
    }

    // ── Model resolution from request headers/body ──
    const {
      model: languageModel,
      modelInfo,
      modelString,
      thinkingConfig,
    } = await resolveModelFromRequest(req, body, 'scene-actions');
    const serverOutline =
      formalFusion.kind === 'resolved'
        ? (() => {
            const stored = formalFusion.outlines?.find((candidate) => candidate.id === outline.id);
            if (!stored) throw new FormalFusionError('FUSION_CONTEXT_INVALID');
            return stored;
          })()
        : outline;
    const reconciliation =
      formalFusion.kind === 'resolved'
        ? reconcileFusionOutline({
            serverOutline,
            browserOutline: outline,
            content,
            fallbackEvidence: fallbackReason,
          })
        : {
            outline: outline,
            contentShape: classifyOutlineContent(content),
            reason: 'server-canonical' as const,
          };
    const effectiveOutline = reconciliation.outline;
    log.info('Resolved scene outline for actions', {
      sceneId: effectiveOutline.id,
      browserType: outline.type,
      serverType: serverOutline.type,
      effectiveType: effectiveOutline.type,
      contentShape: reconciliation.contentShape,
      reason: reconciliation.reason,
    });
    outlineTitle = effectiveOutline?.title;
    resolvedModelString = modelString;

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;

    // AI call function (actions typically don't use vision, but kept for consistency)
    const aiCall = async (
      systemPrompt: string,
      userPrompt: string,
      images?: Array<{ id: string; src: string }>,
    ): Promise<string> => {
      if (images?.length && hasVision) {
        const result = await callLLM(
          {
            model: languageModel,
            system: systemPrompt,
            messages: [
              {
                role: 'user' as const,
                content: buildVisionUserContent(userPrompt, images),
              },
            ],
            maxOutputTokens: modelInfo?.outputWindow,
            maxRetries: 0,
          },
          'scene-actions',
          undefined,
          thinkingConfig,
        );
        return result.text;
      }
      const result = await callLLM(
        {
          model: languageModel,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: modelInfo?.outputWindow,
          maxRetries: 0,
        },
        'scene-actions',
        undefined,
        thinkingConfig,
      );
      return result.text;
    };

    // ── Build cross-scene context ──
    const effectiveAllOutlines =
      formalFusion.kind === 'resolved'
        ? (formalFusion.outlines ?? []).map((candidate) =>
            candidate.id === effectiveOutline.id ? effectiveOutline : candidate,
          )
        : allOutlines.map((candidate) =>
            candidate.id === effectiveOutline.id ? effectiveOutline : candidate,
          );
    const allTitles = effectiveAllOutlines.map((o) => o.title);
    const pageIndex = effectiveAllOutlines.findIndex((o) => o.id === effectiveOutline.id);
    const ctx: SceneGenerationContext = {
      pageIndex: (pageIndex >= 0 ? pageIndex : 0) + 1,
      totalPages: effectiveAllOutlines.length,
      allTitles,
      previousSpeeches: incomingPreviousSpeeches ?? [],
    };
    const effectiveLanguageDirective = appendFormalTeachingPrompt(
      formalFusion.kind === 'resolved' ? undefined : languageDirective,
      formalFusion.kind === 'resolved' ? formalFusion.context : undefined,
    );

    // ── Generate actions ──
    log.info(`Generating actions: "${outline.title}" (${outline.type}) [model=${modelString}]`);

    const actions = await generateSceneActions(effectiveOutline, content, aiCall, {
      ctx,
      agents: formalFusion.kind === 'resolved' ? undefined : agents,
      userProfile: formalFusion.kind === 'resolved' ? undefined : userProfile,
      languageDirective: effectiveLanguageDirective,
    });

    log.info(`Generated ${actions.length} actions for: "${outline.title}"`);

    // ── Build complete scene ──
    const scene = buildCompleteScene(effectiveOutline, content, actions, stageId);

    if (!scene) {
      const contentKind =
        content && typeof content === 'object'
          ? 'type' in content
            ? String((content as { type?: unknown }).type)
            : 'elements' in content
              ? 'slide-shaped'
              : 'html' in content
                ? 'interactive-shaped'
                : 'unknown'
          : 'unknown';
      log.error(
        `Failed to build scene: "${effectiveOutline.title}" (sceneId=${effectiveOutline.id}, browserType=${outline.type}, serverType=${serverOutline.type}, outlineType=${effectiveOutline.type}, contentType=${contentKind}, fallbackReason=${fallbackReason ?? 'none-or-upstream'})`,
      );

      return apiError(
        'GENERATION_FAILED',
        500,
        `Failed to build scene: ${effectiveOutline.title} (scene id=${effectiveOutline.id}, browser type=${outline.type}, server type=${serverOutline.type}, outline type=${effectiveOutline.type}, content type=${contentKind}, fallback reason=${fallbackReason ?? 'none-or-upstream'})`,
      );
    }

    // ── Extract speeches for cross-scene coherence ──
    const outputPreviousSpeeches = (scene.actions || [])
      .filter((a): a is SpeechAction => a.type === 'speech')
      .map((a) => a.text);

    log.info(
      `Scene assembled successfully: "${outline.title}" — ${scene.actions?.length ?? 0} actions`,
    );

    return apiSuccess({ scene, previousSpeeches: outputPreviousSpeeches });
  } catch (error) {
    if (error instanceof FormalFusionError) return formalFusionErrorResponse(error);
    if (error instanceof OutlineContentTypeMismatchError) {
      log.error('Outline/content reconciliation rejected generation', error.diagnostics);
      return apiError(
        error.code,
        409,
        `${error.message} (reconciliation reason=${error.diagnostics.reason})`,
      );
    }
    log.error(
      `Scene actions generation failed [scene="${outlineTitle ?? 'unknown'}", model=${resolvedModelString ?? 'unknown'}]:`,
      error,
    );
    return llmApiError(error);
  }
}
