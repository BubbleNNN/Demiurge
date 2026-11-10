import { useDesktopLife } from './features/desktop/useDesktopLife';
import { CommunityPanel } from './features/community/CommunityPanel';
import { desktopProfile, pickLine, touchMark } from './characterBehavior';
import type { UserContext } from './userContext';
import { isActivity, activityDuration, activities } from './animation/activities';
import { activityIcons } from './features/companion/activityIcons';
import { Moment, type MomentAct, type MomentResult } from './features/companion/Moments';
import {
  advanceLife,
  createLife,
  lifeSituation,
  recordMoment,
  restoreLife,
  settleInvite,
  type LifeState,
  type MomentId,
  offerText,
  isMoment,
  type Offer,
} from './life';
import {
  ANGRY,
  feel,
  moodFace,
  moodLine,
  moodConduct,
  moodMark,
  moodName,
  moodWords,
  restoreMood,
  settle as settleMood,
  type Mood,
  type MoodEvent,
} from './mood';
import { CharacterRail } from './features/shell/CharacterRail';
import { startupView, type AppView } from './features/navigation';
import { StudioFrame, SettingsFrame, isStudioTab } from './features/studio/StudioFrame';
import { CompanionScene } from './features/companion/CompanionScene';
import { ConversationPanel, type ConversationMode } from './features/conversation/ConversationPanel';
import { DesktopPage } from './features/desktop/DesktopPage';
import { PetProductionStudio } from './features/appearance/PetProductionStudio';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import petBands from '../shared/pet-window.json';
import { chatServiceReady, imageServiceReady, selectedSearchProvider, searchProviderNames } from './research';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  Flower2,
  Heart,
  ImagePlus,
  Layers3,
  LoaderCircle,
  MessageCircle,
  Palette,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Compass,
  History,
  Send,
  Upload,
  WandSparkles,
  X,
  BookOpen,
  Square,
  Eye,
  Box,
  SlidersHorizontal,
  RefreshCw,
  Orbit,
  Film,
  Pin,
  Search,
  EyeOff,
  FolderHeart,
  Moon,
  HandHeart,
  Sun,
} from 'lucide-react';
import { bridge, isDesktop } from './bridge';
import { initialState, migrateState } from './initial';
import {
  themes,
  themeVars,
  resolveTheme,
  skinImage,
  styleName,
  engineName,
  availableStyle,
  styles,
} from './theme';
import { AvatarStage } from './components/AvatarStage';
import { Modal } from './components/Modal';
import { SettingsPanel } from './components/SettingsPanel';
import { GenerationStudio } from './components/GenerationStudio';
import { ReferencePanel } from './components/ReferencePanel';
import { ModelStudio } from './components/ModelStudio';
import { ArtWorkflow } from './components/ArtWorkflow';
import { CharacterPacks } from './components/CharacterPacks';
import { CharacterSetup } from './components/CharacterSetup';
import { CharacterReadiness } from './components/CharacterReadiness';
import { usableCharacterSkin, selectedCharacterSkin, existingCharacter } from './characterReadiness';
import {
  freshAttention,
  mayInvite,
  mayRemark,
  noticeReturn,
  recordInvite,
  recordRemark,
  restoreAttention,
  type Attention,
} from './attention';
import { creationDraftKey, parseCreationDraft } from './creationDraft';
import {
  activateCharacterPack,
  installStarterPack,
  matchingCharacterPacks,
  type CharacterPack,
} from './characterPacks';
import { createLocalCharacter } from './characterCreation';
import { admitBehavior, freshBehavior, interactionPlan, proactiveInterval } from './companion';
import { SkinArtwork } from './components/SkinArtwork';
import { spriteAnimation, animationDescription, supportsAction, supportsEmotion } from './artwork';
import { clipDuration } from './animation/timeline';
import { hitCharacter, overHead } from './animation/framing';
import { PersonaEditor } from './components/PersonaEditor';
import { PersonaPreview } from './components/PersonaPreview';
import { userError } from './errors';
import { personaDraftError } from './personaValidation';
import { appendCompletedReply, type CompletedReply } from './conversation';
import type {
  AppState,
  Character,
  CommunityPlugin,
  CompanionEvent,
  ChatStatus,
  Emotion,
  KeyStatus,
  Memory,
  PetAction,
  ProgressEvent,
  Skin,
  VisualReference,
} from './types';
const id = (): string => crypto.randomUUID();
// The longest she stays sitting or lying down when nothing else gets her up.
const POSE_STAY = 5 * 60000;
const now = () => new Date().toISOString();
const errorText = userError;
const emotions: { id: Emotion; name: string; mark: string }[] = [
  { id: 'neutral', name: '平静', mark: '◡' },
  { id: 'happy', name: '开心', mark: '♡' },
  { id: 'thinking', name: '思考', mark: '…' },
  { id: 'sad', name: '低落', mark: '☂' },
  { id: 'sleepy', name: '困倦', mark: '☾' },
  { id: 'surprised', name: '惊讶', mark: '✧' },
];
const actionNames: Record<PetAction, string> = {
  walk_left: '向左跑',
  walk_right: '向右跑',
  walk_up: '向后跑',
  walk_down: '向前跑',
  drag: '被拎起',
  listen: '倾听',
  sit: '坐下',
  lie: '趴着',
  fly: '飞行',
  office: '办公',
  idle: '待机',
  bounce: '小跳',
  nod: '点头',
  shake: '摇头',
  sleep: '休息',
  wave: '招呼',
  read: '读书',
  gaming: '玩掌机',
  snack: '吃点心',
  music: '听音乐',
  diary: '写日记',
};
export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasPreviousState, setHasPreviousState] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [view, setView] = useState<AppView>(() => startupView(location.search));
  const [keys, setKeys] = useState<KeyStatus>({
    llmKey: false,
    searchKey: false,
    imageKey: false,
    ttsKey: false,
    secure: false,
  });
  const [toast, setToast] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [action, setAction] = useState<PetAction>('idle');
  const [actionKey, setActionKey] = useState(0);
  // Bumped with an action that should start at once, skipping its lead-in turn.
  const [snap, setSnap] = useState(0);
  const [tracking, setTracking] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [previewSpeech, setPreviewSpeech] = useState(false);
  const [showEarlierArt, setShowEarlierArt] = useState(false);
  const [zoom, setZoom] = useState(1);
  // The home stage keeps its own zoom, remembered across starts.
  const [stageZoom, setStageZoom] = useState<number | null>(null);
  const stageZoomSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [petChat, setPetChat] = useState(false);
  // The message box under the desktop pet: talk to her without opening any other window.
  const [petComposer, setPetComposer] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Points of the pet window's bands above and below her that are on screen (see pet-layout.cjs).
  const [petRoom, setPetRoom] = useState({ above: petBands.top, below: petBands.bottom });
  // The pointer is on her: a faint handle shows where the hidden toolbar is.
  const [figureHover, setFigureHover] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [bubbleHidden, setBubbleHidden] = useState(false);
  const [sceneSettingsOpen, setSceneSettingsOpen] = useState(false);
  const [touchFeedback, setTouchFeedback] = useState<{ kind: 'headpat' | 'poke'; key: number } | null>(null);
  // Daily life: needs, self-chosen activities, invitations and shared moments (see life.ts).
  const lifeRef = useRef<LifeState>(createLife());
  // How often she may reach out (see attention.ts), and how long the user has been idle.
  const attentionRef = useRef<Attention>(freshAttention());
  const userIdleRef = useRef(0);
  const openedAt = useRef(Date.now());
  // Bumped on every touchdown after a jump, fall or drop, to play the landing squash.
  const [landing, setLanding] = useState(0);
  const dropping = useRef(false);
  const resizePetRef = useRef<(value: number) => void>(() => {});
  // Carried by the user she swings like a pendulum from the grab point, and settles when let go.
  const bodyRef = useRef<HTMLDivElement>(null);
  const landRef = useRef<HTMLDivElement>(null);
  const swing = useRef({
    angle: 0,
    velocity: 0,
    vx: 0,
    lifted: false,
    at: 0,
    last: 0,
    raf: 0,
    origin: '50% 0%',
  });
  const [sizeNote, setSizeNote] = useState('');
  const scaleSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scaleNote = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const liveScale = useRef<number | null>(null);
  const petScaleRef = useRef(1);
  const [, setLifeVersion] = useState(0);
  const [invitation, setInvitation] = useState<Offer | null>(null);
  // She asked for a pat on the head and is waiting for it (until this time).
  const awaitingPat = useRef(0);
  // Patting her head with the pointer (see the pet window's pointer handler).
  const hoverPat = useRef<() => void>(() => {});
  // Since when she has been asleep (resting) or napping on the desktop, to know when waking her
  // up is waking her from real sleep.
  const asleepSince = useRef(0);
  const [moment, setMoment] = useState<MomentId | null>(null);
  // Games and shared moments act themselves out through her motions; one stable callback, so a
  // game's effects do not run again on every render.
  const momentActRef = useRef<MomentAct>(() => {});
  const actInMoment = useRef<MomentAct>((value, face) => momentActRef.current(value, face)).current;
  const activityEnd = useRef(0);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [chatBusy, setChatBusy] = useState(false);
  const [sharedChatStatus, setSharedChatStatus] = useState<ChatStatus>({ busy: false });
  const interactionBusy = chatBusy || sharedChatStatus.busy;
  const [chatError, setChatError] = useState('');
  const [chatStopping, setChatStopping] = useState(false);
  const chatCancelled = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [newTopicCharacters, setNewTopicCharacters] = useState<Record<string, boolean>>({});
  const [talking, setTalking] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioFrame = useRef(0);
  const audioRequest = useRef(0);
  const mouth = useRef(0);
  const [createOpen, setCreateOpen] = useState(false);
  const creationGuard = useRef(false);
  const [creationStage, setCreationStage] = useState('');
  const [creationDraftSaved, setCreationDraftSaved] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWork, setNewWork] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newMode, setNewMode] = useState<'draft' | 'links' | 'search' | 'manual'>('manual');
  const manualCreate = newMode === 'manual';
  const [newUrls, setNewUrls] = useState('');
  const [sourceUpdateOpen, setSourceUpdateOpen] = useState(false);
  const [updateMode, setUpdateMode] = useState<'links' | 'search' | 'saved'>('links');
  const [updateUrls, setUpdateUrls] = useState('');
  const [updateError, setUpdateError] = useState('');
  const updateResult = useRef<{ characterId: string; character: Character } | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [petProductionOpen, setPetProductionOpen] = useState(false);
  const [modelStudioOpen, setModelStudioOpen] = useState(false);
  const [artWorkflowOpen, setArtWorkflowOpen] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [setupCharacterId, setSetupCharacterId] = useState('');
  const behavior = useRef(freshBehavior());
  // Until when something the user asked for (a toolbar activity, a touch) keeps her where she is.
  const userHeld = useRef(0);
  const interactionCounts = useRef<Record<string, number>>({});
  const [interactionLine, setInteractionLine] = useState('');
  const [resting, setResting] = useState(false);
  const [collectOnCreate, setCollectOnCreate] = useState(true);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobError, setJobError] = useState('');
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const pending = useRef<{ character?: Character }>({});
  const [profile, setProfile] = useState<Character | null>(null);
  const [personaPreviewOpen, setPersonaPreviewOpen] = useState(false);
  const profileBase = useRef<AppState | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [editedModel, setEditedModel] = useState<Skin | null>(null);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const memoryBase = useRef<AppState | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const petMode = new URLSearchParams(location.search).get('pet') === '1';
  const drag = useRef<{ x: number; y: number; moved: boolean; hit: 'headpat' | 'poke' } | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const failedChat = useRef<Parameters<typeof bridge.chat>[0] | null>(null);
  const completedReplies = useRef(new Map<string, CompletedReply>());
  const seenReplies = useRef(new Map<string, string>());
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const character = state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
  const matchingPacks = matchingCharacterPacks(state, newName, newWork);
  const setupCharacter = state.characters.find((c) => c.id === setupCharacterId);
  const message = messageDrafts[character.id] || '';
  const newTopicPending = Boolean(newTopicCharacters[character.id]);
  const allSkins = state.skins.filter((s) => s.characterId === character.id && availableStyle(s.style));
  const earlierArt = (s: Skin) =>
    Boolean(
      s.builtin &&
        /^(cyrene-(anime|chibi|pixel|plush)|cyrene-reference-v3|cyrene-(anime|pixel)-v4)$/.test(s.builtin),
    );
  const skins = allSkins.filter((s) => showEarlierArt || !earlierArt(s) || s.id === state.activeSkinId);
  const displaySkins = skins.filter((s) => usableCharacterSkin(s, character));
  const skin = displaySkins.find((s) => s.id === state.activeSkinId) || displaySkins[0];
  const messages = state.messages[character.id] || [];
  const memories = state.memories.filter((m) => m.characterId === character.id);
  const filteredMemories = memories
    .filter((m) => m.text.toLowerCase().includes(memoryQuery.toLowerCase().trim()))
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt),
    );
  const theme = resolveTheme(character);
  const lastReply = messages.filter((m) => m.role === 'assistant').at(-1);
  const connected = isDesktop && chatServiceReady(state.settings, keys);
  const localChat = state.settings.chatMode === 'local';
  const profileChanged =
    profile &&
    JSON.stringify({
      ...profileBase.current?.characters.find((c) => c.id === profile.id),
      visualReferences: undefined,
    }) !==
      JSON.stringify({ ...state.characters.find((c) => c.id === profile.id), visualReferences: undefined });
  const profileInputError = profile ? personaDraftError(profile) : '';
  const latestEditingMemory =
    editingMemory && state.memories.find((memory) => memory.id === editingMemory.id);
  const memoryChanged =
    editingMemory &&
    JSON.stringify(memoryBase.current?.memories.find((memory) => memory.id === editingMemory.id)) !==
      JSON.stringify(latestEditingMemory);
  useEffect(() => {
    // Held until something else replaces them: walking, being carried, sleeping, listening.
    if (
      action === 'idle' ||
      action === 'sleep' ||
      action.startsWith('walk_') ||
      action === 'drag' ||
      action === 'listen'
    )
      return;
    const animation = spriteAnimation(skin),
      clip = animation?.clips[action];
    const duration = isActivity(action)
      ? activityEnd.current > Date.now()
        ? Math.min(600000, activityEnd.current - Date.now())
        : activityDuration
      : // Sitting and lying down are stays, not gestures: whoever sat her down (her habits, keeping
        // the user company, the toolbar) decides when she gets up; this only stops a stay that
        // nobody ends.
        (action === 'sit' || action === 'lie') && clip
        ? POSE_STAY
        : animation && clip
          ? Math.min(120000, clipDuration(animation, clip) + 80)
          : 2600;
    const timeout = setTimeout(() => setAction('idle'), duration);
    return () => clearTimeout(timeout);
  }, [action, actionKey, skin]);
  useEffect(() => {
    if (!previewSpeech) return;
    const timeout = setTimeout(() => setPreviewSpeech(false), 2500);
    return () => clearTimeout(timeout);
  }, [previewSpeech]);
  useEffect(() => {
    document.documentElement.classList.toggle('pet-window', petMode);
    document.body.classList.toggle('pet-window', petMode);
    document.title = petMode ? 'Demiurge 桌宠' : 'Demiurge · 角色陪伴';
    let mounted = true;
    bridge
      .load()
      .then(async (result) => {
        const loaded = migrateState(result.state);
        if (!mounted) return;
        stateRef.current = loaded;
        setState(loaded);
        setKeys(result.keys);
        setSharedChatStatus(result.chatStatus || { busy: false });
        setReady(true);
        if (loaded !== result.state) {
          // Tidying an older workspace must never lock the user out of it: if the tidied copy
          // cannot be saved, carry on with the workspace exactly as it is on disk.
          try {
            applyState(await bridge.save(loaded, result.state));
          } catch (error) {
            if (!result.state) throw error;
            stateRef.current = result.state;
            setState(result.state);
            setToast(`启动时整理工作区未能保存，已按原样打开：${errorText(error)}`);
          }
        }
      })
      .catch((e) => {
        if (mounted) setLoadError(errorText(e));
      });
    const off = bridge.onStateChanged((value) => {
      applyState(value);
    });
    const offProgress = bridge.onProgress(setProgress);
    const offKeys = bridge.onKeysChanged(setKeys);
    const offChat = bridge.onChatStatusChanged?.(setSharedChatStatus);
    return () => {
      mounted = false;
      off();
      offProgress();
      offKeys();
      offChat?.();
    };
  }, [petMode]);
  useEffect(() => {
    if (!loadError || !isDesktop) return;
    let mounted = true;
    setHasPreviousState(false);
    void bridge.getRecoveryStatus().then(
      (status) => {
        if (mounted) setHasPreviousState(status.hasPreviousState);
      },
      (error) => {
        if (mounted) setRecoveryError(errorText(error));
      },
    );
    return () => {
      mounted = false;
    };
  }, [loadError]);
  useEffect(() => {
    if (!ready) return;
    setMotionEnabled(state.settings.motionEnabled !== false);
    setTracking(state.settings.trackingEnabled !== false);
  }, [ready, state.settings.motionEnabled, state.settings.trackingEnabled]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!interactionLine) return;
    const timeout = setTimeout(() => {
      setInteractionLine('');
      setBubbleHidden(true);
    }, 6500);
    return () => clearTimeout(timeout);
  }, [interactionLine]);
  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, chatBusy, petChat, chatExpanded, view]);
  useEffect(() => {
    setBubbleHidden(false);
  }, [lastReply?.id, character.id]);
  useEffect(() => {
    if (!lastReply || interactionBusy || talking || chatExpanded || petChat) return;
    const timer = setTimeout(
      () => setBubbleHidden(true),
      Math.min(22000, Math.max(9000, lastReply.content.length * 85)),
    );
    return () => clearTimeout(timer);
  }, [lastReply?.id, character.id, interactionBusy, talking, chatExpanded, petChat]);
  useEffect(() => {
    if (!createOpen || jobBusy) return;
    try {
      localStorage.setItem(
        creationDraftKey,
        JSON.stringify({ name: newName, work: newWork, notes: newNotes, urls: newUrls, mode: newMode }),
      );
      setCreationDraftSaved(true);
    } catch {
      setCreationDraftSaved(false);
    }
  }, [createOpen, jobBusy, newName, newWork, newNotes, newUrls, newMode]);
  useEffect(() => {
    if (!touchFeedback) return;
    const timeout = setTimeout(() => setTouchFeedback(null), 1200);
    return () => clearTimeout(timeout);
  }, [touchFeedback]);
  useEffect(() => {
    if (!ready) return;
    const replyId = lastReply?.id || '';
    if (!seenReplies.current.has(character.id)) {
      seenReplies.current.set(character.id, replyId);
      setEmotion(lastReply?.emotion || 'neutral');
      setAction('idle');
      return;
    }
    if (seenReplies.current.get(character.id) === replyId) return;
    seenReplies.current.set(character.id, replyId);
    setInteractionLine('');
    const nextAction = supportsAction(skin, lastReply?.action || 'idle')
      ? lastReply?.action || 'idle'
      : 'idle';
    const isRest = nextAction === 'sleep' || lastReply?.interaction === 'rest';
    const isWake = lastReply?.interaction === 'wake';
    if (isActivity(action)) behavior.current = freshBehavior();
    const admitted = admitBehavior(behavior.current, {
      event: 'reply',
      now: performance.now(),
      duration: actionDuration(nextAction),
      priority: isWake ? 100 : isRest ? 90 : 60,
      cooldown: 0,
      rest: isRest,
      wake: isWake,
    });
    if (admitted) {
      behavior.current = admitted;
      setResting(admitted.resting);
      setEmotion(
        supportsEmotion(skin, lastReply?.emotion || 'neutral') ? lastReply?.emotion || 'neutral' : 'neutral',
      );
      setAction(nextAction);
      setActionKey((v) => v + 1);
    }
    setTalking(Boolean(lastReply));
    const timeout = setTimeout(() => {
      if (!audioRef.current) setTalking(false);
    }, 3500);
    return () => clearTimeout(timeout);
  }, [lastReply?.id, character.id, ready]);
  useEffect(() => {
    if (!ready) return;
    setChatError('');
    setChatExpanded(false);
    setSceneSettingsOpen(false);
    setZoom(1);
    setPersonaPreviewOpen(false);
    stopAudio();
    setEmotion(lastReply?.emotion || 'neutral');
    setAction('idle');
    seenReplies.current.set(character.id, lastReply?.id || '');
  }, [character.id, ready]);
  const lifeKey = `mori-life-${character.id}`;
  function persistLife() {
    try {
      localStorage.setItem(lifeKey, JSON.stringify(lifeRef.current));
    } catch {
      /* Life state is a convenience; the companion works without it. */
    }
    setLifeVersion((v) => v + 1);
  }
  // The other window (desktop pet or main window) saved her day: take what it changed, so a chat in
  // the main window is not undone by the desktop pet's next save. The pet runs her routine, so it
  // takes only feelings newer than its own; the main window mirrors everything.
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== lifeKey || !event.newValue) return;
      const theirs = readLife(),
        ours = lifeRef.current;
      if (!petMode) lifeRef.current = theirs;
      else if (theirs.mood && (!ours.mood || theirs.mood.updatedAt > ours.mood.updatedAt))
        ours.mood = theirs.mood;
      else return;
      setLifeVersion((v) => v + 1);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [lifeKey, petMode]);
  function readLife() {
    let life: LifeState;
    try {
      life = restoreLife(JSON.parse(localStorage.getItem(lifeKey) || 'null'));
    } catch {
      life = createLife();
    }
    life.mood = restoreMood(life.mood);
    return life;
  }
  // How she feels (mood.ts), kept with her daily life.
  function moodOf(): Mood {
    const life = lifeRef.current;
    if (!life.mood) life.mood = restoreMood(undefined);
    return life.mood;
  }
  // Something happened between her and the user: her feelings change, and she may say so.
  // Comforted out of being cross, she stops sulking on the desktop.
  function feelNow(event: MoodEvent): string | null {
    const m = moodOf();
    const wasAngry = m.anger >= ANGRY;
    feel(m, event);
    persistLife();
    if (wasAngry && m.anger < ANGRY) {
      desktop.forgive();
      return moodLine('comforted', m);
    }
    return moodLine(event, m);
  }
  function say(line: string | null) {
    if (!line) return;
    setInteractionLine(line);
    setBubbleHidden(false);
  }
  const attentionKey = `mori-attention-${character.id}`;
  function persistAttention() {
    try {
      localStorage.setItem(attentionKey, JSON.stringify(attentionRef.current));
    } catch {
      /* Without storage the limits still hold for this session. */
    }
  }
  useEffect(() => {
    try {
      attentionRef.current = restoreAttention(JSON.parse(localStorage.getItem(attentionKey) || 'null'));
    } catch {
      attentionRef.current = freshAttention();
    }
  }, [attentionKey]);
  useEffect(() => {
    if (!ready || !isDesktop) return;
    let live = true;
    const poll = () =>
      void bridge
        .userIdle()
        .then((seconds) => {
          if (live && Number.isFinite(seconds)) userIdleRef.current = seconds;
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [ready]);
  useEffect(() => {
    lifeRef.current = readLife();
    setInvitation(null);
    setMoment(null);
    activityEnd.current = 0;
    setLifeVersion((v) => v + 1);
  }, [character.id]);
  useEffect(() => {
    if (!resting && action !== 'sleep') asleepSince.current = 0;
    else if (!asleepSince.current) asleepSince.current = Date.now();
  }, [resting, action]);
  // What the user is doing, from the desktop pet's view of the desktop (see userContext.ts).
  const contextRef = useRef<UserContext | null>(null);
  // Data plugins from the community (a behaviour profile and lines for one character or all).
  const [plugins, setPlugins] = useState<CommunityPlugin[]>([]);
  const [communityOpen, setCommunityOpen] = useState(false);
  useEffect(() => {
    if (!ready) return;
    void bridge.communityPlugins().then(setPlugins, () => {});
  }, [ready]);
  // How this particular character lives on the desktop (characterBehavior.ts): her own profile,
  // what her pack sets, then any plugin for her or for everyone.
  const pluginProfile = plugins
    .filter((p) => p.target === 'all' || p.target === character.id)
    .reduce<NonNullable<Character['desktopProfile']>>(
      (all, p) => ({
        ...all,
        ...p.profile,
        manner: { ...all.manner, ...p.profile.manner },
        lines: { ...all.lines, ...p.profile.lines },
      }),
      {},
    );
  const petProfile = desktopProfile(character, plugins.length ? pluginProfile : undefined);
  const actionNow = useRef(action);
  actionNow.current = action;
  // A small mark she shows for a moment (a blush after a pat, a note while humming).
  const [flash, setFlash] = useState<{ mark: string; until: number } | null>(null);
  const showMark = (mark: string, ms = 2400) => {
    setFlash({ mark, until: Date.now() + ms });
    setTimeout(() => setFlash((f) => (f && f.until <= Date.now() ? null : f)), ms + 50);
  };
  // Vanishing and reappearing, for looks that cannot walk.
  const [vanished, setVanished] = useState(false);
  const desktop = useDesktopLife({
    petMode,
    characterId: character.id,
    enabled: ready && motionEnabled && state.settings.desktopLifeEnabled !== false,
    blocked: interactionBusy || talking || resting || Boolean(moment) || petChat || petComposer,
    temperament: character.behavior,
    tired: lifeRef.current.activity === 'sleep' || lifeRef.current.energy < 18,
    occupied: isActivity(action),
    held: () => userHeld.current > performance.now(),
    onAction: (a, sudden) => {
      setAction(
        supportsAction(skin, a) ? a : a === 'bounce' && supportsAction(skin, 'drag') ? 'drag' : 'idle',
      );
      if (sudden) setSnap((n) => n + 1);
    },
    onLine: (line) => {
      setInteractionLine(line);
      setBubbleHidden(false);
    },
    onRemark: (line) => {
      // Her own remarks share the attention budget with the routine's chatter, and wait while
      // the user is typing or in a meeting.
      if (contextRef.current?.quiet) return;
      if (!mayRemark(attentionRef.current, Date.now(), userIdleRef.current)) return;
      recordRemark(attentionRef.current, Date.now());
      persistAttention();
      setInteractionLine(line);
      setBubbleHidden(false);
    },
    onLand: (height) => {
      setLanding((n) => n + 1);
      // A short hop or a gentle drop by the user gets the usual reaction to being carried.
      if (dropping.current) {
        dropping.current = false;
        if (height < 140) interact('drag');
      }
    },
    onPerch: () => {
      const doing = lifeRef.current.activity;
      if (isActivity(doing) && supportsAction(skin, doing)) move(doing, 'neutral', true);
      else setAction(supportsAction(skin, 'read') ? 'read' : 'idle');
    },
    onContext: (context) => {
      contextRef.current = context;
    },
    // At the user's window, she may do the thing her routine has her doing.
    onCompany: (own) => {
      const doing = lifeRef.current.activity;
      if (!own || !motionEnabled || !isActivity(doing) || !supportsAction(skin, doing)) return false;
      move(doing, 'neutral', true);
      return true;
    },
    supports: (a) => supportsAction(skin, a),
    travel: petProfile.travel,
    habits: petProfile.habits,
    // Nobody has been with her for a long while: she goes over to the user to ask for attention.
    lonely: moodName(moodOf()) === 'lonely' || Date.now() - moodOf().lastContact > 25 * 60000,
    mood: moodName(moodOf()),
    current: () => actionNow.current,
    onSeek: () => seekAttention(),
    onTeleport: (phase) => setVanished(phase === 'out'),
    onHabit: (habit) => {
      if (habit !== 'hum') return;
      showMark('♪', 3200);
      if (supportsEmotion(skin, 'happy')) setEmotion('happy');
    },
    onEnter: () => {
      // Arrived: a wave, and soon on to something of her own rather than standing there.
      if (motionEnabled && supportsAction(skin, 'wave')) move('wave', 'happy', true);
      lifeRef.current.until = Math.min(lifeRef.current.until, Date.now() + 9000);
    },
    onFall: (cause) => {
      // A fall ends whatever she was showing above her head (a hum's ♪): how she feels shows now.
      setFlash(null);
      if (cause === 'gone') {
        say('诶？窗口不见了……');
        return false;
      }
      say(feelNow('flung'));
      if (moodOf().anger < ANGRY || Math.random() >= 0.6) return false;
      // Cross enough to sit there sulking until she is comforted.
      setTimeout(() => say(moodLine('sulk', moodOf())), 2600);
      return true;
    },
    onResult: (found) => {
      settleInvite(lifeRef.current, found ? 'accept' : 'ignored');
      if (found) {
        lifeRef.current.desktopEvents = [
          ...(lifeRef.current.desktopEvents || []),
          { at: Date.now(), text: '一起玩捉迷藏，你找到了我' },
        ].slice(-12);
        lifeRef.current.social = Math.max(0, lifeRef.current.social - 35);
      }
      persistLife();
    },
  });
  const lifeTick = useRef<() => void>(() => {});
  lifeTick.current = () => {
    // The desktop pet, when open, owns the routine; the main window mirrors its state.
    let petAlive = false;
    try {
      if (petMode) localStorage.setItem('mori-life-pet-heartbeat', String(Date.now()));
      else petAlive = Date.now() - Number(localStorage.getItem('mori-life-pet-heartbeat') || 0) < 15000;
    } catch {
      /* Without storage each window keeps its own routine. */
    }
    if (petAlive) {
      lifeRef.current = readLife();
      setLifeVersion((v) => v + 1);
      return;
    }
    const life = lifeRef.current;
    const now = Date.now(),
      attention = attentionRef.current;
    const context = contextRef.current;
    // Time passes for her feelings too: alone, she grows lonely; anger cools down. Keeping the user
    // company on the desktop, or on the home screen while they are on it, she is not alone.
    settleMood(
      moodOf(),
      now,
      context?.mode !== 'away',
      petMode ? desktop.company : view === 'home' && document.hasFocus(),
    );
    if (
      state.settings.proactiveEnabled !== false &&
      noticeReturn(attention, now, userIdleRef.current, openedAt.current) &&
      !interactionBusy &&
      !talking &&
      !moment
    ) {
      persistAttention();
      if (motionEnabled && supportsAction(skin, 'wave')) interact('greet', true);
      setInteractionLine(
        feelNow('greet') ||
          ['你回来啦！', '欢迎回来，刚才去做什么了？', '回来啦。我一直在这边等你哦。'][
            Math.floor(Math.random() * 3)
          ],
      );
      setBubbleHidden(false);
    }
    const asking = life.pending;
    const feeling = moodName(moodOf());
    const step = advanceLife(life, {
      available: activities.map((item) => item.id),
      temperament: character.behavior,
      proactive: state.settings.proactiveEnabled !== false,
      canInvite: !context?.quiet && mayInvite(attention, now, userIdleRef.current, character.behavior),
      canRemark: !context?.quiet && mayRemark(attention, now, userIdleRef.current),
      // What the user is doing shapes what she does: alongside them while they work, her own
      // things while they are away.
      ...(context
        ? {
            context: {
              mode: context.mode,
              key: context.app,
              companion:
                context.companion && supportsAction(skin, context.companion) ? context.companion : null,
              idleMinutes: context.idleMinutes,
            },
          }
        : {}),
      feelings: { lonely: feeling === 'lonely', angry: feeling === 'angry' },
      hobbies: petProfile.hobbies,
      leanings: moodConduct(feeling).activities,
      blocked:
        interactionBusy ||
        talking ||
        resting ||
        Boolean(moment) ||
        desktop.active ||
        petChat ||
        petComposer ||
        Boolean(drag.current) ||
        // Sitting or lying down is a stay: her routine waits until she gets up.
        action === 'sit' ||
        action === 'lie' ||
        (behavior.current.priority >= 100 && behavior.current.until > performance.now()),
    });
    // She asked and nobody answered.
    if (asking && !life.pending) feelNow('ignored');
    if (!step) return;
    if (!life.pending) setInvitation(null);
    if (
      petMode &&
      !desktop.active &&
      !step.invite &&
      !life.pending &&
      !context?.company &&
      ['read', 'diary', 'office'].includes(step.activity)
    )
      void desktop.explore('read', true);
    if (step.changed) {
      if (isActivity(step.activity) && supportsAction(skin, step.activity) && motionEnabled) {
        activityEnd.current = life.until;
        move(step.activity, 'neutral', true);
      } else if (isActivity(action)) {
        activityEnd.current = 0;
        move('idle', emotion);
      }
    }
    if (step.invite) recordInvite(attention, now);
    if (step.speech && !step.invite) recordRemark(attention, now);
    if (step.invite || step.speech) persistAttention();
    if (step.invite) {
      setInvitation(step.invite);
      setBubbleHidden(false);
      if (petMode)
        void desktop.explore('hide', true).then((started) => {
          if (started) {
            setInvitation(null);
            lifeRef.current.pending = null;
            persistLife();
          }
        });
    } else if (step.speech && !interactionLine) {
      setInteractionLine(step.speech);
      setBubbleHidden(false);
    }
    persistLife();
  };
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => lifeTick.current(), 5000);
    return () => clearInterval(timer);
  }, [ready]);
  function openPetComposer() {
    setPetChat(false);
    setPetComposer(true);
    setTimeout(() => composerRef.current?.focus(), 0);
  }
  // Accepting what she asked for: a game, a chat, or a pat on the head.
  function acceptInvitation(offer: Offer) {
    if (isMoment(offer)) return openMoment(offer);
    settleInvite(lifeRef.current, 'accept');
    setInvitation(null);
    persistLife();
    if (offer === 'pat') return touchCharacter('headpat');
    say(
      ['那……你今天过得怎么样？', '嘿嘿，那我们聊聊天吧。最近有什么开心的事吗？'][
        Math.floor(Math.random() * 2)
      ],
    );
    if (petMode) openPetComposer();
    else document.querySelector<HTMLTextAreaElement>('[aria-label="聊天消息"]')?.focus();
  }
  function openMoment(id: MomentId) {
    // Still cross: no games until she has been comforted.
    if (moodName(moodOf()) === 'angry') {
      say(moodLine('refuse', moodOf()));
      return;
    }
    desktop.stop();
    if (invitation) settleInvite(lifeRef.current, 'accept');
    setInvitation(null);
    setInteractionLine('');
    setMoment(id);
    persistLife();
  }
  momentActRef.current = (value, face = 'neutral') => {
    if (!motionEnabled) {
      setEmotion(supportsEmotion(skin, face) ? face : 'neutral');
      return;
    }
    move(supportsAction(skin, value) ? value : 'idle', face, true);
  };
  function closeMoment() {
    setMoment(null);
    move('idle', 'neutral', true);
  }
  function declineInvitation() {
    feelNow('declined');
    settleInvite(lifeRef.current, 'decline');
    setInvitation(null);
    setInteractionLine('好，那我先自己找点事做，你忙完再来找我。');
    persistLife();
  }
  function finishMoment(result: MomentResult) {
    if (!moment) return;
    feelNow('play');
    recordMoment(lifeRef.current, moment, result.outcome);
    setMoment(null);
    setInteractionLine(result.line);
    setBubbleHidden(false);
    const face = supportsEmotion(skin, result.emotion) ? result.emotion : 'neutral';
    if (motionEnabled && supportsAction(skin, result.action)) {
      if (isActivity(result.action)) activityEnd.current = Date.now() + 30000;
      move(result.action, face, true);
    } else if (motionEnabled && supportsAction(skin, 'nod')) move('nod', face);
    else setEmotion(face);
    persistLife();
  }
  useEffect(() => {
    // The conversation lives on the home screen; the old chat page opens its history drawer.
    // Declared after the reset above so it wins when both run as the workspace loads.
    if (view !== 'chat' || !ready) return;
    setChatExpanded(true);
    setView('home');
  }, [view, ready]);
  useEffect(() => {
    behavior.current = freshBehavior();
    interactionCounts.current = {};
    setResting(false);
    setInteractionLine('');
    setTouchFeedback(null);
    setAction('idle');
  }, [character.id, skin?.id]);
  useEffect(() => {
    if ((!petMode && view !== 'home') || resting || talking || interactionBusy || emotion === 'neutral')
      return;
    const timer = setTimeout(() => setEmotion('neutral'), 6000);
    return () => clearTimeout(timer);
  }, [petMode, view, resting, talking, interactionBusy, emotion, actionKey]);
  useEffect(() => {
    if (!petChat) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPetChat(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [petChat]);
  useEffect(() => {
    if (!petMode) return;
    return bridge.onPetRoom?.(setPetRoom);
  }, [petMode]);
  // Summoned: she runs in from the nearer side of the screen instead of just appearing. Moving to
  // another Space or full-screen app, she runs in from the side the user moved toward.
  const enterRef = useRef(desktop.enterFrom);
  enterRef.current = desktop.enterFrom;
  const entered = useRef(false);
  useEffect(() => {
    if (!petMode || !ready || entered.current || !skin) return;
    entered.current = true;
    const timer = setTimeout(() => {
      const middle = window.screenX + innerWidth / 2;
      const screenMiddle =
        ((screen as Screen & { availLeft?: number }).availLeft || 0) + screen.availWidth / 2;
      void enterRef.current(middle >= screenMiddle ? 'right' : 'left');
    }, 900);
    return () => clearTimeout(timer);
  }, [petMode, ready, skin]);
  useEffect(() => {
    if (!petMode) return;
    return bridge.onSpaceChanged?.(({ from }) => void enterRef.current(from, true));
  }, [petMode]);
  // The message box takes the keyboard when it opens, and folds away when the user goes back to
  // another app without having typed anything.
  useEffect(() => {
    if (!petComposer || petChat) return;
    composerRef.current?.focus();
    const away = () => {
      if (!composerRef.current?.value.trim() && !chatBusy) setPetComposer(false);
    };
    window.addEventListener('blur', away);
    return () => window.removeEventListener('blur', away);
  }, [petComposer, petChat, chatBusy]);
  // Greetings are no longer on a timer: she greets the user when they come back (see lifeTick).
  useEffect(() => {
    const el = landRef.current;
    if (!landing || !el) return;
    el.classList.remove('landing');
    void el.offsetWidth;
    el.classList.add('landing');
  }, [landing]);
  useEffect(() => {
    if (!petMode) return;
    const el = document.querySelector<HTMLElement>('.pet-draggable');
    if (!el) return;
    // Scrolling resizes gently; a trackpad pinch arrives as a wheel event with ctrlKey.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      resizePetRef.current(petScaleRef.current * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.001)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [petMode, ready]);
  useEffect(() => {
    if (!petMode || !isDesktop) return;
    let ignore = false;
    let over = false;
    // A head pat without clicking: the pointer moving back and forth over her head. Three turns
    // of at least 4 points within 2 seconds count, at an ordinary stroking speed; then a pause
    // before the next one. Over her head means the top of her figure, gaps in her hair included.
    // Strokes are read from where the pointer is (the main process reports it whichever app is in
    // front), since the page gets no mouse moves while another app is active.
    let strokes: { x: number; at: number; dir: number }[] = [],
      patAt = 0;
    const stroke = (x: number, onHead: boolean) => {
      const now = performance.now();
      if (!onHead || drag.current || now - patAt < 2500) {
        strokes = [];
        return;
      }
      const last = strokes.at(-1);
      if (!last) return void strokes.push({ x, at: now, dir: 0 });
      const dx = x - last.x;
      if (Math.abs(dx) < 4) return;
      const dir = Math.sign(dx);
      strokes.push({ x, at: now, dir });
      strokes = strokes.filter((s) => now - s.at < 2000);
      let turns = 0;
      for (let i = 1; i < strokes.length; i++)
        if (strokes[i].dir && strokes[i - 1].dir && strokes[i].dir !== strokes[i - 1].dir) turns++;
      if (turns >= 3) {
        patAt = now;
        strokes = [];
        hoverPat.current();
      }
    };
    // Where the pointer is: over her, over her controls, or over nothing (clicks pass through).
    const pointAt = (x: number, y: number, target: EventTarget | null, reported: boolean) => {
      const controls =
        target instanceof Element &&
        target.closest(
          '.pet-toolbar-zone,.pet-composer-area,.pet-chat-panel,.pet-speech,.pet-invite,.pet-moment-bubble,.star-field .falling-star,.pet-toast',
        );
      const figure = document.querySelector('.pet-draggable');
      const hit = figure ? hitCharacter(figure, x, y) : null;
      const onFigure = Boolean(hit);
      if (reported) stroke(x, !controls && !!figure && overHead(figure, x, y));
      const next = !drag.current && !controls && !onFigure;
      if (next !== ignore) {
        ignore = next;
        bridge.setPetClickThrough(next);
      }
      if (onFigure !== over) {
        over = onFigure;
        setFigureHover(onFigure);
      }
    };
    const pointer = (e: MouseEvent) => pointAt(e.clientX, e.clientY, e.target, false);
    const unsubscribe = bridge.onPointer?.((point) => {
      if (point) pointAt(point.x, point.y, document.elementFromPoint(point.x, point.y), true);
      else {
        strokes = [];
        if (!drag.current) pointAt(-1, -1, null, false);
      }
    });
    window.addEventListener('mousemove', pointer);
    return () => {
      unsubscribe?.();
      window.removeEventListener('mousemove', pointer);
      bridge.setPetClickThrough(false);
    };
  }, [petMode]);
  useEffect(
    () => () => {
      audioRef.current?.pause();
      cancelAnimationFrame(audioFrame.current);
      void audioContext.current?.close();
    },
    [],
  );
  function startSwing() {
    const s = swing.current;
    if (s.raf) return;
    s.last = performance.now();
    const step = () => {
      const now = performance.now(),
        dt = Math.min(0.05, (now - s.last) / 1000) || 0.016;
      s.last = now;
      // The pointer's speed fades when it stops, so she swings back under the grab point.
      s.vx *= Math.exp(-dt * 5);
      const target = s.lifted ? Math.max(-28, Math.min(28, -s.vx * 0.035)) : 0;
      s.velocity += ((target - s.angle) * 70 - s.velocity * 9) * dt;
      s.angle += s.velocity * dt;
      const el = bodyRef.current;
      const moving = s.lifted || Math.abs(s.angle) > 0.15 || Math.abs(s.velocity) > 0.4;
      if (el) {
        el.style.transformOrigin = s.origin;
        el.style.transform = moving
          ? `rotate(${s.angle.toFixed(2)}deg)${s.lifted ? ' scale(0.98, 1.03)' : ''}`
          : '';
      }
      if (moving) s.raf = requestAnimationFrame(step);
      else {
        s.raf = 0;
        s.angle = s.velocity = 0;
      }
    };
    s.raf = requestAnimationFrame(step);
  }
  // Desktop pet size: scroll or pinch over her, or use the toolbar; saved a moment later.
  petScaleRef.current =
    liveScale.current ??
    state.settings.petScale ??
    { small: 220 / 300, medium: 1, large: 390 / 300 }[state.settings.petSize || 'medium'];
  // `note`: say the new size over her (scrolling and pinching); the slider shows it itself.
  function resizePet(value: number, note = true) {
    const next = Math.round(Math.max(0.45, Math.min(2.6, value)) * 100) / 100;
    liveScale.current = next;
    petScaleRef.current = next;
    bridge.scalePet(next);
    setSizeNote(note ? `大小 ${Math.round(next * 100)}%` : '');
    clearTimeout(scaleNote.current);
    scaleNote.current = setTimeout(() => setSizeNote(''), 1400);
    clearTimeout(scaleSave.current);
    scaleSave.current = setTimeout(() => {
      commit((s) => ({ ...s, settings: { ...s.settings, petScale: next } }));
      liveScale.current = null;
    }, 600);
  }
  resizePetRef.current = resizePet;
  async function save(updater: (s: AppState) => AppState, original?: AppState | null) {
    const pending = saveQueue.current
      .catch(() => {})
      .then(async () => {
        const base = original || stateRef.current;
        const next = updater(base);
        if (next.activeSkinId && next.activeSkinId !== base.activeSkinId) {
          const owner = next.characters.find((c) => c.id === next.activeCharacterId);
          const selected = next.skins.find((s) => s.id === next.activeSkinId);
          if (owner && selected && usableCharacterSkin(selected, owner))
            next.preferredSkins = { ...next.preferredSkins, [owner.id]: selected.id };
        }
        applyState(await bridge.save(next, base));
      });
    saveQueue.current = pending;
    await pending;
  }
  function applyState(value: AppState) {
    if ((value.revision || 0) < (stateRef.current.revision || 0)) return;
    stateRef.current = value;
    setState(value);
  }
  function commit(updater: (s: AppState) => AppState) {
    void save(updater).catch((e) => setToast(`保存失败：${errorText(e)}`));
  }
  function updatePlayback(key: 'motionEnabled' | 'trackingEnabled', value: boolean) {
    commit((s) => ({ ...s, settings: { ...s.settings, [key]: value } }));
  }
  async function saveDraft(updater: (s: AppState) => AppState, done: () => void, original?: AppState | null) {
    if (draftSaving) return;
    setDraftSaving(true);
    try {
      await save(updater, original);
      done();
      setToast('修改已保存。');
    } catch (error) {
      setToast(`保存失败，草稿已保留：${errorText(error)}`);
    } finally {
      setDraftSaving(false);
    }
  }
  function openProfile() {
    profileBase.current = stateRef.current;
    setProfile(structuredClone(character));
  }
  function openMemory(memory: Memory) {
    memoryBase.current = stateRef.current;
    setEditingMemory({ ...memory });
  }
  async function copyMessage(text: string) {
    try {
      await bridge.copyText(text);
      setToast('已复制回复。');
    } catch (error) {
      setToast(`复制失败：${errorText(error)}`);
    }
  }
  function move(value: PetAction, face: Emotion = emotion, automatic = false) {
    if (!automatic) {
      if (desktop.active) desktop.stop();
      activityEnd.current = isActivity(value) ? Date.now() + activityDuration : 0;
      userHeld.current = performance.now() + actionDuration(value);
    }
    behavior.current = {
      ...freshBehavior(),
      resting: value === 'sleep',
      until: performance.now() + actionDuration(value),
      priority: 100,
    };
    setResting(value === 'sleep');
    setAction(supportsAction(skin, value) ? value : 'idle');
    setEmotion(supportsEmotion(skin, face) ? face : 'neutral');
    setActionKey((v) => v + 1);
  }
  function actionDuration(value: PetAction) {
    const animation = spriteAnimation(skin),
      clip = animation?.clips[value];
    return isActivity(value)
      ? activityEnd.current > Date.now()
        ? Math.min(600000, activityEnd.current - Date.now())
        : activityDuration
      : value === 'idle'
        ? 500
        : animation && clip
          ? clipDuration(animation, clip) + 80
          : 2600;
  }
  function interact(event: CompanionEvent, automatic = false) {
    if (interactionBusy || talking || (automatic && (!motionEnabled || !state.settings.proactiveEnabled)))
      return false;
    if (!automatic && isActivity(action)) behavior.current = freshBehavior();
    const plan = interactionPlan(
      event,
      character,
      (Object.keys(actionNames) as PetAction[]).filter((action) => supportsAction(skin, action)),
      emotions.map((face) => face.id).filter((face) => supportsEmotion(skin, face)),
      interactionCounts.current[event] || 0,
    );
    const admitted = admitBehavior(behavior.current, {
      event: automatic ? 'proactive' : ['touch', 'headpat', 'poke'].includes(event) ? 'touch' : event,
      now: performance.now(),
      duration: actionDuration(plan.action),
      priority: automatic ? 10 : event === 'wake' ? 100 : event === 'rest' ? 90 : event === 'drag' ? 80 : 40,
      cooldown: automatic
        ? proactiveInterval(character)
        : event === 'headpat' || event === 'poke'
          ? 1800
          : event === 'touch'
            ? 4000
            : event === 'greet'
              ? 8000
              : 1000,
      rest: event === 'rest',
      wake: event === 'wake',
    });
    if (!admitted) return false;
    if (!automatic) userHeld.current = Math.max(userHeld.current, admitted.until);
    behavior.current = admitted;
    interactionCounts.current[event] = (interactionCounts.current[event] || 0) + 1;
    setResting(admitted.resting);
    // Patted or poked while sitting or lying down, she stays down and answers with a look and a
    // word instead of getting up for a nod.
    const staysDown = (action === 'sit' || action === 'lie') && ['touch', 'headpat', 'poke'].includes(event);
    if (!staysDown) {
      setAction(motionEnabled || event === 'rest' ? plan.action : 'idle');
      setActionKey((key) => key + 1);
    }
    setEmotion(plan.emotion);
    if (!automatic) {
      setInteractionLine(plan.text);
      setBubbleHidden(false);
    }
    return true;
  }
  function touchCharacter(kind: 'headpat' | 'poke') {
    // Touched while napping on the desktop: she wakes up, grumpy if she was really asleep.
    const napping = action === 'sleep' && !resting && Date.now() - asleepSince.current > 60000;
    if (!interact(kind)) return;
    setTouchFeedback({ kind, key: performance.now() });
    if (napping) return say(feelNow('woken'));
    const asked = kind === 'headpat' && awaitingPat.current > Date.now();
    if (asked) awaitingPat.current = 0;
    const line = feelNow(kind === 'headpat' ? 'headpat' : 'poke');
    // Her own way of taking it: a blush, a tease, a giggle (characterBehavior.ts).
    showMark(touchMark(petProfile, kind));
    say(line || (asked ? '嘿嘿……谢谢你。' : Math.random() < 0.6 ? pickLine(petProfile, kind) : null));
  }
  // She would like some attention: she asks for a chat, a pat or a game, in her own words, unless
  // the user is busy (typing, in a meeting) or she has asked recently.
  function seekAttention() {
    const context = contextRef.current;
    if (context?.quiet || invitation || moment || interactionBusy || talking || resting) return;
    if (!mayInvite(attentionRef.current, Date.now(), Math.max(20, userIdleRef.current), character.behavior)) {
      // Too soon to ask outright: a glance and a word instead.
      const peek = pickLine(petProfile, 'peek');
      if (peek && mayRemark(attentionRef.current, Date.now(), userIdleRef.current)) {
        recordRemark(attentionRef.current, Date.now());
        persistAttention();
        say(peek);
      }
      return;
    }
    const feeling = moodName(moodOf());
    const offer: Offer =
      feeling === 'angry'
        ? 'pat'
        : feeling === 'lonely'
          ? Math.random() < 0.5
            ? 'chat'
            : 'pat'
          : (['guess', 'stars', 'read', 'snack', 'chat'] as Offer[])[Math.floor(Math.random() * 5)];
    recordInvite(attentionRef.current, Date.now());
    persistAttention();
    lifeRef.current.pending = { offer, expires: Date.now() + 60000 };
    lifeRef.current.lastOffer = offer;
    persistLife();
    setInvitation(offer);
    const ask = pickLine(petProfile, 'seek');
    if (ask) say(ask);
  }
  hoverPat.current = () => {
    if (resting) wakeUp();
    else touchCharacter('headpat');
  };
  // Woken up by the user: grumpy after real sleep.
  function wakeUp() {
    const slept = Date.now() - asleepSince.current > 60000;
    if (interact('wake') && slept) say(feelNow('woken'));
  }
  async function switchChatMode(mode: 'model' | 'local') {
    if (interactionBusy) return;
    try {
      await save((state) => ({ ...state, settings: { ...state.settings, chatMode: mode } }));
      setChatError('');
    } catch (error) {
      setToast(errorText(error));
    }
  }
  function selectCharacter(c: Character) {
    if (jobBusy || chatBusy) {
      setToast('请等当前任务完成。');
      return;
    }
    commit((s) => ({
      ...s,
      activeCharacterId: c.id,
      activeSkinId: selectedCharacterSkin(s, c)?.id || '',
    }));
  }
  function stopAudio() {
    audioRequest.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    cancelAnimationFrame(audioFrame.current);
    mouth.current = 0;
    setTalking(false);
    setAudioBusy(false);
    void audioContext.current?.close();
    audioContext.current = null;
  }
  async function speak(text: string) {
    stopAudio();
    const token = audioRequest.current;
    setAudioBusy(true);
    try {
      const data = await bridge.speak(text);
      if (token !== audioRequest.current) return;
      const audio = new Audio(data);
      const context = new AudioContext();
      audioContext.current = context;
      audioRef.current = audio;
      const source = context.createMediaElementSource(audio);
      const analyzer = context.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);
      analyzer.connect(context.destination);
      const samples = new Uint8Array(analyzer.frequencyBinCount);
      const tick = () => {
        analyzer.getByteTimeDomainData(samples);
        let energy = 0;
        for (const x of samples) energy += ((x - 128) / 128) ** 2;
        mouth.current = Math.min(1, Math.sqrt(energy / samples.length) * 5);
        audioFrame.current = requestAnimationFrame(tick);
      };
      await context.resume();
      await audio.play();
      setTalking(true);
      tick();
      audio.onended = stopAudio;
      audio.onerror = () => {
        stopAudio();
        setToast('音频播放失败，请检查服务返回格式。');
      };
    } catch (e) {
      if (token === audioRequest.current) {
        stopAudio();
        setToast(errorText(e));
      }
    } finally {
      if (token === audioRequest.current) setAudioBusy(false);
    }
  }
  async function sendChat(text = message, retry = false) {
    if (interactionBusy || (!text.trim() && !retry)) return;
    if (!connected && !localChat && !(retry && completedReplies.current.has(character.id))) {
      setChatError('自由聊天需要对话 API Key 与模型；也可以选择上方的「本地台词」，使用已编写的日常回应。');
      return;
    }
    // Being talked to cheers her up and keeps her from feeling alone.
    if (!retry) feelNow('chat');
    const currentCharacter = character;
    setChatBusy(true);
    chatCancelled.current = false;
    setChatStopping(false);
    setChatError('');
    stopAudio();
    setInteractionLine('');
    setBubbleHidden(true);
    if (!behavior.current.resting) {
      if (isActivity(action)) behavior.current = freshBehavior();
      setAction('idle');
      setEmotion(supportsEmotion(skin, 'thinking') ? 'thinking' : 'neutral');
    }
    try {
      const cached = completedReplies.current.get(currentCharacter.id);
      if (cached) {
        await save((s) => appendCompletedReply(s, cached));
        completedReplies.current.delete(currentCharacter.id);
        failedChat.current = null;
        if (retry) {
          if (stateRef.current.settings.voiceEnabled && cached.reply.origin !== 'script')
            void speak(cached.reply.text);
          return;
        }
      }
      let history = stateRef.current.messages[currentCharacter.id] || [];
      if (!retry) {
        failedChat.current = null;
        const userMessage = {
          id: id(),
          role: 'user' as const,
          content: text.trim(),
          createdAt: now(),
          ...(newTopicPending ? { contextStart: true } : {}),
        };
        await save((s) => ({
          ...s,
          messages: {
            ...s.messages,
            [currentCharacter.id]: [...(s.messages[currentCharacter.id] || []), userMessage],
          },
        }));
        history = stateRef.current.messages[currentCharacter.id] || [];
        history = history.slice(0, history.findIndex((m) => m.id === userMessage.id) + 1);
        setNewTopicCharacters((topics) => ({ ...topics, [currentCharacter.id]: false }));
        setMessageDrafts((drafts) => ({
          ...drafts,
          [currentCharacter.id]:
            drafts[currentCharacter.id]?.trim() === text.trim() ? '' : drafts[currentCharacter.id] || '',
        }));
      }
      if (chatCancelled.current) throw new Error('已停止等待这次回复。');
      const request =
        retry && failedChat.current?.character.id === character.id
          ? failedChat.current
          : {
              character: { ...currentCharacter, visualReferences: undefined },
              messages: history.slice(-24),
              memories: stateRef.current.memories.filter((m) => m.characterId === currentCharacter.id),
              skinId: skin?.id,
              situation: lifeSituation(
                lifeRef.current,
                Object.fromEntries(activities.map((item) => [item.id, item.doing])),
                Date.now(),
                moodWords(moodOf()),
              ),
            };
      failedChat.current = request;
      const reply = await bridge.chat({ ...request, skinId: skin?.id });
      if (chatCancelled.current) throw new Error('已停止等待这次回复。');
      const completed = {
        characterId: currentCharacter.id,
        reply,
        messageId: id(),
        memoryId: id(),
        replyTo: request.messages.at(-1)?.id,
        createdAt: now(),
      };
      completedReplies.current.set(currentCharacter.id, completed);
      await save((s) => appendCompletedReply(s, completed));
      completedReplies.current.delete(currentCharacter.id);
      failedChat.current = null;
      if (stateRef.current.settings.voiceEnabled && reply.origin !== 'script') void speak(reply.text);
    } catch (e) {
      setChatError(
        `${completedReplies.current.has(currentCharacter.id) ? '回复已生成，暂未保存到本机。重试只保存，不会再次调用模型。' : ''}${errorText(e)}`,
      );
      move('idle', 'neutral');
    } finally {
      setChatBusy(false);
      setChatStopping(false);
    }
  }
  function stopChat() {
    if (!chatBusy || chatStopping) return;
    chatCancelled.current = true;
    setChatStopping(true);
    void bridge.cancelChat().catch((error) => setToast(errorText(error)));
  }
  async function exportConversation() {
    try {
      if (await bridge.exportChat(character.id)) setToast('对话已导出为文本。');
    } catch (error) {
      setToast(errorText(error));
    }
  }
  function revealMessage(messageId: string) {
    setHistoryOpen(false);
    setChatExpanded(true);
    if (petMode) setPetChat(true);
    else setView('home');
    setTimeout(
      () =>
        document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({
          block: 'center',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        }),
      80,
    );
  }
  function beginTopic() {
    setNewTopicCharacters((topics) => ({ ...topics, [character.id]: true }));
    setHistoryOpen(false);
    setChatError('');
    failedChat.current = null;
    if (petMode) setPetChat(true);
    else setView('home');
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('[aria-label="聊天消息"]')?.focus(), 80);
  }
  function openCreate() {
    let draft = parseCreationDraft(null);
    try {
      draft = parseCreationDraft(localStorage.getItem(creationDraftKey));
    } catch {
      /* Storage can be unavailable. */
    }
    setNewName(draft.name);
    setNewWork(draft.work);
    setNewNotes(draft.notes);
    setNewMode(draft.mode);
    setNewUrls(draft.urls);
    setCreationStage('');
    setJobError('');
    setCreateOpen(true);
  }
  async function useMatchingPack(pack: CharacterPack) {
    setJobBusy(true);
    setJobError('');
    try {
      await save((state) => activateCharacterPack(state, pack));
      setCreateOpen(false);
      setView('home');
      pending.current = {};
      try {
        localStorage.removeItem(creationDraftKey);
      } catch {
        /* Selection has been saved. */
      }
      setToast('已使用匹配的人物与素材，保留原有设定和聊天记录。');
    } catch (error) {
      setJobError(errorText(error));
    } finally {
      setJobBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (creationGuard.current || jobBusy) return;
    creationGuard.current = true;
    setJobBusy(true);
    setJobError('');
    setCreationStage(manualCreate ? '正在保存角色档案' : '正在整理角色资料');
    try {
      let result = pending.current.character || existingCharacter(stateRef.current, newName, newWork);
      if (!result) {
        result = manualCreate
          ? createLocalCharacter({
              id: id(),
              name: newName,
              work: newWork,
              notes: newNotes,
              urls: newUrls,
              createdAt: now(),
            })
          : await bridge.research({
              name: newName,
              work: newWork,
              notes: newNotes,
              mode: newMode as 'draft' | 'links' | 'search',
              urls:
                newMode === 'links'
                  ? newUrls
                      .split('\n')
                      .map((url) => url.trim())
                      .filter(Boolean)
                  : undefined,
            });
        pending.current.character = result;
      }
      const savedCharacter = result;
      if (!stateRef.current.characters.some((c) => c.id === result.id))
        await save((s) => ({
          ...s,
          characters: [...s.characters, savedCharacter],
          activeCharacterId: savedCharacter.id,
          activeSkinId: '',
          messages: { ...s.messages, [savedCharacter.id]: [] },
        }));
      else
        await save((s) => ({
          ...s,
          activeCharacterId: savedCharacter.id,
          activeSkinId: selectedCharacterSkin(s, savedCharacter)?.id || '',
        }));
      let imageNotice = '角色已保存。接下来选择原图，或导入外观与动作。';
      if (
        collectOnCreate &&
        !savedCharacter.visualReferences?.length &&
        !savedCharacter.referenceCandidates?.length
      ) {
        setCreationStage('档案已保存 · 正在收集参考图');
        try {
          await bridge.discoverReferences(savedCharacter.id);
          imageNotice = '图片收集已完成。请核对原图后直接作为立绘，或继续导入动作素材。';
        } catch (error) {
          imageNotice = `角色已保存，图片收集暂未完成：${errorText(error)}`;
        }
      }
      setCreateOpen(false);
      setView('characters');
      setSetupCharacterId(savedCharacter.id);
      pending.current = {};
      try {
        localStorage.removeItem(creationDraftKey);
      } catch {
        /* Profile is already saved. */
      }
      setToast(imageNotice);
    } catch (e) {
      setJobError(`${pending.current.character ? '角色档案已暂存，重试不会重复检索。' : ''}${errorText(e)}`);
    } finally {
      creationGuard.current = false;
      setJobBusy(false);
      setProgress(null);
      setCreationStage('');
    }
  }
  async function updateReferences(references: VisualReference[], characterId = character.id) {
    await save((s) => {
      const current = s.characters.find((c) => c.id === characterId)!;
      const previous = current.visualReferences || [];
      const changed =
        previous.length !== references.length ||
        references.some((r, i) => r.id !== previous[i]?.id || r.image !== previous[i]?.image);
      return {
        ...s,
        characters: s.characters.map((c) =>
          c.id === characterId
            ? {
                ...c,
                visualReferences: references,
                referenceCandidates: c.referenceCandidates?.filter(
                  (candidate) => !references.some((ref) => ref.id === candidate.id),
                ),
              }
            : c,
        ),
        skins: changed
          ? s.skins.map((item) =>
              item.characterId === characterId && item.review
                ? { ...item, review: { ...item.review, status: 'pending' as const, reviewedAt: undefined } }
                : item,
            )
          : s.skins,
      };
    });
  }
  function deleteSkin(item: Skin) {
    if (jobBusy || chatBusy) return;
    const others = state.skins.filter(
      (s) => s.id !== item.id && s.characterId === item.characterId && usableCharacterSkin(s, character),
    );
    const note = others.length ? '' : '\n这是该角色最后一套可用外观，删除后桌宠会先收起。';
    const source = item.generation ? '\n制作任务里的原始素材仍保留，之后可以在制作页重新整理出来。' : '';
    if (!window.confirm(`删除外观「${item.name}」？${note}${source}`)) return;
    commit((s) => {
      const active = s.activeSkinId === item.id;
      const next = active ? others[0]?.id || '' : s.activeSkinId;
      const preferred = { ...s.preferredSkins };
      if (preferred[item.characterId] === item.id) {
        if (others[0]) preferred[item.characterId] = others[0].id;
        else delete preferred[item.characterId];
      }
      return {
        ...s,
        skins: s.skins.filter((s2) => s2.id !== item.id),
        activeSkinId: next,
        preferredSkins: preferred,
        settings: item.builtin
          ? { ...s.settings, removedBuiltins: [...new Set([...(s.settings.removedBuiltins || []), item.id])] }
          : s.settings,
      };
    });
    setToast(`已删除外观「${item.name}」。`);
  }
  function chooseSkin(item: Skin) {
    if (!usableCharacterSkin(item, character)) {
      setGenerateOpen(true);
      return;
    }
    commit((s) => ({
      ...s,
      activeSkinId: item.id,
      preferredSkins: { ...s.preferredSkins, [item.characterId]: item.id },
    }));
  }
  const reviewLabel = (item: Skin) =>
    spriteAnimation(item)
      ? item.generation || item.builtin
        ? '原图衍生 · 逐帧动画'
        : '已导入 · 逐帧动画'
      : item.builtin === 'cyrene-original-v1'
        ? '原作画风重绘 · 待核对'
        : item.builtin === 'cyrene-powerpuff-v1'
          ? '卡通画风重绘 · 待核对'
          : item.builtin?.endsWith('-v5') || item.builtin?.endsWith('-v4')
            ? '原图衍生 · 待核对'
            : item.builtin === 'cyrene-reference-v3'
              ? '原图重制 · 待核对'
              : item.builtin
                ? '早期素材 · 未核对'
                : item.generation
                  ? item.review?.status === 'approved' && displaySkins.some((s) => s.id === item.id)
                    ? '基准已确认'
                    : item.review?.status === 'rejected'
                      ? '需要重做'
                      : '待对照原图'
                  : '';
  async function importAsset(kind: 'image' | 'sprite' | 'live2d' | 'vrm') {
    setJobBusy(true);
    try {
      const result =
        kind === 'sprite'
          ? await bridge.importSprite(character.id, skin?.style || 'anime')
          : kind === 'image'
            ? await bridge.importImage(character.id, skin?.style || 'anime')
            : await bridge.importModel(character.id, kind);
      if (result) {
        await save((s) => ({ ...s, skins: [...s.skins, result], activeSkinId: result.id }));
        setToast(`${engineName(result)} 已导入。`);
      }
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setJobBusy(false);
    }
  }
  async function refreshProfile() {
    setUpdateError('');
    setJobBusy(true);
    setProgress(null);
    try {
      const targetId = updateResult.current?.characterId || character.id;
      const result =
        updateResult.current?.character ||
        (await bridge.research({
          characterId: targetId,
          name: character.name,
          work: character.work,
          notes: character.summary,
          mode: updateMode,
          urls:
            updateMode === 'links'
              ? updateUrls
                  .split('\n')
                  .map((url) => url.trim())
                  .filter(Boolean)
              : undefined,
        }));
      updateResult.current = { characterId: targetId, character: result };
      await save((s) => ({
        ...s,
        characters: s.characters.map((c) =>
          c.id === targetId
            ? {
                ...result,
                id: c.id,
                createdAt: c.createdAt,
                theme: c.theme,
                accent: c.accent,
                visualReferences: c.visualReferences,
                roleplay: c.roleplay,
                behavior: c.behavior,
              }
            : c,
        ),
      }));
      setToast(updateMode === 'saved' ? '已保存资料已整理，来源未联网更新。' : '资料已更新，请核对来源。');
      setSourceUpdateOpen(false);
      updateResult.current = null;
    } catch (e) {
      setUpdateError(`${updateResult.current ? '结果已暂存，重试只保存本机档案。' : ''}${errorText(e)}`);
    } finally {
      setJobBusy(false);
      setProgress(null);
    }
  }
  async function importCharacter(shared?: { character: Character; skins: Skin[] }) {
    try {
      const pack = shared || (await bridge.importCharacter());
      if (!pack) return;
      const char = { ...pack.character, id: id() };
      const skinIds = new Map(pack.skins.map((a) => [a.id, id()]));
      const imported = pack.skins.map((a) => ({
        ...a,
        id: skinIds.get(a.id)!,
        characterId: char.id,
        ...(a.generation
          ? {
              generation: {
                ...a.generation,
                parentSkinId: a.generation.parentSkinId ? skinIds.get(a.generation.parentSkinId) : undefined,
              },
            }
          : {}),
      }));
      await save((s) => ({
        ...s,
        characters: [...s.characters, char],
        skins: [...s.skins, ...imported],
        activeCharacterId: char.id,
        activeSkinId: imported[0]?.id || '',
        messages: { ...s.messages, [char.id]: [] },
      }));
      setToast('角色包已导入。');
    } catch (e) {
      setToast(errorText(e));
    }
  }
  const notifyError = (job: Promise<unknown>) => {
    void job.catch((e) => setToast(errorText(e)));
  };
  // How she feels shows when nothing else does: a frown when cross or very lonely, a smile when
  // happy, and a little mark above her head.
  const mood = moodOf(),
    feeling = moodName(mood);
  const restingFace = feeling === 'lonely' && mood.lonely < 75 ? 'neutral' : moodFace(feeling);
  const shownEmotion: Emotion =
    emotion !== 'neutral' || talking || resting || !supportsEmotion(skin, restingFace)
      ? emotion
      : restingFace;
  const mark = resting || !skin ? '' : flash && flash.until > Date.now() ? flash.mark : moodMark(feeling);
  const feelingLabel = { angry: '有点生气', lonely: '有点寂寞', happy: '心情很好', calm: '' }[feeling];
  const avatar = (
    <>
      <AvatarStage
        skin={skin}
        emotion={shownEmotion}
        action={action}
        actionKey={actionKey}
        talking={talking || previewSpeech}
        audioDriven={Boolean(audioRef.current)}
        motionEnabled={motionEnabled}
        mouth={mouth}
        tracking={tracking}
        zoom={view === 'desktop' || view === 'home' ? 1 : zoom}
        compact={petMode}
        glance={petMode ? desktop.glance : null}
        snap={snap}
      />
      {mark && (
        <span
          className={`mood-mark ${flash && flash.until > Date.now() ? 'flash' : feeling}`}
          aria-label={feelingLabel || '表情'}
          role="img"
        >
          {mark}
        </span>
      )}
    </>
  );
  const assetThumb = (item?: Skin) =>
    skinImage(item) ? <SkinArtwork skin={item} /> : item?.kind === 'live2d' ? <Layers3 /> : <Box />;
  const portrait = (c: Character, item?: Skin) =>
    item ? (
      assetThumb(item)
    ) : (
      <span className="avatar-initial" aria-hidden="true">
        {Array.from(c.name)[0] || '?'}
      </span>
    );
  const progressCard = jobBusy && (
    <div className="progress-card" role="status">
      <LoaderCircle className="spin" size={18} />
      <div>
        <strong>{progress?.stage || '正在处理'}</strong>
        <p>{progress?.detail || '完成后会保存在本机。'}</p>
        {progress?.total && <progress value={progress.completed || 0} max={progress.total} />}
      </div>
    </div>
  );
  const conversationPanel = (mode: ConversationMode) => (
    <ConversationPanel
      mode={mode}
      character={character}
      thumbnail={assetThumb(skin)}
      messages={messages}
      message={message}
      localChat={localChat}
      connected={connected}
      chatBusy={chatBusy}
      sharedChatStatus={sharedChatStatus}
      chatError={chatError}
      chatStopping={chatStopping}
      chatExpanded={chatExpanded}
      audioBusy={audioBusy}
      talking={talking}
      speaking={talking && Boolean(audioRef.current)}
      newTopicPending={newTopicPending}
      replyNeedsSave={completedReplies.current.has(character.id)}
      historyRef={historyRef}
      actionNames={actionNames}
      switchChatMode={switchChatMode}
      sendChat={sendChat}
      copyMessage={copyMessage}
      speak={speak}
      stopChat={stopChat}
      stopAudio={stopAudio}
      beginTopic={beginTopic}
      onDraft={(value) => setMessageDrafts((drafts) => ({ ...drafts, [character.id]: value }))}
      onCancelTopic={() => setNewTopicCharacters((topics) => ({ ...topics, [character.id]: false }))}
      onOpenHistory={() => {
        setHistoryQuery('');
        setHistoryOpen(true);
      }}
      onOpenSettings={() => (petMode ? notifyError(bridge.openWorkshop()) : setView('settings'))}
      onToggleExpanded={() => setChatExpanded(!chatExpanded)}
    />
  );
  if (loadError)
    return (
      <div className="startup-screen">
        <CircleHelp />
        <h1>无法读取工作区</h1>
        <p>{loadError}</p>
        {recoveryError && (
          <p className="inline-error" role="alert">
            {recoveryError}
          </p>
        )}
        <button className="button primary" disabled={recoveryBusy} onClick={() => location.reload()}>
          重新读取
        </button>
        {hasPreviousState && (
          <>
            <p>可恢复上一份有效存档。当前无法读取的文件会保留，供之后检查。</p>
            <button
              className="button secondary"
              aria-label="恢复上一份有效存档"
              disabled={recoveryBusy}
              onClick={async () => {
                setRecoveryBusy(true);
                setRecoveryError('');
                try {
                  const recovered = await bridge.restorePreviousState();
                  const restored = migrateState(recovered.state);
                  stateRef.current = restored;
                  setState(restored);
                  setKeys(recovered.keys);
                  setSharedChatStatus({ busy: false });
                  setReady(true);
                  setLoadError('');
                  setToast('已恢复上一份有效存档，原文件已保留。');
                } catch (error) {
                  setRecoveryError(errorText(error));
                } finally {
                  setRecoveryBusy(false);
                }
              }}
            >
              {recoveryBusy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
              恢复上一份有效存档
            </button>
          </>
        )}
        {isDesktop && (
          <button
            className="button secondary"
            aria-label="打开数据文件夹"
            disabled={recoveryBusy}
            onClick={() => {
              setRecoveryError('');
              void bridge.openDataDirectory().catch((error) => setRecoveryError(errorText(error)));
            }}
          >
            打开数据文件夹
          </button>
        )}
      </div>
    );
  if (!ready)
    return (
      <div className="startup-screen">
        <Flower2 className="spin" />
        <p>正在打开你的角色空间…</p>
      </div>
    );
  if (petMode) {
    // Her speech goes in the band above her and the controls in the band below. Near the top of
    // the screen the band above is off screen, so her speech moves below her; near the bottom the
    // controls move above her.
    const speechBelow = petRoom.above < 64 && petRoom.below >= petRoom.above;
    // The controls always open below her (that band never leaves the screen).
    const controlsAbove = false;
    const speechText = interactionLine || lastReply?.content || '';
    // Near a screen edge her speech and the controls can share one band.
    const speech = moment ? (
      // A shared moment is a small bubble above her; she acts it out below it.
      <div className="pet-moment-bubble">
        <Moment
          id={moment}
          name={character.name}
          reducedMotion={!motionEnabled}
          onDone={finishMoment}
          onClose={closeMoment}
          onAct={actInMoment}
          compact
        />
      </div>
    ) : desktop.phase === 'inviting' ? (
      <div className="pet-invite" role="status">
        <p>{desktop.status}</p>
        <button onClick={desktop.start}>好呀，去藏吧</button>
        <button onClick={desktop.decline}>等会儿</button>
      </div>
    ) : invitation && !moment && !petChat ? (
      <div className="pet-invite" role="status">
        <p>{offerText(invitation).invite}</p>
        <button onClick={() => acceptInvitation(invitation)}>
          {isMoment(invitation) ? '好呀，一起' : invitation === 'chat' ? '好呀，聊聊' : '摸摸头'}
        </button>
        <button onClick={declineInvitation}>等会儿</button>
      </div>
    ) : toast ? (
      <div className="pet-toast" role="status">
        {toast}
      </div>
    ) : !petChat && !moment && interactionBusy ? (
      <div className="pet-speech thinking" role="status" aria-label={`${character.name}正在想怎么回应你`}>
        <i />
        <i />
        <i />
      </div>
    ) : !petChat && !moment && !bubbleHidden && speechText ? (
      <div
        className="pet-speech"
        role="status"
        title="点一下回复"
        onClick={(event) => {
          if (!(event.target instanceof Element && event.target.closest('button'))) openPetComposer();
        }}
      >
        <p>{speechText}</p>
        <button className="pet-speech-close" aria-label="收起回复气泡" onClick={() => setBubbleHidden(true)}>
          <X size={12} />
        </button>
      </div>
    ) : null;
    const controls = petChat ? null : petComposer ? (
      <div className="pet-composer-area">
        <div className="pet-composer" role="group" aria-label={`和${character.name}说话`}>
          <button aria-label="打开桌宠聊天" title="对话记录" onClick={() => setPetChat(true)}>
            <History size={15} />
          </button>
          <textarea
            ref={composerRef}
            rows={1}
            maxLength={4000}
            aria-label="聊天消息"
            placeholder={`和${character.name}说点什么…`}
            value={message}
            onChange={(event) =>
              setMessageDrafts((drafts) => ({ ...drafts, [character.id]: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void sendChat();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setPetComposer(false);
              }
            }}
          />
          {chatBusy ? (
            <button aria-label="停止等待回复" title="停止等待" disabled={chatStopping} onClick={stopChat}>
              <Square size={13} />
            </button>
          ) : (
            <button
              className="send"
              aria-label="发送消息"
              title="发送（Enter）"
              disabled={!message.trim() || interactionBusy}
              onClick={() => void sendChat()}
            >
              <Send size={15} />
            </button>
          )}
          <button aria-label="收起输入框" title="收起（Esc）" onClick={() => setPetComposer(false)}>
            <X size={14} />
          </button>
        </div>
        {chatError && (
          <p className="pet-composer-error" role="alert">
            {chatError}
          </p>
        )}
      </div>
    ) : (
      // Hidden until the pointer is over it; a faint handle shows where it is while the pointer is
      // on her.
      <div className="pet-toolbar-zone">
        <span className="pet-toolbar-hint" aria-hidden="true" />
        <div className="pet-toolbar" role="toolbar" aria-label="桌宠工具栏">
          <div className="pet-toolbar-row">
            <button aria-label="和角色说话" title={`和${character.name}说话`} onClick={openPetComposer}>
              <MessageCircle size={16} />
            </button>
            {desktop.active ? (
              <button aria-label="结束桌面活动" title="结束桌面活动" onClick={() => desktop.stop()}>
                <Square size={14} />
              </button>
            ) : (
              <button
                aria-label="探索桌面"
                title="探索桌面"
                disabled={interactionBusy || talking}
                onClick={() => void desktop.explore()}
              >
                <Compass size={16} />
              </button>
            )}
            <button
              aria-label="摸摸头"
              title={`摸摸${character.name}的头（也可以用指针在她头上来回蹭）`}
              onClick={() => (resting ? wakeUp() : touchCharacter('headpat'))}
            >
              <HandHeart size={16} />
            </button>
            <button aria-label="一起玩" title="一起玩" onClick={() => openMoment('guess')}>
              <Heart size={16} />
            </button>
            <button
              aria-label={resting ? '唤醒角色' : '让角色休息'}
              title={resting ? '唤醒' : '休息'}
              onClick={() => interact(resting ? 'wake' : 'rest')}
            >
              {resting ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              aria-label="打开工坊"
              title="打开 Demiurge"
              onClick={() => notifyError(bridge.openWorkshop())}
            >
              <Flower2 size={16} />
            </button>
            <button aria-label="收起桌宠" title="收起桌宠" onClick={() => notifyError(bridge.closePet())}>
              <X size={16} />
            </button>
          </div>
          {activities.some(({ id }) => supportsAction(skin, id)) && (
            <div className="pet-toolbar-row" role="group" aria-label="活动">
              {activities
                .filter(({ id }) => supportsAction(skin, id))
                .map(({ id }) => {
                  const Icon = activityIcons[id];
                  return (
                    <button
                      key={id}
                      aria-label={`桌宠${actionNames[id]}`}
                      aria-pressed={action === id}
                      disabled={interactionBusy || talking}
                      title={`${actionNames[id]}，约一分钟`}
                      onClick={() => move(id, 'neutral')}
                    >
                      <Icon size={16} />
                    </button>
                  );
                })}
              {isActivity(action) && (
                <button aria-label="停止桌宠活动" title="停止活动" onClick={() => move('idle', 'neutral')}>
                  <Square size={14} />
                </button>
              )}
            </div>
          )}
          <label className="pet-size">
            <span>大小</span>
            <input
              type="range"
              min="0.45"
              max="2.6"
              step="0.01"
              value={petScaleRef.current}
              aria-label="桌宠大小"
              onChange={(event) => resizePet(Number(event.target.value), false)}
            />
            <output>{Math.round(petScaleRef.current * 100)}%</output>
          </label>
        </div>
      </div>
    );
    return (
      <div
        className={`desktop-pet-shell ${speechBelow ? 'speech-below' : ''} ${controlsAbove ? 'controls-above' : ''} ${figureHover ? 'figure-hover' : ''}`}
        data-status={desktop.status}
        style={
          {
            ...themeVars(character),
            '--band-top': `${petBands.top}px`,
            '--band-bottom': `${petBands.bottom}px`,
            '--band-side': `${petBands.side}px`,
            '--room-above': `${petRoom.above}px`,
            '--room-below': `${petRoom.below}px`,
          } as CSSProperties
        }
      >
        <div
          className={`pet-band above ${controlsAbove && !speechBelow && speech && controls ? 'shared' : ''}`}
        >
          {controlsAbove && controls}
          {!speechBelow && speech}
        </div>
        <div
          className={`pet-band below ${speechBelow && !controlsAbove && speech && controls ? 'shared' : ''}`}
        >
          {speechBelow && speech}
          {!controlsAbove && controls}
        </div>
        {petChat && <div className="pet-chat-panel">{conversationPanel('pet')}</div>}
        <div
          className="pet-draggable"
          style={
            desktop.mask
              ? {
                  clipPath: `path(evenodd, "M 0 0 H ${innerWidth} V ${innerHeight} H 0 Z M ${desktop.mask.x - 12} ${desktop.mask.y - (document.querySelector('.pet-draggable')?.getBoundingClientRect().top || 0)} h ${desktop.mask.width} v ${desktop.mask.height} h ${-desktop.mask.width} Z")`,
                }
              : undefined
          }
          role="button"
          tabIndex={0}
          aria-label={`和${character.name}互动，按 Enter 轻触，拖动可移动桌宠`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              interact(resting ? 'wake' : 'touch');
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const hit = hitCharacter(e.currentTarget, e.clientX, e.clientY);
            if (!hit) return;
            desktop.stop(true);
            drag.current = { x: e.screenX, y: e.screenY, moved: false, hit };
            // She swings from wherever she was grabbed.
            const body = bodyRef.current?.getBoundingClientRect();
            if (body) swing.current.origin = `${e.clientX - body.left}px ${e.clientY - body.top}px`;
            swing.current.at = performance.now();
            swing.current.vx = 0;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const x = e.screenX - drag.current.x,
              y = e.screenY - drag.current.y;
            if (Math.abs(x) + Math.abs(y) > 2) {
              if (!drag.current.moved) {
                drag.current.moved = true;
                // Picked up in the middle of something, or out of her sleep.
                if (action === 'sleep' && Date.now() - asleepSince.current > 60000) say(feelNow('woken'));
                else if (isActivity(action)) say(feelNow('interrupted'));
                desktop.lift();
                swing.current.lifted = true;
                bodyRef.current?.classList.add('lifted');
                startSwing();
              }
              if (supportsAction(skin, 'drag')) setAction('drag');
              const now = performance.now(),
                dt = Math.max(8, now - swing.current.at) / 1000;
              swing.current.vx = swing.current.vx * 0.65 + (x / dt) * 0.35;
              swing.current.at = now;
              bridge.movePet({ x, y });
              drag.current.x = e.screenX;
              drag.current.y = e.screenY;
            }
          }}
          onPointerUp={(event) => {
            if (!drag.current) return;
            const moved = drag.current.moved;
            if (moved) {
              swing.current.lifted = false;
              bodyRef.current?.classList.remove('lifted');
              // Let go: she falls onto whatever is below, then reacts to the ride.
              dropping.current = true;
              void desktop.drop().then(() => {
                if (dropping.current) {
                  dropping.current = false;
                  interact('drag');
                }
              });
            } else if (resting) wakeUp();
            else touchCharacter(drag.current.hit);
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            if (action === 'drag') setAction('idle');
            drag.current = null;
          }}
          onPointerCancel={() => {
            if (action === 'drag') setAction('idle');
            if (drag.current?.moved) {
              swing.current.lifted = false;
              bodyRef.current?.classList.remove('lifted');
              void desktop.drop();
            }
            drag.current = null;
          }}
        >
          <div className="pet-landing" ref={landRef}>
            <div
              className={`pet-body ${desktop.airborne ? 'airborne' : ''} ${vanished ? 'vanished' : ''}`}
              ref={bodyRef}
            >
              {avatar}
            </div>
          </div>
          {touchFeedback && (
            <div
              key={touchFeedback.key}
              className={`touch-feedback ${touchFeedback.kind}`}
              aria-hidden="true"
            >
              <i>{touchFeedback.kind === 'headpat' ? '♡' : '✧'}</i>
              <i>✧</i>
            </div>
          )}
        </div>
        {sizeNote && (
          <span className="pet-size-note" role="status">
            {sizeNote}
          </span>
        )}
      </div>
    );
  }
  const homeView = view === 'home' || view === 'chat';
  const settingsView = view === 'settings' || view === 'desktop';
  const quickReplies = localChat
    ? [
        { label: '打个招呼', text: '你好' },
        { label: '给我一点鼓励', text: '给我一点鼓励吧' },
        { label: '晚安', text: '晚安' },
      ]
    : [
        { label: '聊聊今天', text: '今天过得怎么样？' },
        { label: '给我一点鼓励', text: '给我一点鼓励吧' },
      ];
  const historyDrawer = chatExpanded ? (
    <aside className="history-drawer" aria-label="对话记录">
      <header>
        <div>
          <strong>对话记录</strong>
          <small>{messages.length} 条</small>
        </div>
        <button
          className="icon-button"
          aria-label="查找与导出对话"
          title="查找与导出对话"
          onClick={() => {
            setHistoryQuery('');
            setHistoryOpen(true);
          }}
        >
          <Search size={17} />
        </button>
        <button className="icon-button" aria-label="关闭对话记录" onClick={() => setChatExpanded(false)}>
          <X size={17} />
        </button>
      </header>
      {conversationPanel('history')}
    </aside>
  ) : undefined;
  return (
    <div className={`studio room-app theme-${theme.id}`} style={themeVars(character)}>
      <CharacterRail
        characters={state.characters}
        activeId={character.id}
        settingsActive={settingsView}
        thumbnail={(c) => portrait(c, c.id === character.id ? skin : selectedCharacterSkin(state, c))}
        onSelect={selectCharacter}
        onCreate={openCreate}
        onImport={importCharacter}
        onCommunity={() => setCommunityOpen(true)}
        onHome={() => setView('home')}
        onSettings={() => setView('settings')}
      />
      <main className={`main-content room-main ${homeView ? 'home-content' : ''}`} data-feature={view}>
        {homeView && (
          <CompanionScene
            character={character}
            skin={skin}
            skins={displaySkins}
            avatar={avatar}
            zoom={stageZoom ?? state.settings.stageZoom ?? 1}
            onZoom={(value) => {
              const next = Math.round(Math.max(0.6, Math.min(1.6, value)) * 100) / 100;
              setStageZoom(next);
              clearTimeout(stageZoomSave.current);
              stageZoomSave.current = setTimeout(() => {
                commit((s) => ({ ...s, settings: { ...s.settings, stageZoom: next } }));
                setStageZoom(null);
              }, 600);
            }}
            thumbnail={assetThumb}
            composer={conversationPanel('room')}
            setup={
              <CharacterReadiness
                character={character}
                skins={allSkins}
                onSetup={() => setSetupCharacterId(character.id)}
                onVoice={openProfile}
                onInteraction={() => setPacksOpen(true)}
                onAnimation={() => setArtWorkflowOpen(true)}
              />
            }
            drawer={historyDrawer}
            quickReplies={localChat || messages.length < 2 ? quickReplies : []}
            interactionBusy={interactionBusy}
            talking={talking}
            resting={resting}
            touchFeedback={touchFeedback}
            bubbleHidden={bubbleHidden}
            interactionLine={interactionLine}
            lastReply={lastReply}
            audioBusy={audioBusy}
            sceneSettingsOpen={sceneSettingsOpen}
            tracking={tracking}
            motionEnabled={motionEnabled}
            presence={
              (lifeRef.current.activity === 'sleep'
                ? '在休息'
                : activities.find((item) => item.id === lifeRef.current.activity)?.doing ||
                  `${actionNames[action]} · ${emotions.find((e) => e.id === emotion)?.name}`) +
              (feelingLabel ? ` · ${feelingLabel}` : '')
            }
            invitation={invitation ? offerText(invitation).invite : ''}
            onAcceptInvitation={() => invitation && acceptInvitation(invitation)}
            onDeclineInvitation={declineInvitation}
            onOpenMoment={openMoment}
            momentPanel={
              moment ? (
                <Moment
                  id={moment}
                  name={character.name}
                  reducedMotion={!motionEnabled || matchMedia('(prefers-reduced-motion: reduce)').matches}
                  onDone={finishMoment}
                  onClose={closeMoment}
                  onAct={actInMoment}
                />
              ) : undefined
            }
            touchCharacter={touchCharacter}
            interact={interact}
            copyMessage={copyMessage}
            speak={speak}
            sendQuick={(text) => void sendChat(text)}
            chooseSkin={chooseSkin}
            onHideBubble={() => {
              setBubbleHidden(true);
              setInteractionLine('');
            }}
            onOpenConversation={() => setChatExpanded(true)}
            onOpenStudio={() => setView('characters')}
            onOpenAppearance={() => setView('wardrobe')}
            onOpenDesktop={() => notifyError(bridge.openPet())}
            onToggleSettings={() => setSceneSettingsOpen(!sceneSettingsOpen)}
            onToggleTracking={() => updatePlayback('trackingEnabled', !tracking)}
          />
        )}
        {isStudioTab(view) && (
          <StudioFrame
            name={character.name}
            work={character.work}
            thumbnail={portrait(character, skin)}
            tab={view}
            onTab={setView}
            onBack={() => setView('home')}
          >
            {view === 'wardrobe' && (
              <>
                <button
                  className="production-entry"
                  aria-label="自动制作多画风桌宠"
                  onClick={() => setPetProductionOpen(true)}
                >
                  <span className="production-icon">
                    <WandSparkles size={26} />
                  </span>
                  <span>
                    <small>CREATE A COMPANION · 自动制作</small>
                    <strong>从一张角色原图，开始制作。</strong>
                    <p>选画风 → 确认角色图 → 制作动作 → 核对并启用</p>
                  </span>
                  <span className="production-entry-action">
                    开始制作
                    <ArrowUpRight size={17} />
                  </span>
                </button>
                <details className="creation-tools">
                  <summary>
                    <span>
                      <Layers3 size={18} /> 已有素材，或需要其他制作方式？
                    </span>
                    <span>
                      角色包 · 导入 · 3D <ChevronRight size={16} />
                    </span>
                  </summary>
                  <div className="engine-grid">
                    <button aria-label="使用预制角色包" onClick={() => setPacksOpen(true)}>
                      <FolderHeart />
                      <strong>角色包与本地互动</strong>
                      <span>预制外观 / 真实动作 / 无图像 API</span>
                      <ArrowUpRight size={17} />
                    </button>
                    <button aria-label="画风与素材制作" onClick={() => setArtWorkflowOpen(true)}>
                      <Palette />
                      <strong>画风与素材制作</strong>
                      <span>{styles.length} 种制作说明 / 现成素材 / 动作预览</span>
                      <ArrowUpRight size={17} />
                    </button>
                    <button aria-label="制作 3D 模型" onClick={() => setModelStudioOpen(true)}>
                      <Box />
                      <strong>制作 3D 模型</strong>
                      <span>主参考原图 / 图生模型 / 骨骼绑定</span>
                      <ArrowUpRight size={17} />
                    </button>
                    <button
                      aria-label="制作立绘与像素动画"
                      onClick={() => {
                        pending.current = {};
                        setJobError('');
                        setGenerateOpen(true);
                      }}
                    >
                      <WandSparkles />
                      <strong>制作立绘与像素动画</strong>
                      <span>原图编辑 / 可选像素绘图 / 候选核对</span>
                      <ArrowUpRight size={17} />
                    </button>
                    <p className="tool-group-title">导入已有素材</p>
                    <button disabled={jobBusy} onClick={() => importAsset('live2d')}>
                      <Layers3 />
                      <strong>导入 Live2D</strong>
                      <span>model3.json / ZIP 模型包</span>
                      <Upload size={17} />
                    </button>
                    <button disabled={jobBusy} onClick={() => importAsset('vrm')}>
                      <Box />
                      <strong>导入 VRM 3D</strong>
                      <span>VRM 0.x / 1.0</span>
                      <Upload size={17} />
                    </button>
                    <button disabled={jobBusy} onClick={() => importAsset('sprite')}>
                      <Film />
                      <strong>导入逐帧动画</strong>
                      <span>Aseprite JSON + PNG / Demiurge 动画包</span>
                      <Upload size={17} />
                    </button>
                  </div>
                </details>
                <section className="saved-appearances" aria-label="已保存的角色外观">
                  <div className="section-heading">
                    <div>
                      <h2>
                        我的外观 <span className="collection-count">{skins.length}</span>
                      </h2>
                      <p>点击切换当前角色的外观。</p>
                    </div>
                    <button className="text-button" onClick={() => importAsset('image')}>
                      <ImagePlus size={15} />
                      导入现有立绘
                    </button>
                  </div>
                  {allSkins.some(earlierArt) && (
                    <button className="earlier-art-toggle" onClick={() => setShowEarlierArt(!showEarlierArt)}>
                      {showEarlierArt ? '收起早期外观' : '查看早期外观'}
                    </button>
                  )}
                  <div className="wardrobe-grid">
                    {skins.map((item) => (
                      <div className="wardrobe-item" key={item.id}>
                        <button
                          className={`wardrobe-card ${skin?.id === item.id ? 'selected' : ''}`}
                          aria-pressed={skin?.id === item.id}
                          onClick={() => chooseSkin(item)}
                        >
                          <div>
                            {assetThumb(item)}
                            <span>{engineName(item)}</span>
                          </div>
                          <strong>{item.name}</strong>
                          <small>
                            {styleName(item.style)} · {reviewLabel(item) || '导入外观'}
                            {skin?.id === item.id && <Check size={14} />}
                          </small>
                        </button>
                        <button
                          className="wardrobe-delete"
                          aria-label={`删除外观：${item.name}`}
                          title="删除这套外观"
                          disabled={jobBusy || chatBusy}
                          onClick={() => deleteSkin(item)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
                <details className="motion-workbench">
                  <summary>
                    <span>
                      <Film size={18} /> 当前外观的表情与动作
                    </span>
                    <span>
                      {skin?.name || '先选择一套外观'} <ChevronRight size={16} />
                    </span>
                  </summary>
                  <div className="workbench">
                    <div className="workbench-stage">
                      {avatar}
                      <span className="engine-tag">{engineName(skin)}</span>
                    </div>
                    <div className="workbench-controls">
                      <h3>表现调节</h3>
                      <label>
                        角色缩放 <span>{Math.round(zoom * 100)}%</span>
                        <input
                          type="range"
                          min="0.65"
                          max="1.4"
                          step=".05"
                          value={zoom}
                          onChange={(e) => setZoom(Number(e.target.value))}
                        />
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          disabled={skin?.kind !== 'live2d' && skin?.kind !== 'vrm'}
                          checked={tracking}
                          onChange={(e) => updatePlayback('trackingEnabled', e.target.checked)}
                        />
                        视线跟随光标
                      </label>
                      <h4>表情</h4>
                      {skin &&
                        (spriteAnimation(skin) ||
                          skin.kind === 'live2d' ||
                          skin.kind === 'vrm' ||
                          skin.kind === 'glb') && (
                          <div className="motion-settings">
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={motionEnabled}
                                onChange={(e) => updatePlayback('motionEnabled', e.target.checked)}
                              />
                              {spriteAnimation(skin) ? '播放逐帧动画' : '播放角色动作'}
                            </label>
                            <p>
                              {spriteAnimation(skin)
                                ? animationDescription(skin)
                                : '使用模型绑定与动作 · 遵循系统减少动态效果'}
                            </p>
                            {spriteAnimation(skin) && (
                              <button
                                className="button secondary full"
                                disabled={previewSpeech || !spriteAnimation(skin)?.clips.talk}
                                onClick={() => setPreviewSpeech(true)}
                              >
                                {previewSpeech ? '正在预览口型' : '预览说话口型'}
                              </button>
                            )}
                          </div>
                        )}
                      <div className="emotion-grid">
                        {emotions.map((e) => (
                          <button
                            key={e.id}
                            className={emotion === e.id ? 'selected' : ''}
                            disabled={!supportsEmotion(skin, e.id)}
                            title={!supportsEmotion(skin, e.id) ? '此外观尚未制作此表情' : undefined}
                            onClick={() => move('idle', e.id)}
                          >
                            <b>{e.mark}</b>
                            {e.name}
                          </button>
                        ))}
                      </div>
                      <h4>动作</h4>
                      <div className="action-list">
                        {Object.entries(actionNames).map(([value, title]) => (
                          <button
                            key={value}
                            disabled={!supportsAction(skin, value as PetAction)}
                            title={
                              !supportsAction(skin, value as PetAction) ? '此外观尚未制作此动作' : undefined
                            }
                            onClick={() => move(value as PetAction, value === 'sleep' ? 'sleepy' : emotion)}
                          >
                            {title}
                          </button>
                        ))}
                      </div>
                      {skin?.kind === 'live2d' && skin.model && (
                        <button
                          className="button secondary full"
                          onClick={() => {
                            setEditedModel(structuredClone(skin));
                            setModelOpen(true);
                          }}
                        >
                          <SlidersHorizontal size={15} />
                          配置动作与表情映射
                        </button>
                      )}
                      <p className="fine-print">
                        {skin?.kind === 'live2d'
                          ? '模型按自身绑定与动作文件播放。可将聊天情绪映射到已有表情。'
                          : skin?.kind === 'vrm'
                            ? '支持骨骼待机、眨眼与音频口型。实际表情取决于模型。'
                            : skin && spriteAnimation(skin)
                              ? '使用完整原画帧，按制作时序切换。招手结束回到待机；语音静音时闭嘴。未制作的动作不可用。'
                              : skin?.style === '3d'
                                ? '这是具有三维观感的 PNG 立绘。要旋转角色和驱动骨骼，请导入 VRM 模型。'
                                : '此外观保持静态。导入逐帧动画或已绑定的 Live2D / VRM 模型后，可播放相应动作。'}
                      </p>
                    </div>
                  </div>
                </details>
              </>
            )}
            {view === 'characters' && (
              <>
                <div className="profile-hero">
                  <div className="tags">
                    {character.personality.map((t, i) => (
                      <span key={i}>{t}</span>
                    ))}
                  </div>
                  <button className="button secondary" onClick={openProfile}>
                    <Pencil size={14} />
                    编辑档案
                  </button>
                </div>
                {character.knowledge && (
                  <div className="notice" role="status">
                    <BookOpen size={17} />
                    <p>
                      {character.knowledge.kind === 'draft'
                        ? '模型草稿 · 原作设定尚未核实。添加官方或 Wiki 资料链接后可更新档案。'
                        : character.knowledge.kind === 'manual'
                          ? '手动档案 · 内容来自你的设定，尚未读取原作资料。'
                          : character.knowledge.method === 'saved'
                            ? `基于已保存来源 · ${new Date(character.knowledge.collectedAt).toLocaleDateString('zh-CN')}整理，未联网更新资料。请核对摘要与未知项。`
                            : `有来源的档案 · ${character.knowledge.method === 'links' ? '资料链接' : searchProviderNames[character.knowledge.method as keyof typeof searchProviderNames]}整理，${new Date(character.knowledge.collectedAt).toLocaleDateString('zh-CN')}更新。请核对来源、摘要和未知项。`}
                    </p>
                  </div>
                )}
                <ReferencePanel
                  character={character}
                  references={character.visualReferences || []}
                  disabled={jobBusy}
                  onChange={updateReferences}
                  onUseOriginal={async () => {
                    const result = await bridge.useReferenceImage(character.id);
                    await save((s) => ({
                      ...s,
                      skins: [...s.skins.filter((skin) => skin.id !== result.id), result],
                      activeCharacterId: result.characterId,
                      activeSkinId: result.id,
                    }));
                    setToast('已使用来源原图作为静态立绘，未调用图像生成服务。');
                  }}
                />
                <div className="profile-copy">
                  <p>{character.summary}</p>
                  <div className="profile-columns">
                    <section>
                      <h3>说话的方式</h3>
                      <p>{character.speakingStyle || '尚未填写'}</p>
                    </section>
                    <section>
                      <h3>外貌与标志</h3>
                      <p>{character.appearance || '尚未填写'}</p>
                    </section>
                  </div>
                  <div className="behavior-grid">
                    {(
                      [
                        ['energy', '活跃程度'],
                        ['affection', '亲近程度'],
                        ['curiosity', '好奇程度'],
                      ] as const
                    ).map(([key, title]) => (
                      <div key={key}>
                        <span>
                          {title}
                          <b>{character.behavior[key]}%</b>
                        </span>
                        <progress max={100} value={character.behavior[key]} />
                      </div>
                    ))}
                  </div>
                  <section className="persona-summary">
                    <span>
                      <ShieldCheck size={16} /> 角色一致性
                    </span>
                    <h3>{character.roleplay?.timeline || '尚未指定剧情阶段'}</h3>
                    <p>{character.roleplay?.relationship || '相处关系尚未设定'}</p>
                    <div className="tags">
                      <span>
                        {character.roleplay?.spoilerPolicy === 'allow' ? '允许讨论剧情' : '不主动剧透'}
                      </span>
                      <span>{character.roleplay?.voiceRules.length || 0} 条语气习惯</span>
                      <span>{character.roleplay?.customFacts.length || 0} 条创作设定</span>
                    </div>
                    <div className="persona-actions">
                      <button className="text-button" onClick={openProfile}>
                        调整语气与关系 <ChevronRight size={14} />
                      </button>
                      <button
                        className="button secondary"
                        disabled={interactionBusy || jobBusy}
                        onClick={() => {
                          stopAudio();
                          setPersonaPreviewOpen(true);
                        }}
                      >
                        <MessageCircle size={14} />
                        角色试聊
                      </button>
                    </div>
                  </section>
                </div>
                <div className="toolbar">
                  <button
                    className="button primary"
                    disabled={jobBusy}
                    onClick={() => {
                      setUpdateUrls('');
                      setUpdateError('');
                      setUpdateMode('links');
                      updateResult.current = null;
                      setSourceUpdateOpen(true);
                    }}
                  >
                    {jobBusy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                    补充与更新资料
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      notifyError(
                        bridge.exportCharacter({ character, skins }).then((ok) => {
                          if (ok) setToast('已导出档案和 2D 外观。Live2D/VRM 原模型需要单独分享。');
                        }),
                      )
                    }
                  >
                    <Download size={15} />
                    导出角色包
                  </button>
                </div>
                {progressCard}
                <div className="section-heading">
                  <h2>原作台词</h2>
                  <span>{character.quotes.length} 条</span>
                </div>
                {character.quotes.length ? (
                  character.quotes.map((q, i) => (
                    <blockquote key={i}>
                      <p>“{q.text}”</p>
                      {q.sourceUrl && (
                        <button
                          className="text-button"
                          onClick={() => notifyError(bridge.openExternal(q.sourceUrl!))}
                        >
                          核对出处
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </blockquote>
                  ))
                ) : (
                  <div className="empty-note">
                    尚无可核对的台词。读取资料链接或联网搜集后，仅保留来源中实际存在的原句。
                  </div>
                )}
                <div className="section-heading spaced">
                  <h2>资料来源</h2>
                  <span>{character.sources.length} 个</span>
                </div>
                {character.sources.map((source, i) => (
                  <button
                    key={i}
                    className="source-row"
                    onClick={() => notifyError(bridge.openExternal(source.url))}
                  >
                    <BookOpen size={18} />
                    <span>
                      <strong>{source.title}</strong>
                      <small>{source.url}</small>
                    </span>
                    <ExternalLink size={14} />
                  </button>
                ))}
                {character.unknowns.length > 0 && (
                  <div className="notice spaced">
                    <CircleHelp size={17} />
                    <div>
                      <strong>仍需核对</strong>
                      {character.unknowns.map((t, i) => (
                        <p key={i}>{t}</p>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {view === 'memories' && (
              <>
                <form
                  className="memory-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!memoryDraft.trim() || draftSaving) return;
                    const draft = memoryDraft;
                    void saveDraft(
                      (s) => ({
                        ...s,
                        memories: [
                          ...s.memories,
                          { id: id(), characterId: character.id, text: draft.trim(), createdAt: now() },
                        ],
                      }),
                      () => setMemoryDraft((value) => (value === draft ? '' : value)),
                    );
                  }}
                >
                  <textarea
                    aria-label="添加相处记忆"
                    placeholder="一件希望她记住的小事…"
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    maxLength={500}
                  />
                  <button className="button primary" disabled={!memoryDraft.trim() || draftSaving}>
                    <Plus size={15} />
                    存下这段记忆
                  </button>
                </form>
                <div className="memory-toolbar">
                  <label>
                    <Search size={16} />
                    <input
                      aria-label="搜索记忆"
                      placeholder="找一段记忆…"
                      value={memoryQuery}
                      onChange={(e) => setMemoryQuery(e.target.value)}
                    />
                  </label>
                  <span>
                    {memories.filter((m) => !m.excluded).length} 段用于对话 ·{' '}
                    {memories.filter((m) => m.pinned).length} 段置顶
                  </span>
                </div>
                <div className="memory-list">
                  {filteredMemories.map((m) => (
                    <article key={m.id} className={`memory-card ${m.excluded ? 'excluded' : ''}`}>
                      <Heart size={18} />
                      <div>
                        <p>{m.text}</p>
                        <time>{new Date(m.createdAt).toLocaleDateString('zh-CN')}</time>
                        {m.pinned && <span className="memory-tag">优先记住</span>}
                        {m.excluded && <span className="memory-tag">暂不用于对话</span>}
                      </div>
                      <button
                        className={`icon-button ${m.pinned ? 'active' : ''}`}
                        aria-label={m.pinned ? '取消置顶记忆' : '置顶记忆'}
                        title={m.pinned ? '取消置顶' : '优先记住'}
                        onClick={() =>
                          commit((s) => ({
                            ...s,
                            memories: s.memories.map((x) =>
                              x.id === m.id ? { ...x, pinned: !x.pinned } : x,
                            ),
                          }))
                        }
                      >
                        <Pin size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={m.excluded ? '恢复用于对话' : '暂不用于对话'}
                        title={m.excluded ? '恢复用于对话' : '暂不用于对话'}
                        onClick={() =>
                          commit((s) => ({
                            ...s,
                            memories: s.memories.map((x) =>
                              x.id === m.id ? { ...x, excluded: !x.excluded } : x,
                            ),
                          }))
                        }
                      >
                        {m.excluded ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`编辑记忆：${m.text}`}
                        onClick={() => openMemory(m)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`删除记忆：${m.text}`}
                        onClick={() =>
                          commit((s) => ({ ...s, memories: s.memories.filter((x) => x.id !== m.id) }))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))}
                </div>
                {!memories.length && (
                  <div className="memory-empty">
                    <Orbit size={44} />
                    <h3>记忆会在相处中长出来。</h3>
                    <p>聊聊你的喜好，或亲手记下一件小事。</p>
                  </div>
                )}
                {memories.length > 0 && !filteredMemories.length && (
                  <div className="empty-note">没有找到匹配的记忆。试试另一种关键词。</div>
                )}
              </>
            )}
          </StudioFrame>
        )}
        {settingsView && (
          <SettingsFrame name={character.name} onBack={() => setView('home')}>
            <DesktopPage
              preview={avatar}
              size={state.settings.petSize || 'medium'}
              // A preset replaces any free size set by scrolling on the pet.
              onSize={(petSize) =>
                commit((s) => ({ ...s, settings: { ...s.settings, petSize, petScale: undefined } }))
              }
              scale={petScaleRef.current}
              onScale={(petScale) => commit((s) => ({ ...s, settings: { ...s.settings, petScale } }))}
              characterName={character.name}
              skinName={skin?.name}
              autonomous={state.settings.desktopLifeEnabled}
              onAutonomous={(desktopLifeEnabled) =>
                commit((s) => ({ ...s, settings: { ...s.settings, desktopLifeEnabled } }))
              }
              desktopAvailable={isDesktop}
              onOpen={() => notifyError(bridge.openPet())}
              onClose={() => notifyError(bridge.closePet())}
            />
            <SettingsPanel
              settings={state.settings}
              keys={keys}
              notify={setToast}
              onSaved={(_settings, value, manual) => {
                setKeys(value);
                if (manual) setToast('服务配置已保存。');
              }}
            />
          </SettingsFrame>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {createOpen && (
        <Modal
          title="遇见一个新角色"
          subtitle="先匹配已有角色包，也可以直接建立新档案。参考原图与素材导入无需模型 Key。"
          onClose={() => {
            if (!jobBusy) setCreateOpen(false);
          }}
          wide
        >
          <form className="modal-form" onSubmit={create}>
            <div className="creation-draft-status">
              <span>
                {creationStage || (creationDraftSaved ? '草稿已自动保留在本机' : '先填写身份，再准备外观')}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={jobBusy}
                onClick={() => {
                  pending.current = {};
                  setNewName('');
                  setNewWork('');
                  setNewNotes('');
                  setNewUrls('');
                  setNewMode('manual');
                  setJobError('');
                }}
              >
                清空草稿
              </button>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={collectOnCreate}
                disabled={jobBusy}
                onChange={(e) => setCollectOnCreate(e.target.checked)}
                aria-label="建档后自动收集参考图"
              />
              建档后自动收集参考图（不调用图像生成模型）
            </label>
            <label>
              建立方式
              <select
                aria-label="角色建档方式"
                value={newMode}
                disabled={jobBusy || Boolean(pending.current.character)}
                onChange={(event) => {
                  setNewMode(event.target.value as typeof newMode);
                  setJobError('');
                }}
              >
                <option value="manual">直接建立 · 不调用模型</option>
                <option value="draft">模型草稿 · 只需聊天 key</option>
                <option value="links">资料链接 · 从网页建立档案</option>
                <option value="search">自动联网搜集 · 使用已选搜索服务</option>
              </select>
            </label>
            <div className="form-row">
              <label>
                角色名字
                <input
                  required
                  aria-label="新角色名字"
                  maxLength={80}
                  value={newName}
                  disabled={jobBusy || Boolean(pending.current.character)}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：昔涟"
                />
              </label>
              <label>
                来自哪部作品
                <input
                  required={!manualCreate}
                  aria-label="新角色作品"
                  maxLength={120}
                  value={newWork}
                  disabled={jobBusy || Boolean(pending.current.character)}
                  onChange={(e) => setNewWork(e.target.value)}
                  placeholder="作品或世界观"
                />
              </label>
            </div>
            {newName.trim() && (
              <section className="creation-match" aria-label="新角色素材匹配">
                <strong>
                  {matchingPacks.length
                    ? `找到 ${matchingPacks.length} 套同名角色素材`
                    : existingCharacter(state, newName, newWork)
                      ? '已有这个角色的档案'
                      : '暂未找到匹配角色包'}
                </strong>
                <p>
                  {matchingPacks.length
                    ? '核对作品后可直接使用已有素材，不重复创建人物。'
                    : existingCharacter(state, newName, newWork)
                      ? '继续会打开已有档案，接着准备外观；已保存的资料与聊天保持原样。'
                      : '继续创建独立角色档案；接下来收集原图或导入现成素材。当前精选包只有昔涟，其他人物不会套用她的形象。'}
                </p>
                {matchingPacks.map((pack) => (
                  <div className="creation-match-row" key={pack.id}>
                    <span>
                      {pack.title}
                      <small>
                        {pack.skins.length} 套外观 ·{' '}
                        {pack.origin === 'builtin' ? '随项目提供' : '已保存在本机'}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={jobBusy || Boolean(pending.current.character)}
                      aria-label={`使用匹配角色包：${pack.title}`}
                      onClick={() => void useMatchingPack(pack)}
                    >
                      <FolderHeart size={15} />
                      使用已有角色
                    </button>
                  </div>
                ))}
              </section>
            )}
            <label>
              补充设定
              <textarea
                value={newNotes}
                aria-label="新角色补充设定"
                disabled={jobBusy || Boolean(pending.current.character)}
                onChange={(e) => setNewNotes(e.target.value)}
                maxLength={3000}
                placeholder="剧情阶段、角色别名；原创角色请写下性格、语气与外貌。"
              />
            </label>
            {(newMode === 'links' || manualCreate) && (
              <label>
                {manualCreate ? '参考来源（可选）' : '资料链接'}
                <textarea
                  aria-label="新角色资料链接"
                  required={!manualCreate}
                  maxLength={12000}
                  rows={4}
                  disabled={jobBusy || Boolean(pending.current.character)}
                  value={newUrls}
                  onChange={(event) => setNewUrls(event.target.value)}
                  placeholder="官方角色介绍或 Wiki 页面 HTTPS 链接，每行一个，最多 6 个。"
                />
              </label>
            )}
            <div className="notice">
              <CircleHelp size={16} />
              <p>
                {newMode === 'draft'
                  ? '模型会根据名称、作品和补充设定生成可编辑草稿。原作细节标为待核实，不生成冒充原作的台词或来源；无需搜索 key。'
                  : newMode === 'links'
                    ? '读取公开网页的实际正文，再让模型整理设定并保留来源。无需搜索 key；动态页面或登录页面可能无法读取。'
                    : newMode === 'manual'
                      ? '只填名字也能建立档案。作品名称能帮助区分同名人物；参考来源只用于收集真实图片，尚未整理的原作设定保留为空。'
                      : `当前搜索服务：${searchProviderNames[selectedSearchProvider(state.settings, keys)]}。可以在「连接与设置」中选择与测试；搜索失败不会自动替换为模型草稿。`}
                {
                  '保存后进入外观与动作设置。原图可直接作为静态桌宠；其他画风和动作需要对应素材或可选的图像服务。'
                }
                {pending.current.character && '档案已暂存，继续不会重复检索。'}
              </p>
            </div>
            {progressCard}
            {jobError && <div className="inline-error">{jobError}</div>}
            <button className="button primary full" disabled={jobBusy}>
              {jobBusy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{' '}
              {jobBusy ? '正在准备角色…' : pending.current.character ? '重试保存档案' : '创建角色'}
            </button>
          </form>
        </Modal>
      )}
      {setupCharacter && (
        <CharacterSetup
          key={setupCharacter.id}
          character={setupCharacter}
          skins={state.skins.filter((skin) => usableCharacterSkin(skin, setupCharacter))}
          activeSkinId={state.activeSkinId}
          onReferences={(references) => updateReferences(references, setupCharacter.id)}
          onUseOriginal={async () => {
            const result = await bridge.useReferenceImage(setupCharacter.id);
            await save((state) => ({
              ...state,
              skins: [...state.skins.filter((skin) => skin.id !== result.id), result],
              activeCharacterId: result.characterId,
              activeSkinId: result.id,
            }));
            setToast('已使用核对过的原图作为静态桌宠，无需图像模型。');
          }}
          onAssets={() => {
            setSetupCharacterId('');
            setArtWorkflowOpen(true);
          }}
          onPacks={() => {
            setSetupCharacterId('');
            setPacksOpen(true);
          }}
          onGenerate={() => {
            setSetupCharacterId('');
            setGenerateOpen(true);
          }}
          onDone={() => {
            setSetupCharacterId('');
            setView('home');
          }}
        />
      )}
      {sourceUpdateOpen && (
        <Modal
          title={`为${character.name}补充资料`}
          subtitle="根据所选资料方式整理文字档案，保留你的语气、关系、参考图与动作偏好。"
          onClose={() => {
            if (!jobBusy) setSourceUpdateOpen(false);
          }}
          wide
        >
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void refreshProfile();
            }}
          >
            <label>
              资料方式
              <select
                aria-label="更新资料方式"
                disabled={jobBusy || Boolean(updateResult.current)}
                value={updateMode}
                onChange={(event) => {
                  setUpdateMode(event.target.value as 'links' | 'search' | 'saved');
                  setUpdateError('');
                }}
              >
                <option value="links">资料链接 · 无需搜索 key</option>
                <option value="search">自动联网搜集</option>
                <option value="saved" disabled={!character.sources.some((source) => source.snippet.trim())}>
                  已保存资料 · 不访问资料站点
                </option>
              </select>
            </label>
            {updateMode === 'links' ? (
              <label>
                资料链接
                <textarea
                  aria-label="更新资料链接"
                  required
                  maxLength={12000}
                  rows={4}
                  value={updateUrls}
                  disabled={jobBusy || Boolean(updateResult.current)}
                  onChange={(event) => setUpdateUrls(event.target.value)}
                  placeholder="官方或 Wiki 资料网页，每行一个，最多 6 个。"
                />
              </label>
            ) : updateMode === 'saved' ? (
              <div className="notice">
                将使用档案中 {character.sources.filter((source) => source.snippet.trim()).length}{' '}
                个来源的已保存文本，只调用聊天模型整理。不会读取新网页；此前资料可能过时，结果会标明未联网更新。
              </div>
            ) : (
              <div className="notice">
                当前搜索服务：{searchProviderNames[selectedSearchProvider(state.settings, keys)]}
                。仅使用实际取得的资料，失败后保留现有档案。
              </div>
            )}
            {progressCard}
            {updateError && <div className="inline-error">{updateError}</div>}
            {updateError &&
              updateMode !== 'saved' &&
              !updateResult.current &&
              character.sources.some((source) => source.snippet.trim()) && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={jobBusy}
                  onClick={() => {
                    setUpdateMode('saved');
                    setUpdateError('');
                  }}
                >
                  改用已保存资料
                </button>
              )}
            <button className="button primary full" disabled={jobBusy}>
              {jobBusy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
              {jobBusy
                ? updateMode === 'saved'
                  ? '正在整理已有资料…'
                  : '正在读取资料…'
                : updateResult.current
                  ? '重试保存档案'
                  : updateMode === 'saved'
                    ? '整理已有资料'
                    : '读取并更新档案'}
            </button>
          </form>
        </Modal>
      )}
      {generateOpen && (
        <GenerationStudio
          key={character.id}
          character={character}
          skins={skins}
          imageReady={imageServiceReady(state.settings, keys)}
          llmReady={chatServiceReady(state.settings, keys)}
          onReferences={updateReferences}
          onBusy={setJobBusy}
          onClose={() => setGenerateOpen(false)}
          onOpenAssets={() => {
            setGenerateOpen(false);
            setArtWorkflowOpen(true);
          }}
          onSaveSkin={async (result, activate) => {
            await save((s) => ({
              ...s,
              skins: [...s.skins.filter((a) => a.id !== result.id), result],
              ...(activate ? { activeCharacterId: result.characterId, activeSkinId: result.id } : {}),
            }));
          }}
        />
      )}
      {petProductionOpen && (
        <PetProductionStudio
          key={character.id}
          character={character}
          skins={skins}
          imageReady={isDesktop && imageServiceReady(state.settings, keys)}
          revisionReady={
            isDesktop &&
            chatServiceReady(state.settings, keys) &&
            selectedSearchProvider(state.settings, keys) !== 'none'
          }
          onClose={() => setPetProductionOpen(false)}
          onBusy={setJobBusy}
          onOpenSettings={() => {
            setPetProductionOpen(false);
            setView('settings');
          }}
          onReferences={updateReferences}
          onSaveSkin={async (result, activate) => {
            await save((s) => ({
              ...s,
              skins: [...s.skins.filter((a) => a.id !== result.id), result],
              ...(activate ? { activeCharacterId: result.characterId, activeSkinId: result.id } : {}),
            }));
          }}
        />
      )}
      {packsOpen && (
        <CharacterPacks
          key={character.id}
          character={character}
          skins={skins}
          onSetup={() => {
            setPacksOpen(false);
            setSetupCharacterId(character.id);
          }}
          onClose={() => setPacksOpen(false)}
          onInstall={async (style) => {
            await save((state) => installStarterPack(state, style));
            setView('home');
            setToast('角色包已启用，可以直接使用本地互动。');
          }}
          onSaveProfile={async (profile, base) => {
            if (
              JSON.stringify(
                stateRef.current.characters.find((item) => item.id === character.id)?.companion,
              ) !== JSON.stringify(base)
            )
              throw new Error('互动台词已在另一窗口修改，请重新打开后编辑。');
            await save((state) => ({
              ...state,
              characters: state.characters.map((item) =>
                item.id === character.id ? { ...item, companion: profile } : item,
              ),
            }));
          }}
          onExport={() => bridge.exportCharacter({ character, skins })}
          onImport={async () => {
            await importCharacter();
          }}
          onAssets={() => {
            setPacksOpen(false);
            setArtWorkflowOpen(true);
          }}
        />
      )}
      {artWorkflowOpen && (
        <ArtWorkflow
          key={character.id}
          character={character}
          initialStyle={skin?.style || 'anime'}
          onClose={() => setArtWorkflowOpen(false)}
          onSaveSkin={async (result, activate) => {
            await save((s) => ({
              ...s,
              skins: [...s.skins.filter((item) => item.id !== result.id), result],
              ...(activate ? { activeCharacterId: result.characterId, activeSkinId: result.id } : {}),
            }));
          }}
        />
      )}
      {modelStudioOpen && (
        <ModelStudio
          key={character.id}
          character={character}
          skins={skins}
          onClose={() => setModelStudioOpen(false)}
          onSaveSkin={async (result, activate) => {
            await save((s) => ({
              ...s,
              skins: [...s.skins.filter((item) => item.id !== result.id), result],
              ...(activate ? { activeCharacterId: result.characterId, activeSkinId: result.id } : {}),
            }));
          }}
        />
      )}
      {themeOpen && (
        <Modal
          title="让空间，染上她的颜色"
          subtitle="主题保存在角色档案中，切换角色时一起切换。"
          onClose={() => setThemeOpen(false)}
        >
          <div className="theme-options">
            {themes.map((t) => (
              <button
                key={t.id}
                className={theme.id === t.id ? 'selected' : ''}
                onClick={() =>
                  commit((s) => ({
                    ...s,
                    characters: s.characters.map((c) =>
                      c.id === character.id ? { ...c, theme: t.id, accent: undefined } : c,
                    ),
                  }))
                }
              >
                <span style={{ background: t.accent }} />
                <span style={{ background: t.companion }} />
                <strong>{t.name}</strong>
                {theme.id === t.id && <Check size={15} />}
              </button>
            ))}
          </div>
          <div className="custom-color">
            <label>
              自定义强调色
              <input
                type="color"
                value={character.accent || theme.accent}
                onChange={(e) =>
                  commit((s) => ({
                    ...s,
                    characters: s.characters.map((c) =>
                      c.id === character.id ? { ...c, accent: e.target.value } : c,
                    ),
                  }))
                }
              />
            </label>
            <button
              className="text-button"
              onClick={() =>
                commit((s) => ({
                  ...s,
                  characters: s.characters.map((c) =>
                    c.id === character.id ? { ...c, theme: 'auto', accent: undefined } : c,
                  ),
                }))
              }
            >
              根据角色自动匹配
            </button>
          </div>
        </Modal>
      )}
      {personaPreviewOpen && (
        <Modal
          title="听听角色的语气"
          subtitle="连续聊几轮，检查角色语气、设定与动作。试聊不会写入正式聊天或记忆。"
          onClose={() => setPersonaPreviewOpen(false)}
          wide
        >
          <PersonaPreview
            key={character.id}
            character={character}
            skin={skin}
            connected={connected}
            blocked={sharedChatStatus.busy}
            mouth={mouth}
            talking={talking}
            audioDriven={Boolean(audioRef.current)}
            motionEnabled={motionEnabled}
            onSpeak={(text) => {
              void speak(text);
            }}
            onStopAudio={stopAudio}
            onEdit={() => {
              setPersonaPreviewOpen(false);
              openProfile();
            }}
            notify={setToast}
          />
        </Modal>
      )}
      {communityOpen && (
        <Modal
          title="社区"
          subtitle="大家分享的桌宠和插件：下载即用，不用重新制作"
          onClose={() => setCommunityOpen(false)}
          wide
        >
          <CommunityPanel
            characterName={character.name}
            catalogue={() => bridge.communityCatalogue()}
            installedPlugins={plugins}
            onInstallPet={async (id) => {
              await importCharacter(await bridge.communityPet(id));
              setCommunityOpen(false);
            }}
            onInstallPlugin={async (id) => setPlugins(await bridge.installCommunityPlugin(id))}
            onRemovePlugin={async (id) => setPlugins(await bridge.removeCommunityPlugin(id))}
            onShare={async () => {
              const characterSkins = state.skins.filter((s) => s.characterId === character.id);
              if (await bridge.exportCharacter({ character, skins: characterSkins }))
                await bridge.openCommunityShare();
            }}
          />
        </Modal>
      )}
      {historyOpen && (
        <Modal
          title="那些聊过的话"
          subtitle={`${character.name} · ${messages.length} 条本机消息`}
          onClose={() => setHistoryOpen(false)}
          wide
        >
          <label className="conversation-search">
            <Search size={18} />
            <input
              autoFocus
              aria-label="搜索对话"
              placeholder="输入一个词，找回那次对话…"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
          </label>
          <div className="conversation-results">
            {messages
              .filter((m) => m.content.toLowerCase().includes(historyQuery.trim().toLowerCase()))
              .slice(-60)
              .reverse()
              .map((m) => (
                <button key={m.id} onClick={() => revealMessage(m.id)}>
                  <span>
                    <strong>{m.role === 'assistant' ? character.name : '你'}</strong>
                    <time>
                      {new Date(m.createdAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    <ArrowUpRight size={15} />
                  </span>
                  <p>
                    {m.content.slice(0, 400)}
                    {m.content.length > 400 ? '…' : ''}
                  </p>
                </button>
              ))}
            {!messages.some((m) => m.content.toLowerCase().includes(historyQuery.trim().toLowerCase())) && (
              <p className="empty-search">
                {messages.length ? '没有找到包含这个词的消息。' : '还没有对话。第一句你好，会从这里开始。'}
              </p>
            )}
          </div>
          <div className="conversation-footer">
            <span>显示最近 60 条匹配消息 · 点击回到对话</span>
            <button
              className="button secondary"
              disabled={!messages.length || interactionBusy || completedReplies.current.has(character.id)}
              title="下一句使用新的近期上下文，保留历史与长期记忆"
              onClick={beginTopic}
            >
              <MessageCircle size={15} />
              开启新话题
            </button>
            <button
              className="button secondary"
              disabled={!messages.length || !isDesktop}
              onClick={exportConversation}
            >
              <Download size={15} />
              导出完整记录
            </button>
          </div>
        </Modal>
      )}
      {profile && (
        <Modal title="编辑角色档案" onClose={() => setProfile(null)} wide>
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              const draft = profile;
              void saveDraft(
                (s) => ({
                  ...s,
                  characters: s.characters.map((c) => (c.id === draft.id ? draft : c)),
                }),
                () => setProfile((value) => (value === draft ? null : value)),
                profileBase.current,
              );
            }}
          >
            <div className="form-row">
              <label>
                名字
                <input
                  required
                  aria-label="角色名字"
                  maxLength={200}
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                />
              </label>
              <label>
                作品
                <input
                  aria-label="角色作品"
                  maxLength={500}
                  value={profile.work}
                  onChange={(e) => setProfile({ ...profile, work: e.target.value })}
                />
              </label>
            </div>
            <label>
              简介
              <textarea
                maxLength={4000}
                value={profile.summary}
                onChange={(e) => setProfile({ ...profile, summary: e.target.value })}
              />
            </label>
            <label>
              性格标签（顿号分隔）
              <input
                value={profile.personality.join('、')}
                onChange={(e) =>
                  setProfile({ ...profile, personality: e.target.value.split(/[、,，]/).slice(0, 12) })
                }
              />
            </label>
            <label>
              说话方式
              <textarea
                maxLength={2000}
                value={profile.speakingStyle}
                onChange={(e) => setProfile({ ...profile, speakingStyle: e.target.value })}
              />
            </label>
            <label>
              外貌描述
              <textarea
                maxLength={2000}
                value={profile.appearance}
                onChange={(e) => setProfile({ ...profile, appearance: e.target.value })}
              />
            </label>
            <PersonaEditor character={profile} onChange={setProfile} />
            {profileInputError && (
              <div className="inline-error" role="alert">
                {profileInputError}
              </div>
            )}
            {profileChanged && (
              <div className="notice">
                另一窗口更新了档案；独立修改可合并，同一项修改需要先核对。
                <button className="text-button" type="button" onClick={openProfile}>
                  重新读取最新档案
                </button>
              </div>
            )}
            <button className="button primary full" disabled={draftSaving || Boolean(profileInputError)}>
              {draftSaving ? '正在保存…' : '保存角色档案'}
            </button>
          </form>
        </Modal>
      )}
      {editingMemory && (
        <Modal title="编辑这段记忆" onClose={() => setEditingMemory(null)}>
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              const draft = editingMemory;
              void saveDraft(
                (s) => ({
                  ...s,
                  memories: s.memories.map((m) =>
                    m.id === draft.id ? { ...draft, text: draft.text.trim() } : m,
                  ),
                }),
                () => setEditingMemory((value) => (value === draft ? null : value)),
                memoryBase.current,
              );
            }}
          >
            <textarea
              aria-label="记忆内容"
              maxLength={8000}
              rows={5}
              value={editingMemory.text}
              onChange={(e) => setEditingMemory({ ...editingMemory, text: e.target.value })}
            />
            {memoryChanged && (
              <div className="notice">
                {latestEditingMemory ? (
                  <>
                    <span>另一窗口更新了这段记忆，独立修改仍可合并。</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openMemory(latestEditingMemory)}
                    >
                      重新读取最新记忆
                    </button>
                  </>
                ) : (
                  <>
                    <span>另一窗口删除了这段记忆，草稿仍保留在这里。</span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={draftSaving || !editingMemory.text.trim()}
                      onClick={() => {
                        const draft = editingMemory;
                        void saveDraft(
                          (s) => ({
                            ...s,
                            memories: [...s.memories, { ...draft, id: id(), text: draft.text.trim() }],
                          }),
                          () => setEditingMemory(null),
                        );
                      }}
                    >
                      保存为新记忆
                    </button>
                  </>
                )}
              </div>
            )}
            <button className="button primary" disabled={!editingMemory.text.trim() || draftSaving}>
              保存记忆
            </button>
          </form>
        </Modal>
      )}
      {modelOpen && editedModel?.model && (
        <Modal
          title="动作与表情映射"
          subtitle="将聊天情绪关联到这个模型实际包含的资源。"
          wide
          onClose={() => setModelOpen(false)}
        >
          <div className="mapping-grid">
            {emotions.map((e) => (
              <label key={e.id}>
                {e.name}
                <select
                  value={editedModel.model?.expressionMap?.[e.id] || ''}
                  onChange={(event) =>
                    setEditedModel({
                      ...editedModel,
                      model: {
                        ...editedModel.model!,
                        expressionMap: { ...editedModel.model!.expressionMap, [e.id]: event.target.value },
                      },
                    })
                  }
                >
                  <option value="">自动匹配 / 无</option>
                  {editedModel.model!.expressions.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mapping-grid spaced">
            {Object.entries(actionNames).map(([key, title]) => (
              <label key={key}>
                {title}
                <select
                  value={editedModel.model?.motionMap?.[key as PetAction] || ''}
                  onChange={(e) =>
                    setEditedModel({
                      ...editedModel,
                      model: {
                        ...editedModel.model!,
                        motionMap: { ...editedModel.model!.motionMap, [key]: e.target.value },
                      },
                    })
                  }
                >
                  <option value="">自动匹配 / 无</option>
                  {Object.keys(editedModel.model!.motions).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="button primary full spaced"
            onClick={() => {
              commit((s) => ({
                ...s,
                skins: s.skins.map((a) => (a.id === editedModel.id ? editedModel : a)),
              }));
              setModelOpen(false);
            }}
          >
            保存映射
          </button>
        </Modal>
      )}
    </div>
  );
}
