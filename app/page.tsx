'use client';

import { useState, useEffect, useMemo, useRef, useDeferredValue, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ImagePlus,
  Pencil,
  Trash2,
  Search,
  Settings,
  Sun,
  Moon,
  Monitor,
  ChevronUp,
  Upload,
  Sparkles,
  Atom,
  X,
  Presentation,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupInput, InputGroupButton } from '@/components/ui/input-group';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { useTheme } from '@/lib/hooks/use-theme';
import { nanoid } from 'nanoid';
import { deleteDocumentBlob, storeDocumentBlob } from '@/lib/utils/image-storage';
import { normalizeDocumentMimeType } from '@/lib/document/mime';
import { dedupeCourseMaterialFiles } from '@/lib/document/course-materials';
import type {
  SelectedCourseMaterial,
  SessionDocumentSource,
  UserRequirements,
} from '@/lib/types/generation';
import { useSettingsStore } from '@/lib/store/settings';
import { hasUsableLLMProvider } from '@/lib/store/settings-validation';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  StageListItem,
  listStages,
  deleteStageData,
  renameStage,
  loadStageData,
  getFirstSlideByStages,
  revokeThumbnailSlideMediaUrls,
} from '@/lib/utils/stage-storage';
import { SlideThumbnail } from '@/components/slide-renderer/SlideThumbnail';
import type { Slide } from '@openmaic/dsl';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { useImportClassroom } from '@/lib/import/use-import-classroom';
import { shouldShowVocationalTestUi } from '@/lib/config/feature-flags';
import { useImportPptx } from '@/lib/import/use-import-pptx';
import { InteractiveModeButton } from '@/components/generation/interactive-mode-button';
import { isSupportedFusionDemoTopic } from '@/lib/fusion/topic';
import { db } from '@/lib/utils/database';

const log = createLogger('Home');

const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';
const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';
const INTERACTIVE_MODE_STORAGE_KEY = 'interactiveModeEnabled';
const LAN_SHARED_MODE = process.env.NEXT_PUBLIC_OPENMAIC_LAN_SHARED_MODE === 'true';

// PPTX import is still scaffolding: `useImportPptx` has no `onImported` consumer
// yet, so the flow only logs the parsed slides. Hide the entry point behind a
// flag until it's wired end-to-end, so the UI doesn't expose a no-op button.
// Enable with NEXT_PUBLIC_ENABLE_PPTX_IMPORT=true.
const PPTX_IMPORT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PPTX_IMPORT === 'true';

interface FormState {
  courseMaterials: SelectedCourseMaterial[];
  requirement: string;
  webSearch: boolean;
  interactiveMode: boolean;
  vocationalTestMode: boolean;
}

type FusionDemoStudent = 'a' | 'b';
type ListedClassroom = StageListItem & { shared?: boolean };

type FormalFusionConnection = {
  configured: boolean;
  reachable: boolean;
  developmentUiEnabled: boolean;
};

type FormalFusionLearner = 'a' | 'b' | 'unknown';

function formalFusionLearnerFromId(learnerId: string): FormalFusionLearner {
  if (learnerId === 'f24-synthetic-a') return 'a';
  if (learnerId === 'f24-synthetic-b') return 'b';
  return 'unknown';
}

function formalFusionLearnerTranslationKey(learner: FormalFusionLearner): string {
  if (learner === 'a') return 'home.formalFusion.learnerA';
  if (learner === 'b') return 'home.formalFusion.learnerB';
  return 'home.formalFusion.learnerUnknown';
}

interface SharedClassroomResponse extends StageListItem {
  firstSlide?: Slide;
}

const initialFormState: FormState = {
  courseMaterials: [],
  requirement: '',
  webSearch: false,
  interactiveMode: false,
  vocationalTestMode: false,
};

