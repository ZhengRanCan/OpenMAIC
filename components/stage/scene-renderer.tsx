'use client';

import { useMemo } from 'react';
import type { Scene, StageMode } from '@/lib/types/stage';
import { SlideEditor as SlideRenderer } from '../slide-renderer/Editor';
import { QuizView } from '../scene-renderers/quiz-view';
import { InteractiveRenderer } from '../scene-renderers/interactive-renderer';
import { PBLRenderer } from '../scene-renderers/pbl-renderer';
import { useStageStore } from '@/lib/store/stage';

interface SceneRendererProps {
  readonly scene: Scene;
  readonly mode: StageMode;
}

/**
 * Playback scene dispatcher. In Pro (edit) mode, Stage renders EditShell
 * directly as a top-level takeover — SceneRenderer is only on the playback
 * path, so it does not branch on `mode === 'edit'`.
 */
export function SceneRenderer({ scene, mode }: SceneRendererProps) {
  const outlines = useStageStore((state) => state.outlines);
  const renderer = useMemo(() => {
    switch (scene.type) {
      case 'slide':
        if (scene.content.type !== 'slide') return <div>Invalid slide content</div>;
        return <SlideRenderer mode={mode} />;
      case 'quiz':
        if (scene.content.type !== 'quiz') return <div>Invalid quiz content</div>;
        // An outline's mutable order is not an identity link after editing/reordering.
        const matching = scene.outlineId
          ? outlines.filter((outline) => outline.id === scene.outlineId)
          : [];
        const planning =
          matching.length === 1
            ? { outlineId: scene.outlineId, outline: matching[0], provenance: 'captured-planning' }
            : undefined;
        return <QuizView key={scene.id} scene={scene} planning={planning} />;
      case 'interactive':
        if (scene.content.type !== 'interactive') return <div>Invalid interactive content</div>;
        return <InteractiveRenderer content={scene.content} sceneId={scene.id} />;
      case 'pbl':
        if (scene.content.type !== 'pbl') return <div>Invalid PBL content</div>;
        return <PBLRenderer content={scene.content} mode={mode} sceneId={scene.id} />;
      default:
        return <div>Unknown scene type</div>;
    }
  }, [scene, mode, outlines]);

  return <div className="w-full h-full">{renderer}</div>;
}