function HomePage() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const showVocationalTestUi = shouldShowVocationalTestUi();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  // Draft cache for requirement text
  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } =
    useDraftCache<string>({ key: 'requirementDraft' });

  // A usable LLM provider exists ⇒ a concrete model is always selected (#580
  // invariant). Gate generation on this single condition (state A vs B)
  // instead of inspecting modelId directly.
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const hasUsableProvider = hasUsableLLMProvider(providersConfig);
  const [recentOpen, setRecentOpen] = useState(true);
  const persistRecentOpen = (next: boolean) => {
    setRecentOpen(next);
    try {
      localStorage.setItem(RECENT_OPEN_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  // Hydrate client-only state after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setRecentOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
    try {
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
      const savedInteractiveMode = localStorage.getItem(INTERACTIVE_MODE_STORAGE_KEY);
      const updates: Partial<FormState> = {};
      if (savedWebSearch === 'true') updates.webSearch = true;
      if (savedInteractiveMode === 'true') updates.interactiveMode = true;
      if (Object.keys(updates).length > 0) {
        setForm((prev) => ({ ...prev, ...updates }));
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // Restore requirement draft from localStorage on mount. The previous derived-state
  // pattern initialised `prev` from the cached value itself, so on the first client
  // render the comparison was always equal and the restore never fired. Use an effect
  // so the cache is hydrated into the form once we know the live requirement is empty.
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (!cachedRequirement) return;
    draftRestoredRef.current = true;
    setForm((prev) => (prev.requirement ? prev : { ...prev, requirement: cachedRequirement }));
  }, [cachedRequirement]);

  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFusionDemo, setSelectedFusionDemo] = useState<FusionDemoStudent | null>(null);
  const [isPreparingFusionSession, setIsPreparingFusionSession] = useState(false);
  const [fusionError, setFusionError] = useState(false);
  const [formalFusionConnection, setFormalFusionConnection] =
    useState<FormalFusionConnection | null>(null);
  const [formalLessonSessionId, setFormalLessonSessionId] = useState<string | null>(null);
  const [formalFusionLearner, setFormalFusionLearner] = useState<FormalFusionLearner | null>(null);
  const [isTestingFormalFusion, setIsTestingFormalFusion] = useState(false);
  const [isConnectingFormalFusion, setIsConnectingFormalFusion] = useState(false);
  const [formalFusionError, setFormalFusionError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, Slide>>({});
  const [sharedClassrooms, setSharedClassrooms] = useState<SharedClassroomResponse[]>([]);
  const [sharedThumbnails, setSharedThumbnails] = useState<Record<string, Slide>>({});
  const [publishingShared, setPublishingShared] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thumbnailsRef = useRef<Record<string, Slide>>({});

  const replaceThumbnails = (slides: Record<string, Slide>) => {
    const previous = thumbnailsRef.current;
    thumbnailsRef.current = slides;
    setThumbnails(slides);
    window.setTimeout(() => revokeThumbnailSlideMediaUrls(previous), 0);
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!themeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen]);

  const loadClassrooms = useCallback(async () => {
    try {
      const list = await listStages();
      setClassrooms(list);
      // Load first slide thumbnails
      if (list.length > 0) {
        const slides = await getFirstSlideByStages(list.map((c) => c.id));
        replaceThumbnails(slides);
      } else {
        replaceThumbnails({});
      }
      if (LAN_SHARED_MODE) {
        const response = await fetch('/api/lan-shared/classrooms');
        if (!response.ok) throw new Error('Shared classrooms are unavailable.');
        const payload = (await response.json()) as { classrooms?: SharedClassroomResponse[] };
        const shared = payload.classrooms ?? [];
        setSharedClassrooms(shared);
        setSharedThumbnails(
          Object.fromEntries(
            shared.flatMap((classroom) =>
              classroom.firstSlide ? [[classroom.id, classroom.firstSlide] as const] : [],
            ),
          ),
        );
      }
    } catch (err) {
      log.error('Failed to load classrooms:', err);
      if (LAN_SHARED_MODE) toast.error(t('lanShared.loadFailed'));
    }
  }, [t]);

  const publishLocalClassrooms = async () => {
    setPublishingShared(true);
    try {
      const localClassrooms = await listStages();
      const results = await Promise.all(
        localClassrooms.map(async ({ id }) => {
          const data = await loadStageData(id);
          if (!data) throw new Error(`Classroom ${id} is unavailable.`);
          const response = await fetch('/api/lan-shared/classrooms', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stage: data.stage, scenes: data.scenes }),
          });
          if (!response.ok) throw new Error(`Classroom ${id} could not be published.`);

          const audioIds = new Set<string>();
          for (const scene of data.scenes) {
            for (const action of scene.actions ?? []) {
              if (action.type === 'speech' && action.audioId) audioIds.add(action.audioId);
            }
          }
          const ids = [...audioIds];
          const audioRecords = await db.audioFiles.bulkGet(ids);
          await Promise.all(
            audioRecords.flatMap((record, index) => {
              if (!record) return [];
              const audioId = ids[index];
              return [
                fetch(
                  `/api/lan-shared/classrooms/${encodeURIComponent(id)}/audio/${encodeURIComponent(audioId)}`,
                  {
                    method: 'POST',
                    headers: { 'content-type': record.blob.type || 'audio/mpeg' },
                    body: record.blob,
                  },
                ).then((audioResponse) => {
                  if (!audioResponse.ok) {
                    throw new Error(`Audio ${audioId} for classroom ${id} could not be published.`);
                  }
                }),
              ];
            }),
          );
        }),
      );
      void results;
      await loadClassrooms();
      toast.success(t('lanShared.publishSuccess', { count: localClassrooms.length }));
    } catch (err) {
      log.error('Failed to publish shared classrooms:', err);
      toast.error(t('lanShared.publishFailed'));
    } finally {
      setPublishingShared(false);
    }
  };

  const { importing, fileInputRef, triggerFileSelect, handleFileChange } = useImportClassroom(
    () => {
      loadClassrooms();
    },
  );

  const {
    importing: pptxImporting,
    fileInputRef: pptxFileInputRef,
    triggerFileSelect: triggerPptxFileSelect,
    handleFileChange: handlePptxFileChange,
  } = useImportPptx();

  useEffect(() => {
    // Clear stale media store to prevent cross-course thumbnail contamination.
    // The store may hold tasks from a previously visited classroom whose elementIds
    // (gen_img_1, etc.) collide with other courses' placeholders.
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    loadClassrooms();

    return () => {
      revokeThumbnailSlideMediaUrls(thumbnailsRef.current);
      thumbnailsRef.current = {};
    };
  }, [loadClassrooms]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmDelete = async (id: string) => {
    setPendingDeleteId(null);
    try {
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await renameStage(id, newName);
      setClassrooms((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    } catch (err) {
      log.error('Failed to rename classroom:', err);
      toast.error(t('classroom.renameFailed'));
    }
  };

  const listedClassrooms = useMemo(() => {
    if (!LAN_SHARED_MODE) return classrooms as ListedClassroom[];
    const byId = new Map<string, ListedClassroom>();
    for (const classroom of sharedClassrooms)
      byId.set(classroom.id, { ...classroom, shared: true });
    for (const classroom of classrooms) byId.set(classroom.id, classroom);
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [classrooms, sharedClassrooms]);
  const listedThumbnails = useMemo(
    () => ({ ...sharedThumbnails, ...thumbnails }),
    [sharedThumbnails, thumbnails],
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const filteredClassrooms = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    if (!q) return listedClassrooms;
    return listedClassrooms.filter((c) => {
      const name = c.name?.toLowerCase() ?? '';
      const desc = c.description?.toLowerCase() ?? '';
      return name.includes(q) || desc.includes(q);
    });
  }, [listedClassrooms, deferredSearchQuery]);

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'requirement' && !isSupportedFusionDemoTopic(value as string)) {
      setSelectedFusionDemo(null);
      setFusionError(false);
    }
    if (field === 'requirement') {
      // A formal session freezes a profile/map snapshot for one course request.
      // Editing that request requires an explicit fresh local launch.
      setFormalLessonSessionId(null);
      setFormalFusionLearner(null);
      setFormalFusionError(null);
    }
    try {
      if (field === 'webSearch') localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      if (field === 'interactiveMode')
        localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, String(value));
      if (field === 'requirement') updateRequirementCache(value as string);
    } catch {
      /* ignore */
    }
  };

  const handleTestFormalFusionConnection = async () => {
    setIsTestingFormalFusion(true);
    setFormalFusionError(null);
    try {
      const response = await fetch('/api/fusion/connection', { cache: 'no-store' });
      const data: unknown = await response.json().catch(() => null);
      const connection =
        typeof data === 'object' && data !== null && 'configured' in data
          ? (data as Partial<FormalFusionConnection>)
          : null;
      if (
        !response.ok ||
        !connection ||
        typeof connection.configured !== 'boolean' ||
        typeof connection.reachable !== 'boolean' ||
        typeof connection.developmentUiEnabled !== 'boolean'
      ) {
        throw new Error('Fusion connection check failed');
      }
      setFormalFusionConnection(connection as FormalFusionConnection);
      if (!connection.configured) setFormalFusionError(t('home.formalFusion.configRequired'));
      else if (!connection.reachable) setFormalFusionError(t('home.formalFusion.unavailable'));
      else if (!connection.developmentUiEnabled)
        setFormalFusionError(t('home.formalFusion.developmentRequired'));
    } catch (err) {
      log.warn('Unable to test the formal Fusion connection:', err);
      setFormalFusionConnection(null);
      setFormalFusionError(t('home.formalFusion.unavailable'));
    } finally {
      setIsTestingFormalFusion(false);
    }
  };

  const handleConnectFormalFusion = async () => {
    setIsConnectingFormalFusion(true);
    setFormalFusionError(null);
    try {
      const issueResponse = await fetch('/api/fusion/dev-launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const issueData: unknown = await issueResponse.json().catch(() => null);
      const classroomLaunchCode =
        typeof issueData === 'object' && issueData !== null && 'classroomLaunchCode' in issueData
          ? (issueData as { classroomLaunchCode?: unknown }).classroomLaunchCode
          : undefined;
      if (!issueResponse.ok || typeof classroomLaunchCode !== 'string') {
        throw new Error('Development launch code was not issued');
      }

      const launchResponse = await fetch('/api/fusion/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomLaunchCode }),
      });
      const launchData: unknown = await launchResponse.json().catch(() => null);
      const lessonSessionId =
        typeof launchData === 'object' && launchData !== null && 'lessonSessionId' in launchData
          ? (launchData as { lessonSessionId?: unknown }).lessonSessionId
          : undefined;
      const learnerId =
        typeof launchData === 'object' && launchData !== null && 'learnerId' in launchData
          ? (launchData as { learnerId?: unknown }).learnerId
          : undefined;
      if (
        !launchResponse.ok ||
        typeof lessonSessionId !== 'string' ||
        typeof learnerId !== 'string'
      ) {
        throw new Error('Formal Fusion session was not created');
      }

      setFormalLessonSessionId(lessonSessionId);
      setFormalFusionLearner(formalFusionLearnerFromId(learnerId));
      setSelectedFusionDemo(null);
      setFusionError(false);
      setError(null);
    } catch (err) {
      log.warn('Unable to create the formal Fusion session:', err);
      setFormalFusionError(t('home.formalFusion.unavailable'));
    } finally {
      setIsConnectingFormalFusion(false);
    }
  };

  const addCourseMaterials = (files: File[]) => {
    setForm((prev) => {
      const dedupedFiles = dedupeCourseMaterialFiles(prev.courseMaterials, files);
      const startOrder = prev.courseMaterials.length + 1;
      const additions = dedupedFiles.map((file, index) => ({
        id: nanoid(8),
        file,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
        order: startOrder + index,
      }));

      return additions.length > 0
        ? { ...prev, courseMaterials: [...prev.courseMaterials, ...additions] }
        : prev;
    });
  };

  const removeCourseMaterial = (id: string) => {
    setForm((prev) => ({
      ...prev,
      courseMaterials: prev.courseMaterials
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, order: index + 1 })),
    }));
  };

  const handleGenerate = async () => {
    // No model/provider guard here: generation is gated by `canGenerate`
    // (requires a usable provider), and under the #580 invariant a usable
    // provider always has a concrete model. State A (no usable provider)
    // surfaces through the toolbar's single Configure-Provider affordance.
    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    setError(null);

    try {
      let fusionSessionId: string | undefined;
      const lessonSessionId = formalLessonSessionId ?? undefined;
      if (selectedFusionDemo) {
        setIsPreparingFusionSession(true);
        try {
          const response = await fetch('/api/fusion/demo-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              demoStudent: selectedFusionDemo,
              requirement: form.requirement,
            }),
          });
          const data: unknown = await response.json().catch(() => null);
          const fusionSessionIdFromResponse =
            typeof data === 'object' && data !== null && 'fusionSessionId' in data
              ? (data as { fusionSessionId?: unknown }).fusionSessionId
              : undefined;
          if (!response.ok || typeof fusionSessionIdFromResponse !== 'string') {
            throw new Error('Fusion demo session was not created');
          }
          fusionSessionId = fusionSessionIdFromResponse;
          setFusionError(false);
        } catch (err) {
          log.warn('Unable to create the selected Fusion demo session:', err);
          setFusionError(true);
          setError(t('home.fusion.unavailable'));
          return;
        } finally {
          setIsPreparingFusionSession(false);
        }
      }

      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: form.requirement,
        // 演示会话只允许向模型传递经审阅的教学策略和课程请求；不能把本地
        // 昵称或简介与合成演示画像混在一起。普通生成维持原有行为。
        ...(selectedFusionDemo || lessonSessionId
          ? {}
          : {
              userNickname: userProfile.nickname || undefined,
              userBio: userProfile.bio || undefined,
            }),
        webSearch: form.webSearch || undefined,
        interactiveMode: form.vocationalTestMode ? true : form.interactiveMode,
        ...(form.vocationalTestMode ? { taskEngineMode: true } : {}),
      };

      let documentSources: SessionDocumentSource[] | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig:
        | { apiKey?: string; baseUrl?: string; accessKeyId?: string; accessKeySecret?: string }
        | undefined;

      if (form.courseMaterials.length > 0) {
        const settings = useSettingsStore.getState();
        pdfProviderId = settings.pdfProviderId;
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        if (providerCfg) {
          pdfProviderConfig = {
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.baseUrl,
            accessKeyId: providerCfg.accessKeyId,
            accessKeySecret: providerCfg.accessKeySecret,
          };
        }

        const storedDocumentKeys: string[] = [];
        try {
          documentSources = [];
          const orderedMaterials = [...form.courseMaterials].sort((a, b) => a.order - b.order);
          for (const [index, item] of orderedMaterials.entries()) {
            const storageKey = await storeDocumentBlob(item.file);
            storedDocumentKeys.push(storageKey);
            documentSources.push({
              id: item.id,
              name: item.name,
              size: item.size,
              lastModified: item.lastModified,
              mimeType: normalizeDocumentMimeType({
                mimeType: item.file.type,
                fileName: item.file.name,
              }),
              order: index + 1,
              storageKey,
              providerId: pdfProviderId,
            });
          }
        } catch (error) {
          await Promise.allSettled(storedDocumentKeys.map((key) => deleteDocumentBlob(key)));
          throw error;
        }
      }

      const sessionState = {
        sessionId: nanoid(),
        fusionSessionId,
        lessonSessionId,
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        documentSources,
        // Backward-compatible single-document fields for previously saved sessions.
        pdfStorageKey: documentSources?.[0]?.storageKey,
        pdfFileName: documentSources?.[0]?.name,
        documentMimeType: documentSources?.[0]?.mimeType,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating' as const,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('classroom.today');
    if (diffDays === 1) return t('classroom.yesterday');
    if (diffDays < 7) return `${diffDays} ${t('classroom.daysAgo')}`;
    return date.toLocaleDateString();
  };

  const isFusionDemoSupported = isSupportedFusionDemoTopic(form.requirement);
  const canGenerate =
    !!form.requirement.trim() &&
    hasUsableProvider &&
    !isPreparingFusionSession &&
    !isConnectingFormalFusion;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate) handleGenerate();
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16 overflow-x-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        onChange={handleFileChange}
        className="hidden"
      />
      {PPTX_IMPORT_ENABLED && (
        <input
          ref={pptxFileInputRef}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={handlePptxFileChange}
          className="hidden"
        />
      )}
      {/* ═══ Top-right pill (unchanged) ═══ */}
      <div
        ref={toolbarRef}
        className="fixed top-4 right-4 z-50 flex items-center gap-1 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-2 py-1.5 rounded-full border border-gray-100/50 dark:border-gray-700/50 shadow-sm"
      >
        {/* Language Selector */}
        <LanguageSwitcher onOpen={() => setThemeOpen(false)} />

        <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />

        {/* Theme Selector */}
        <div className="relative">
          <button
            onClick={() => {
              setThemeOpen(!themeOpen);
            }}
            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all"
          >
            {theme === 'light' && <Sun className="w-4 h-4" />}
            {theme === 'dark' && <Moon className="w-4 h-4" />}
            {theme === 'system' && <Monitor className="w-4 h-4" />}
          </button>
          {themeOpen && (
            <div className="absolute top-full mt-2 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
              <button
                onClick={() => {
                  setTheme('light');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'light' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Sun className="w-4 h-4" />
                {t('settings.themeOptions.light')}
              </button>
              <button
                onClick={() => {
                  setTheme('dark');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'dark' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Moon className="w-4 h-4" />
                {t('settings.themeOptions.dark')}
              </button>
              <button
                onClick={() => {
                  setTheme('system');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'system' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Monitor className="w-4 h-4" />
                {t('settings.themeOptions.system')}
              </button>
            </div>
          )}
        </div>

        <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />

        {/* Settings Button */}
        <div className="relative">
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"
          >
            <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
          </button>
        </div>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      {/* ═══ Background Decor ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '6s' }}
        />
      </div>

      {/* ═══ Hero section: title + input (centered, wider) ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={cn(
          'relative z-20 w-full max-w-[800px] flex flex-col items-center',
          classrooms.length === 0 ? 'justify-center min-h-[calc(100dvh-8rem)]' : 'mt-[10vh]',
        )}
      >
        {/* ── Logo ── */}
        <motion.img
          src="/logo-horizontal.png"
          alt="OpenMAIC"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: 0.1,
            type: 'spring',
            stiffness: 200,
            damping: 20,
          }}
          className="h-12 md:h-16 mb-2 -ml-2 md:-ml-3"
        />

        {/* ── Slogan ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="text-sm text-muted-foreground/60 mb-8"
        >
          {t('home.slogan')}
        </motion.p>

        {/* ── Unified input area ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35 }}
          className="w-full"
        >
          <div className="w-full rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-black/[0.03] dark:shadow-black/20 transition-shadow focus-within:shadow-2xl focus-within:shadow-violet-500/[0.06]">
            {/* ── Greeting + Profile + Agents ── */}
            <div className="relative z-20 flex items-start justify-between">
              <GreetingBar />
              <div className="pr-3 pt-3.5 shrink-0">
                <AgentBar />
              </div>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              placeholder={t('upload.requirementPlaceholder')}
              className="w-full resize-none border-0 bg-transparent px-4 pt-1 pb-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none min-h-[140px] max-h-[300px]"
              value={form.requirement}
              onChange={(e) => updateForm('requirement', e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
            />

            {/* F24: a server-configured, development-only formal Fusion entry. */}
            <div
              className="mx-3 mb-2 rounded-xl border border-cyan-200/70 bg-cyan-50/60 p-3 dark:border-cyan-900/70 dark:bg-cyan-950/20"
              role="group"
              aria-label={t('home.formalFusion.title')}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:bg-cyan-900/60 dark:text-cyan-200">
                      {t('home.formalFusion.badge')}
                    </span>
                    <p className="text-xs font-medium text-cyan-950 dark:text-cyan-100">
                      {t('home.formalFusion.title')}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {t('home.formalFusion.description')}
                  </p>
                </div>
                {formalLessonSessionId && (
                  <span className="shrink-0 rounded-full border border-cyan-300/80 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:border-cyan-700 dark:bg-cyan-950/70 dark:text-cyan-200">
                    {t('home.formalFusion.connected')}
                  </span>
                )}
              </div>

              {formalLessonSessionId && formalFusionLearner && (
                <p
                  className="mt-1 text-[11px] font-medium text-cyan-800 dark:text-cyan-100"
                  role="status"
                >
                  {t('home.formalFusion.connectedLearner', {
                    learner: t(formalFusionLearnerTranslationKey(formalFusionLearner)),
                  })}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleTestFormalFusionConnection()}
                  disabled={isTestingFormalFusion || isConnectingFormalFusion}
                  className="rounded-md border border-cyan-300/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-cyan-800 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-800 dark:bg-cyan-950/70 dark:text-cyan-100"
                >
                  {isTestingFormalFusion
                    ? t('home.formalFusion.testing')
                    : t('home.formalFusion.testConnection')}
                </button>
                {formalFusionConnection?.reachable &&
                  formalFusionConnection.developmentUiEnabled && (
                    <button
                      type="button"
                      onClick={() => void handleConnectFormalFusion()}
                      disabled={isConnectingFormalFusion || isTestingFormalFusion}
                      className="rounded-md bg-cyan-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isConnectingFormalFusion
                        ? t('home.formalFusion.connecting')
                        : t('home.formalFusion.connectCurrentLearner')}
                    </button>
                  )}
                {formalLessonSessionId && (
                  <p className="text-[11px] text-muted-foreground" role="status">
                    {t('home.formalFusion.reconnectHint')}
                  </p>
                )}
              </div>

              {formalFusionError && (
                <p className="mt-2 text-[11px] text-destructive" role="alert">
                  {formalFusionError}
                </p>
              )}
            </div>

            {/* F02：只在支持的课题中启用经审阅的离线演示画像。 */}
            <div
              className="mx-3 mb-2 rounded-xl border border-violet-200/70 bg-violet-50/60 p-3 dark:border-violet-900/70 dark:bg-violet-950/20"
              role="group"
              aria-label={t('home.fusion.title')}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/60 dark:text-violet-200">
                      {t('home.fusion.badge')}
                    </span>
                    <p className="text-xs font-medium text-violet-950 dark:text-violet-100">
                      {t('home.fusion.title')}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {t('home.fusion.description')}
                  </p>
                </div>
                {selectedFusionDemo && isFusionDemoSupported && (
                  <span className="shrink-0 rounded-full border border-violet-300/80 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:border-violet-700 dark:bg-violet-950/70 dark:text-violet-200">
                    {isPreparingFusionSession
                      ? t('home.fusion.preparing')
                      : t('home.fusion.selected')}
                  </span>
                )}
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(['a', 'b'] as const).map((demoStudent) => {
                  const selected = selectedFusionDemo === demoStudent;
                  const titleKey =
                    demoStudent === 'a' ? 'home.fusion.studentA' : 'home.fusion.studentB';
                  const descriptionKey =
                    demoStudent === 'a' ? 'home.fusion.studentADesc' : 'home.fusion.studentBDesc';
                  return (
                    <button
                      key={demoStudent}
                      type="button"
                      aria-pressed={selected}
                      disabled={!isFusionDemoSupported || isPreparingFusionSession}
                      onClick={() => {
                        setSelectedFusionDemo(demoStudent);
                        setFormalLessonSessionId(null);
                        setFormalFusionLearner(null);
                        setFormalFusionError(null);
                        setFusionError(false);
                        setError(null);
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 dark:focus-visible:ring-offset-slate-900',
                        selected
                          ? 'border-violet-400 bg-white text-violet-950 shadow-sm dark:border-violet-500 dark:bg-violet-950/70 dark:text-violet-100'
                          : 'border-violet-200/80 bg-white/60 text-foreground hover:border-violet-300 hover:bg-white dark:border-violet-900/80 dark:bg-slate-950/20 dark:hover:border-violet-700',
                      )}
                    >
                      <span className="block text-xs font-medium">{t(titleKey)}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                        {t(descriptionKey)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!isFusionDemoSupported && (
                <p className="mt-2 text-[11px] text-muted-foreground" role="status">
                  {t('home.fusion.topicHint')}
                </p>
              )}

              {fusionError && (
                <div
                  className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2"
                  role="alert"
                >
                  <p className="text-[11px] text-destructive">{t('home.fusion.unavailable')}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={isPreparingFusionSession}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('home.fusion.retry')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFusionDemo(null);
                        setFusionError(false);
                        setError(null);
                      }}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    >
                      {t('home.fusion.normalGeneration')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Toolbar row */}
            <div className="px-3 pb-3 flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <GenerationToolbar
                  webSearch={form.webSearch}
                  onWebSearchChange={(v) => updateForm('webSearch', v)}
                  onSettingsOpen={(section) => {
                    setSettingsSection(section);
                    setSettingsOpen(true);
                  }}
                  courseMaterials={form.courseMaterials}
                  onCourseMaterialsAdd={addCourseMaterials}
                  onCourseMaterialRemove={removeCourseMaterial}
                  onPdfError={setError}
                />
              </div>

              {/* Interactive mode toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <InteractiveModeButton
                    pressed={form.interactiveMode}
                    label={t('toolbar.interactiveModeLabel')}
                    onPressedChange={(pressed) => updateForm('interactiveMode', pressed)}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t('toolbar.interactiveModeHint')}
                </TooltipContent>
              </Tooltip>

              {/* Voice input */}
              <SpeechButton
                size="md"
                onTranscription={(text) => {
                  setForm((prev) => {
                    const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                    updateRequirementCache(next);
                    return { ...prev, requirement: next };
                  });
                }}
              />

              {/* Send button */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={cn(
                  'shrink-0 h-8 rounded-lg flex items-center justify-center gap-1.5 transition-all px-3',
                  canGenerate
                    ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <span className="text-xs font-medium">{t('toolbar.enterClassroom')}</span>
                <ArrowUp className="size-3.5" />
              </button>
            </div>
          </div>
        </motion.div>

        {showVocationalTestUi && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-2 flex w-full justify-start px-1"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.vocationalTestMode}
                  onClick={() => updateForm('vocationalTestMode', !form.vocationalTestMode)}
                  className={cn(
                    'inline-flex h-7 items-center gap-2 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
                    form.vocationalTestMode
                      ? 'border-cyan-400/70 bg-cyan-50 text-cyan-700 shadow-[0_0_10px_rgba(6,182,212,0.16)] dark:bg-cyan-950/40 dark:text-cyan-300'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/60 hover:text-cyan-700 dark:hover:text-cyan-300',
                  )}
                >
                  <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-cyan-700 dark:bg-cyan-900/45 dark:text-cyan-300">
                    测试功能
                  </span>
                  <Sparkles className="size-3.5" />
                  <span>职教任务</span>
                  <span
                    className={cn(
                      'relative h-3.5 w-6 rounded-full transition-colors',
                      form.vocationalTestMode ? 'bg-cyan-500' : 'bg-muted-foreground/25',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-2.5 rounded-full bg-white transition-transform',
                        form.vocationalTestMode ? 'translate-x-3' : 'translate-x-0.5',
                      )}
                    />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                从当前输入框提交职教实操训练测试
              </TooltipContent>
            </Tooltip>
          </motion.div>
        )}

        {/* ── Error ── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
            >
              <p className="text-sm text-destructive">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Import buttons (empty state) ── */}
        {listedClassrooms.length === 0 && (
          <div className="relative z-10 mt-4 flex items-center gap-4">
            <button
              onClick={triggerFileSelect}
              disabled={importing}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground/40 hover:text-foreground/60 transition-colors"
            >
              <Upload className="size-3.5" />
              <span>{t('import.classroom')}</span>
            </button>
            {PPTX_IMPORT_ENABLED && (
              <button
                onClick={triggerPptxFileSelect}
                disabled={pptxImporting}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground/40 hover:text-foreground/60 transition-colors"
              >
                <Presentation className="size-3.5" />
                <span>{t('import.pptx')}</span>
              </button>
            )}
          </div>
        )}
      </motion.div>

      {/* ═══ Recent classrooms — collapsible ═══ */}
      {listedClassrooms.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="relative z-10 mt-10 w-full max-w-6xl flex flex-col items-center"
        >
          {/* Trigger — divider-line with centered text */}
          <div className="group w-full flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
            <div className="shrink-0 flex items-center gap-3 text-[13px] text-muted-foreground/60 select-none">
              <button
                onClick={() => persistRecentOpen(!recentOpen)}
                className="flex items-center gap-2 hover:text-foreground/70 transition-colors cursor-pointer"
              >
                <Clock className="size-3.5" />
                {t('classroom.recentClassrooms')}
                <span className="text-[11px] tabular-nums opacity-60">
                  {listedClassrooms.length}
                </span>
                <motion.div
                  animate={{ rotate: recentOpen ? 180 : 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
                  <ChevronDown className="size-3.5" />
                </motion.div>
              </button>

              {LAN_SHARED_MODE && (
                <button
                  type="button"
                  onClick={publishLocalClassrooms}
                  disabled={publishingShared}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors"
                >
                  <Upload className="size-3" />
                  {publishingShared ? t('lanShared.publishing') : t('lanShared.publish')}
                </button>
              )}

              {/* Search toggle — icon that expands into an input in place */}
              <AnimatePresence initial={false}>
                {!searchOpen ? (
                  <motion.button
                    key="search-icon"
                    ref={searchButtonRef}
                    type="button"
                    aria-label={t('classroom.searchAriaLabel')}
                    onClick={() => {
                      setSearchOpen(true);
                      if (!recentOpen) persistRecentOpen(true);
                      requestAnimationFrame(() => searchInputRef.current?.focus());
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12, ease: 'easeOut' }}
                    className="flex items-center justify-center size-6 rounded-full text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <Search className="size-3.5" />
                  </motion.button>
                ) : (
                  <motion.div
                    key="search-input"
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 200 }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
                    className="overflow-hidden"
                  >
                    <InputGroup
                      className={cn(
                        'h-7 text-[12px] rounded-full bg-muted/40 border-transparent shadow-none',
                        'transition-colors',
                        'hover:bg-muted/60',
                        'has-[[data-slot=input-group-control]:focus-visible]:bg-muted/60',
                        'has-[[data-slot=input-group-control]:focus-visible]:border-transparent',
                        'has-[[data-slot=input-group-control]:focus-visible]:ring-0',
                      )}
                    >
                      <InputGroupInput
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            if (searchQuery) {
                              setSearchQuery('');
                            } else {
                              setSearchOpen(false);
                              requestAnimationFrame(() => searchButtonRef.current?.focus());
                            }
                          }
                        }}
                        onBlur={() => {
                          if (!searchQuery) {
                            setSearchOpen(false);
                          }
                        }}
                        placeholder={t('classroom.searchPlaceholder')}
                        aria-label={t('classroom.searchAriaLabel')}
                        className="h-7 pl-3 placeholder:text-muted-foreground/50"
                      />
                      {searchQuery && (
                        <InputGroupButton
                          size="icon-xs"
                          aria-label={t('classroom.clearSearch')}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSearchQuery('');
                            searchInputRef.current?.focus();
                          }}
                        >
                          <X />
                        </InputGroupButton>
                      )}
                    </InputGroup>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                onClick={triggerFileSelect}
                disabled={importing}
                className="group/import grid grid-cols-[auto_0fr] hover:grid-cols-[auto_1fr] items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] text-muted-foreground/35 hover:text-muted-foreground/70 hover:bg-muted/50 transition-all duration-200 cursor-pointer"
              >
                <Upload className="size-3" />
                <span className="overflow-hidden opacity-0 group-hover/import:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                  {t('import.classroom')}
                </span>
              </button>
              {PPTX_IMPORT_ENABLED && (
                <button
                  onClick={triggerPptxFileSelect}
                  disabled={pptxImporting}
                  className="group/import-pptx grid grid-cols-[auto_0fr] hover:grid-cols-[auto_1fr] items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] text-muted-foreground/35 hover:text-muted-foreground/70 hover:bg-muted/50 transition-all duration-200 cursor-pointer"
                >
                  <Presentation className="size-3" />
                  <span className="overflow-hidden opacity-0 group-hover/import-pptx:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                    {t('import.pptx')}
                  </span>
                </button>
              )}
            </div>
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
          </div>

          {/* Expandable content */}
          <AnimatePresence>
            {recentOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-full overflow-hidden"
              >
                {searchQuery.trim() && filteredClassrooms.length === 0 ? (
                  <div className="pt-8 pb-2 text-center text-[13px] text-muted-foreground/60">
                    {t('classroom.searchEmpty')}
                  </div>
                ) : (
                  <div className="pt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
                    {filteredClassrooms.map((classroom, i) => (
                      <motion.div
                        key={classroom.id}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          delay: i * 0.04,
                          duration: 0.35,
                          ease: 'easeOut',
                        }}
                      >
                        <ClassroomCard
                          classroom={classroom}
                          slide={listedThumbnails[classroom.id]}
                          formatDate={formatDate}
                          onDelete={handleDelete}
                          onRename={handleRename}
                          confirmingDelete={pendingDeleteId === classroom.id}
                          onConfirmDelete={() => confirmDelete(classroom.id)}
                          onCancelDelete={() => setPendingDeleteId(null)}
                          onClick={() => router.push(`/classroom/${classroom.id}`)}
                          readOnly={classroom.shared === true}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Footer — flows with content, at the very end */}
      <div className="mt-auto pt-12 pb-4 text-center text-xs text-muted-foreground/40">
        OpenMAIC Open Source Project
      </div>
    </div>
  );
}

// ─── Greeting Bar — avatar + "Hi, Name", click to edit in-place ────
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

function GreetingBar() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = nickname || t('profile.defaultNickname');

  // Click-outside to collapse
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingName(false);
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div ref={containerRef} className="relative pl-4 pr-2 pt-3.5 pb-1 w-auto">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />

      {/* ── Collapsed pill (always in flow) ── */}
      {!open && (
        <div
          className="flex items-center gap-2.5 cursor-pointer transition-all duration-200 group rounded-full px-2.5 py-1.5 border border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 active:scale-[0.97]"
          onClick={() => setOpen(true)}
        >
          <div className="shrink-0 relative">
            <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-border/30 group-hover:ring-violet-400/60 dark:group-hover:ring-violet-400/40 transition-all duration-300">
              <img src={avatar} alt="" className="size-full object-cover" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/40 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
              <Pencil className="size-[7px] text-muted-foreground/70" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="leading-none select-none flex items-center gap-1">
                  <span className="text-[13px] font-semibold text-foreground/85 group-hover:text-foreground transition-colors">
                    {t('home.greetingWithName', { name: displayName })}
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t('profile.editTooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* ── Expanded panel (absolute, floating) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-4 top-3.5 z-50 w-64"
          >
            <div className="rounded-2xl bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_1px_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_8px_-2px_rgba(0,0,0,0.3)] px-2.5 py-2">
              {/* ── Row: avatar + name ── */}
              <div
                className="flex items-center gap-2.5 cursor-pointer transition-all duration-200"
                onClick={() => {
                  setOpen(false);
                  setEditingName(false);
                  setAvatarPickerOpen(false);
                }}
              >
                {/* Avatar */}
                <div
                  className="shrink-0 relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarPickerOpen(!avatarPickerOpen);
                  }}
                >
                  <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-violet-300/70 dark:ring-violet-500/40 transition-all duration-300">
                    <img src={avatar} alt="" className="size-full object-cover" />
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/60 flex items-center justify-center"
                  >
                    <ChevronDown
                      className={cn(
                        'size-2 text-muted-foreground/70 transition-transform duration-200',
                        avatarPickerOpen && 'rotate-180',
                      )}
                    />
                  </motion.div>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName();
                          if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={commitName}
                        maxLength={20}
                        placeholder={t('profile.defaultNickname')}
                        className="flex-1 min-w-0 h-6 bg-transparent border-b border-border/80 text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
                      />
                      <button
                        onClick={commitName}
                        className="shrink-0 size-5 rounded flex items-center justify-center text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditName();
                      }}
                      className="group/name inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-[13px] font-semibold text-foreground/85 group-hover/name:text-foreground transition-colors">
                        {displayName}
                      </span>
                      <Pencil className="size-2.5 text-muted-foreground/30 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    </span>
                  )}
                </div>

                {/* Collapse arrow */}
                <motion.div
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 size-6 rounded-full flex items-center justify-center hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <ChevronUp className="size-3.5 text-muted-foreground/50" />
                </motion.div>
              </div>

              {/* ── Expandable content ── */}
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                {/* Avatar picker */}
                <AnimatePresence>
                  {avatarPickerOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-1 pb-2.5 flex items-center gap-1.5 flex-wrap">
                        {AVATAR_OPTIONS.map((url) => (
                          <button
                            key={url}
                            onClick={() => setAvatar(url)}
                            className={cn(
                              'size-7 rounded-full overflow-hidden bg-gray-50 dark:bg-gray-800 cursor-pointer transition-all duration-150',
                              'hover:scale-110 active:scale-95',
                              avatar === url
                                ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0'
                                : 'hover:ring-1 hover:ring-muted-foreground/30',
                            )}
                          >
                            <img src={url} alt="" className="size-full" />
                          </button>
                        ))}
                        <label
                          className={cn(
                            'size-7 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                            'hover:scale-110 active:scale-95',
                            isCustomAvatar(avatar)
                              ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0 border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30'
                              : 'border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/50',
                          )}
                          onClick={() => avatarInputRef.current?.click()}
                          title={t('profile.uploadAvatar')}
                        >
                          <ImagePlus className="size-3" />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bio */}
                <UITextarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                  className="resize-none border-border/40 bg-transparent min-h-[72px] !text-[13px] !leading-relaxed placeholder:!text-[11px] placeholder:!leading-relaxed focus-visible:ring-1 focus-visible:ring-border/60"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Classroom Card — clean, minimal style ──────────────────────
function ClassroomCard({
  classroom,
  slide,
  formatDate,
  onDelete,
  onRename,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onClick,
  readOnly = false,
}: {
  classroom: StageListItem;
  slide?: Slide;
  formatDate: (ts: number) => string;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClick: () => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const isTaskEngineMode = classroom.taskEngineMode === true;
  const showModeBadge = classroom.interactiveMode || isTaskEngineMode;
  const ModeBadgeIcon = isTaskEngineMode ? Sparkles : Atom;
  const modeBadgeLabel = isTaskEngineMode ? 'Vocational Mode' : t('toolbar.interactiveModeLabel');

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(classroom.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing || readOnly) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== classroom.name) {
      onRename(classroom.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div className="group cursor-pointer" onClick={confirmingDelete ? undefined : onClick}>
      {/* Thumbnail — large radius, no border, subtle bg */}
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] rounded-2xl bg-slate-100 dark:bg-slate-800/80 overflow-hidden transition-transform duration-200 group-hover:scale-[1.02]"
      >
        {slide && thumbWidth > 0 ? (
          <SlideThumbnail
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
          />
        ) : !slide ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
              <span className="text-xl opacity-50">📄</span>
            </div>
          </div>
        ) : null}

        {showModeBadge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={modeBadgeLabel}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'absolute bottom-2 left-2 inline-flex items-center justify-center size-5 rounded-full bg-white/70 dark:bg-slate-900/60 backdrop-blur-sm shadow-sm z-10',
                  isTaskEngineMode
                    ? 'text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/35'
                    : 'text-cyan-600 dark:text-cyan-300 ring-1 ring-cyan-500/30',
                )}
              >
                <ModeBadgeIcon className="size-3" />
              </span>
            </TooltipTrigger>
            {/* Negative sideOffset compensates for the global Tooltip Arrow's
                rotate-45 bounding box, which Radix reserves as spacing. */}
            <TooltipContent
              side="top"
              align="start"
              sideOffset={-4}
              collisionPadding={0}
              className="text-xs"
            >
              {modeBadgeLabel}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Delete — top-right, only on hover */}
        <AnimatePresence>
          {!confirmingDelete && !readOnly && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-destructive/80 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(classroom.id, e);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-11 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-black/50 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={startRename}
              >
                <Pencil className="size-3.5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline delete confirmation overlay */}
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[6px]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[13px] font-medium text-white/90">
                {t('classroom.deleteConfirmTitle')}?
              </span>
              <div className="flex gap-2">
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-white/15 text-white/80 hover:bg-white/25 backdrop-blur-sm transition-colors"
                  onClick={onCancelDelete}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  onClick={onConfirmDelete}
                >
                  {t('classroom.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info — outside the thumbnail */}
      <div className="mt-2.5 px-1 flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
          {classroom.sceneCount} {t('classroom.slides')} · {formatDate(classroom.updatedAt)}
        </span>
        {editing ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              maxLength={100}
              placeholder={t('classroom.renamePlaceholder')}
              className="w-full bg-transparent border-b border-violet-400/60 text-[15px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="font-medium text-[15px] truncate text-foreground/90 min-w-0 cursor-text"
                onDoubleClick={readOnly ? undefined : startRename}
              >
                {classroom.name}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={4}
              className="!max-w-[min(90vw,32rem)] break-words whitespace-normal"
            >
              <div className="flex items-center gap-1.5">
                <span className="break-all">{classroom.name}</span>
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-foreground/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(classroom.name);
                    toast.success(t('classroom.nameCopied'));
                  }}
                >
                  <Copy className="size-3 opacity-60" />
                </button>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <HomePage />;
}
