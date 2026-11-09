import type { DesktopProfile } from './characterBehavior';
export type Emotion = 'neutral' | 'happy' | 'thinking' | 'sad' | 'sleepy' | 'surprised';
// Life activities (shared/activities.json): take out a prop, loop, put it away.
export type Activity = 'office' | 'read' | 'gaming' | 'snack' | 'music' | 'diary';
export type DesktopAction =
  | 'walk_left'
  | 'walk_right'
  | 'walk_up'
  | 'walk_down'
  | 'drag'
  | 'listen'
  | 'sit'
  | 'lie'
  | 'fly';
export type PetAction = DesktopAction | 'idle' | 'bounce' | 'nod' | 'shake' | 'sleep' | 'wave' | Activity;
export type CompanionEvent =
  | 'greet'
  | 'touch'
  | 'headpat'
  | 'poke'
  | 'drag'
  | 'rest'
  | 'wake'
  | 'comfort'
  | 'thanks'
  | 'focus'
  | 'farewell'
  | 'unknown';
export interface CompanionProfile {
  version: 1;
  replies: Partial<Record<CompanionEvent, string[]>>;
}
export type ArtStyle =
  | 'original'
  | 'anime'
  | 'chibi-pet'
  | 'chibi'
  | 'sticker'
  | 'pastel'
  | 'figure'
  | 'powerpuff'
  | 'pixel'
  | '8bit'
  | 'realistic'
  | '3d'
  | 'watercolor'
  | 'plush'
  | 'figurine';
export type ThemeName = 'rose' | 'violet' | 'ocean' | 'forest' | 'amber' | 'auto';
export interface Source {
  title: string;
  url: string;
  snippet: string;
}
export interface VisualReference {
  id: string;
  name: string;
  image: string;
  sourceUrl?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  origin?: 'catalog' | 'page' | 'wiki';
  match?: 'name' | 'unverified';
  createdAt: string;
}
export interface StyleReferenceInfo {
  id: string;
  name: string;
  digest: string;
}
export interface ChibiResearch {
  status: 'found' | 'fallback';
  checkedAt: string;
  reason: string;
  sources: { title: string; url: string; imageUrl?: string }[];
  warnings: string[];
}
export interface ImageProvenance {
  chibiResearch?: ChibiResearch;
  mode?: 'image' | 'program';
  referenceIds: string[];
  referenceDigest: string;
  model: string;
  prompt: string;
  parentSkinId?: string;
  styleReference?: StyleReferenceInfo;
  candidateDirection?: 'balanced' | 'bold' | 'soft';
}
export interface ImageReview {
  status: 'pending' | 'approved' | 'rejected';
  referenceDigest: string;
  imageDigest: string;
  reviewedAt?: string;
  animation?: { frames: number[]; anatomy: true; identity: true; continuity: true };
  animationDigest?: string;
}
export interface FrameReviewInput {
  imageDigest: string;
  animationDigest: string;
  frames: number[];
  anatomy: true;
  identity: true;
  continuity: true;
}
export interface Character {
  id: string;
  name: string;
  work: string;
  summary: string;
  personality: string[];
  speakingStyle: string;
  appearance: string;
  knowledge?: {
    kind: 'draft' | 'sourced' | 'manual';
    method: 'model' | 'links' | 'claude' | 'searxng' | 'wiki' | 'tavily' | 'manual' | 'saved';
    collectedAt: string;
  };
  roleplay?: {
    timeline: string;
    relationship: string;
    voiceRules: string[];
    avoid: string[];
    customFacts: string[];
    spoilerPolicy: 'avoid' | 'allow';
  };
  companion?: CompanionProfile;
  /** How she lives on the desktop, when set by her pack or a plugin (characterBehavior.ts). */
  desktopProfile?: Partial<Omit<DesktopProfile, 'manner'>> & { manner?: Partial<DesktopProfile['manner']> };
  visualReferences?: VisualReference[];
  referenceCandidates?: VisualReference[];
  referenceWarnings?: string[];
  theme?: ThemeName;
  accent?: string;
  quotes: { text: string; sourceUrl?: string }[];
  sources: Source[];
  unknowns: string[];
  behavior: { energy: number; affection: number; curiosity: number };
  createdAt: string;
}
export interface ModelAsset {
  id: string;
  entry: string;
  expressions: string[];
  motions: Record<string, number>;
  expressionMap?: Partial<Record<Emotion, string>>;
  motionMap?: Partial<Record<PetAction, string>>;
  boneMap?: { head?: string };
}
export interface Skin {
  /** Size of the animation atlas when it is stored as a file rather than embedded. */
  atlasSize?: { width: number; height: number };
  id: string;
  characterId: string;
  name: string;
  style: ArtStyle;
  kind?: 'image' | 'live2d' | 'vrm' | 'glb';
  model?: ModelAsset;
  sprite?: SpriteAnimation;
  drawing?: PixelDrawing;
  builtin?:
    | 'cyrene-original-v1'
    | 'cyrene-powerpuff-v1'
    | 'cyrene-pixel-v6'
    | 'cyrene-anime-v5'
    | 'cyrene-8bit-v5'
    | 'cyrene-realistic-v5'
    | 'cyrene-3d-v5'
    | 'cyrene-anime-v4'
    | 'cyrene-chibi-v4'
    | 'cyrene-pixel-v4'
    | 'cyrene-watercolor-v4'
    | 'cyrene-plush-v4'
    | 'cyrene-figurine-v4'
    | 'cyrene-reference-v3'
    | 'cyrene-anime'
    | 'cyrene-chibi'
    | 'cyrene-pixel'
    | 'cyrene-plush';
  images: Partial<Record<Emotion, string>>;
  createdAt: string;
  generated: boolean;
  generation?: ImageProvenance;
  review?: ImageReview;
}
export interface PixelDrawing {
  version: 1;
  width: number;
  height: number;
  palette: string[];
  joints: { head: [number, number]; leftArm: [number, number]; rightArm: [number, number] };
  parts: { joint: 'body' | 'head' | 'leftArm' | 'rightArm'; shapes: PixelShape[] }[];
  faces: Record<Emotion | 'blink' | 'talk', PixelShape[]>;
}
export interface PixelShape {
  type: 'polygon' | 'line' | 'ellipse';
  color: number;
  points: [number, number][];
}
export interface SpriteFrame {
  rect: [number, number, number, number];
  duration: number;
  /** Without `cell`: a shift in logical canvas units. With `cell`: the rect's position in that canvas, in physical pixels. */
  offset?: [number, number];
  /** Physical size of the frame's full canvas when the stored rect holds only the visible pixels. */
  cell?: [number, number];
  /** Atlas page holding this frame: 0 (omitted) is the skin's image, n is `pages[n - 1]`. */
  page?: number;
}
export interface SpriteClip {
  frames: number[];
  durations?: number[];
  loop?: boolean;
}
// Only authored complete frames; no inferred body masks or mesh warping.
export interface SpriteAnimation {
  width: number;
  height: number;
  frames: SpriteFrame[];
  clips: Partial<
    Record<PetAction | `enter_${PetAction}` | `exit_${PetAction}` | 'blink' | 'talk' | Emotion, SpriteClip>
  > & { idle: SpriteClip };
  pixelated?: boolean;
  palette?: string[];
  /** Extra atlas pages of a large pack, each an embedded PNG or a stored file. */
  pages?: { src: string; width: number; height: number }[];
  // Explicit authored mouth poses, ordered by opening rather than clip timing.
  mouthFrames?: { closed: number; small: number; wide: number };
}
export interface ChatMessage {
  interaction?: CompanionEvent;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  emotion?: Emotion;
  action?: PetAction;
  origin?: 'model' | 'script';
  contextStart?: boolean;
  replyTo?: string;
  createdAt: string;
}
export interface Memory {
  id: string;
  characterId: string;
  text: string;
  createdAt: string;
  pinned?: boolean;
  excluded?: boolean;
}
export interface Settings {
  codexHome?: string;
  desktopLifeEnabled?: boolean;
  petSize?: 'small' | 'medium' | 'large';
  /** Desktop pet size as a multiple of the medium size; set by scrolling or pinching on the pet. */
  petScale?: number;
  /** Character zoom on the in-app stage. */
  stageZoom?: number;
  /** Built-in looks the user deleted, so they are not restored. */
  removedBuiltins?: string[];
  chatMode?: 'model' | 'local';
  llmBaseUrl: string;
  llmProtocol?: 'openai' | 'anthropic' | 'codex';
  llmAuthMode?: 'api-key' | 'bearer';
  llmEndpointMode?: 'base' | 'exact';
  llmModel: string;
  searchProvider?: 'none' | 'claude' | 'codex' | 'searxng' | 'wiki' | 'tavily';
  searxngBaseUrl?: string;
  wikiApiUrl?: string;
  chatHistoryBudget?: 6000 | 12000 | 24000;
  imageBaseUrl: string;
  imageModel: string;
  imageProvider?: 'api' | 'codex';
  imageInputFidelity?: 'auto' | 'high';
  modelBaseUrl?: string;
  modelVersion?: string;
  demoMode: boolean;
  proactiveEnabled: boolean;
  motionEnabled?: boolean;
  trackingEnabled?: boolean;
  ttsBaseUrl?: string;
  ttsModel?: string;
  ttsVoice?: string;
  voiceEnabled?: boolean;
  voiceRate?: number;
}
export interface Credentials {
  llmKey?: string;
  searchKey?: string;
  imageKey?: string;
  ttsKey?: string;
  modelKey?: string;
}
export interface AppState {
  preferredSkins?: Record<string, string>;
  revision?: number;
  settings: Settings;
  characters: Character[];
  skins: Skin[];
  activeCharacterId: string;
  activeSkinId: string;
  messages: Record<string, ChatMessage[]>;
  memories: Memory[];
}
// What the character is doing right now, from the local daily-life routine (never canon).
/** What the chat model understood from a correction and which sources it used for the image prompt. */
export interface RevisionPlanSummary {
  summary: string;
  conflicts: string;
  query: string;
  sources: { title: string; url: string }[];
  searched: number;
}
export interface LifeSituation {
  timeOfDay: string;
  doing: string;
  reason: string;
  feeling: string[];
  recentMoments: string[];
}
export interface ChatReply {
  interaction?: CompanionEvent;
  origin?: 'model' | 'script';
  text: string;
  emotion: Emotion;
  action: PetAction;
  memory: string | null;
}
export interface KeyStatus {
  llmKey: boolean;
  searchKey: boolean;
  imageKey: boolean;
  ttsKey?: boolean;
  modelKey?: boolean;
  secure: boolean;
  credentialError?: string;
}
export interface ChatStatus {
  busy: boolean;
  mode?: 'chat' | 'preview';
  characterId?: string;
}
export interface ProgressEvent {
  stage: string;
  detail: string;
  completed?: number;
  total?: number;
}
export interface ModelJob {
  id: string;
  provider: 'meshy';
  characterId: string;
  name: string;
  sourceReferenceId: string;
  sourceDigest: string;
  status:
    | 'submitting'
    | 'generating'
    | 'rig-submitting'
    | 'rigging'
    | 'downloading'
    | 'ready'
    | 'failed'
    | 'uncertain';
  taskId?: string;
  rigTaskId?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  skin?: Skin;
}
export type PetMotion =
  | DesktopAction
  | 'office'
  | 'blink'
  | 'talk'
  | 'wave'
  | 'nod'
  | 'shake'
  | 'bounce'
  | 'sleep'
  | 'emotions'
  | 'read'
  | 'gaming'
  | 'snack'
  | 'music'
  | 'diary';
export interface PetProductionOptions {
  transitionVersion?: 1 | 2 | 3;
  candidateCount?: 1 | 2 | 3;
  candidateVariation?: 'subtle' | 'explore';
  frameCount?: 4 | 8;
  temperament?: 'natural' | 'gentle' | 'lively';
  artDirection?: string;
  /** Sharp draws fewer poses per image (more requests, much sharper motion frames). */
  quality?: 'sharp' | 'standard';
}
export interface PetJob extends PetProductionOptions {
  id: string;
  version: 1;
  provider: 'image-edits';
  characterId: string;
  name: string;
  styles: ArtStyle[];
  motions: PetMotion[];
  referenceDigest: string;
  configDigest: string;
  styleReference?: StyleReferenceInfo;
  status: 'queued' | 'running' | 'attention' | 'ready' | 'cancelled';
  awaitingSelection?: ArtStyle;
  selectedBases?: Partial<Record<ArtStyle, string>>;
  baseEdits?: {
    id: string;
    style: ArtStyle;
    sourceSkinId: string;
    feedback: string;
    createdAt: string;
    status: 'working' | 'done' | 'failed' | 'unsaved' | 'uncertain';
    error?: string;
    plan?: RevisionPlanSummary;
  }[];
  /** Motions added to a finished task (sourceJobId), reusing everything it already drew. */
  extension?: { sourceJobId: string; motions: PetMotion[] };
  revision?: {
    sourceJobId: string;
    kind: 'base' | 'motion';
    motion?: PetMotion;
    feedback: string;
    plan?: RevisionPlanSummary;
  };
  createdAt: string;
  updatedAt: string;
  steps: {
    kind: 'base' | 'sheet' | 'pack';
    style: ArtStyle;
    motion?: PetMotion;
    status: 'queued' | 'working' | 'done' | 'failed' | 'unsaved' | 'uncertain';
    error?: string;
    /** Which image of a motion drawn in several images (sharp quality), counted from 0. */
    part?: number;
    /** Automatic regenerations already spent on this pose sheet after quality rejections. */
    attempts?: number;
    /** Guidance for the next request, derived from the last rejection. */
    hint?: string;
    /** On a pack step being rebuilt: the earlier result it will replace. */
    replaces?: string;
  }[];
  results: { style: ArtStyle; skinId: string; warnings: string[] }[];
}
export interface PersonaPreviewReply extends ChatReply {
  preview: {
    sessionId: string;
    turnCount: number;
    maxTurns: number;
    resetReason?: 'profile-changed' | 'expired';
  };
}

export interface MoriBridge {
  load(): Promise<{ state: AppState | null; keys: KeyStatus; chatStatus?: ChatStatus }>;
  resetCredentials(): Promise<KeyStatus>;
  getRecoveryStatus(): Promise<{ hasPreviousState: boolean }>;
  restorePreviousState(): Promise<{ state: AppState | null; keys: KeyStatus }>;
  openDataDirectory(): Promise<void>;
  exportWorkspace(): Promise<boolean>;
  importWorkspace(): Promise<boolean>;
  save(state: AppState, base?: AppState | null): Promise<AppState>;
  saveSettings(settings: Settings, credentials: Credentials, baseSettings?: Settings): Promise<KeyStatus>;
  research(input: {
    characterId?: string;
    name: string;
    work: string;
    notes: string;
    mode?: 'draft' | 'links' | 'search' | 'saved';
    urls?: string[];
  }): Promise<Character>;
  testSearchConnection(): Promise<{ ok: boolean; message: string }>;
  chat(input: {
    character: Character;
    messages: ChatMessage[];
    memories: Memory[];
    skinId?: string;
    situation?: LifeSituation;
  }): Promise<ChatReply>;
  cancelChat(): Promise<void>;
  previewPersona(input: {
    characterId: string;
    text: string;
    skinId?: string;
    sessionId?: string;
  }): Promise<PersonaPreviewReply>;
  clearPersonaPreview(): Promise<void>;
  exportChat(characterId: string): Promise<boolean>;
  copyText(text: string): Promise<void>;
  prepareSkinGeneration(input: {
    characterId: string;
    sourceSkinId?: string;
    mode?: 'image' | 'program';
  }): Promise<{
    referenceDigest: string;
    referenceCount: number;
  }>;
  generateSkin(input: {
    programSkinId?: string;
    feedback?: string;
    mode?: 'image' | 'program';
    characterId: string;
    style: ArtStyle;
    sourceSkinId?: string;
    referenceDigest?: string;
  }): Promise<Skin>;
  generateExpressions(input: {
    characterId: string;
    skinId: string;
  }): Promise<{ skin: Skin; warning?: string }>;
  reviewSkin(input: {
    characterId: string;
    skinId: string;
    decision: 'approved' | 'rejected';
    frameReview?: FrameReviewInput;
  }): Promise<Skin>;
  startPetJob(
    input: PetProductionOptions & {
      characterId: string;
      styles: ArtStyle[];
      motions: PetMotion[];
      autoCollect: boolean;
      sourceSkinId?: string;
      styleReference?: VisualReference;
    },
  ): Promise<PetJob>;
  advancePetJob(jobId: string): Promise<PetJob>;
  listPetJobs(characterId: string): Promise<PetJob[]>;
  retryPetStep(input: { jobId: string; index: number }): Promise<PetJob>;
  /** Rebuild a finished task's animation from its saved sheets; no image request. */
  repackPetJob(jobId: string): Promise<PetJob>;
  cancelPetJob(jobId: string): Promise<PetJob>;
  petJobResults(jobId: string): Promise<Skin[]>;
  petJobMasters(jobId: string): Promise<Skin[]>;
  petJobStyleReference(jobId: string): Promise<VisualReference | null>;
  selectPetBase(input: { jobId: string; style: ArtStyle; skinId: string }): Promise<PetJob>;
  refinePetBase(input: { jobId: string; style: ArtStyle; skinId: string; feedback: string }): Promise<PetJob>;
  retryPetBaseEdit(input: { jobId: string; editId: string }): Promise<PetJob>;
  revisePetJob(input: {
    jobId: string;
    style: ArtStyle;
    motion?: PetMotion;
    feedback: string;
  }): Promise<PetJob>;
  /** Adds motions a finished task does not have, reusing everything it already drew. */
  extendPetJob(input: { jobId: string; style: ArtStyle; motions: PetMotion[] }): Promise<PetJob>;
  importReferences(): Promise<VisualReference[]>;
  importStyleReference(): Promise<VisualReference | null>;
  discoverReferences(characterId: string): Promise<AppState>;
  focusReference(input: { characterId: string; referenceId: string }): Promise<AppState>;
  useReferenceImage(characterId: string): Promise<Skin>;
  startModelJob(characterId: string): Promise<ModelJob>;
  advanceModelJob(jobId: string): Promise<ModelJob>;
  recoverModelJob(input: { jobId: string; taskId: string }): Promise<ModelJob>;
  listModelJobs(characterId: string): Promise<ModelJob[]>;
  importModel(characterId: string, kind: 'live2d' | 'vrm'): Promise<Skin | null>;
  importImage(characterId: string, style: ArtStyle): Promise<Skin | null>;
  importSprite(characterId: string, style: ArtStyle): Promise<Skin | null>;
  importFrames(characterId: string, style: ArtStyle): Promise<Skin | null>;
  speak(text: string): Promise<string>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  desktopScene(icons?: boolean): Promise<DesktopScene>;
  /** Move the pet window toward a point; `free` lets her figure go past a side of the screen, and
   *  `jump` moves there at once (both for running in from off screen). */
  stepPet(target: { x: number; y: number; free?: boolean; jump?: boolean }): Promise<DesktopRect>;
  openPet(): Promise<void>;
  closePet(): Promise<void>;
  movePet(delta: { x: number; y: number }): void;
  setPetClickThrough(enabled: boolean): void;
  /** Resize the desktop pet live; the scale is a multiple of the medium size. */
  scalePet(scale: number): void;
  /** Seconds since the user last touched keyboard or mouse. */
  userIdle(): Promise<number>;
  openWorkshop(): Promise<void>;
  exportCharacter(input: { character: Character; skins: Skin[] }): Promise<boolean>;
  importCharacter(): Promise<{ character: Character; skins: Skin[] } | null>;
  /** The community catalogue of shared pets and plugins (electron/community.cjs). */
  communityCatalogue(): Promise<CommunityCatalogue>;
  /** A shared pet, downloaded, checked and validated like a local character pack. */
  communityPet(id: string): Promise<{ character: Character; skins: Skin[] }>;
  installCommunityPlugin(id: string): Promise<CommunityPlugin[]>;
  communityPlugins(): Promise<CommunityPlugin[]>;
  removeCommunityPlugin(id: string): Promise<CommunityPlugin[]>;
  /** Opens the page for sharing a pet with the community. */
  openCommunityShare(): Promise<void>;
  openExternal(url: string): Promise<void>;
  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onStateChanged(callback: (state: AppState) => void): () => void;
  onKeysChanged(callback: (keys: KeyStatus) => void): () => void;
  onChatStatusChanged(callback: (status: ChatStatus) => void): () => void;
  /** Points of the pet window's bands above and below her figure that are on screen. */
  onPetRoom?(callback: (room: { above: number; below: number }) => void): () => void;
  /** The user moved to another Space or full-screen app (macOS), toward this side. */
  /** The user moved to another Space; `from` is the side they came from, where she runs in. */
  onSpaceChanged?(callback: (change: { from: 'left' | 'right' }) => void): () => void;
  onBeforeClose?(callback: () => Promise<unknown>): () => void;
}
declare global {
  interface Window {
    mori?: MoriBridge;
  }
}

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DesktopScene {
  bounds: DesktopRect;
  area: DesktopRect;
  /** How far the pet window may hang past the top and bottom of the work area. */
  margins?: { top: number; bottom: number };
  /** When the window positions were taken (ms); speeds are measured between such moments. */
  at?: number;
  /** Visible app windows, front to back; `app` is the owning app's bundle identifier or name. */
  surfaces: (DesktopRect & { id: string; app?: string })[];
  icons: (DesktopRect & { id: string })[];
  supported: boolean;
  reason?: string;
  /** What the user is doing (macOS): the front app and its window, seconds since input. */
  activity?: UserActivity;
}
export interface UserActivity {
  app: { bundle: string; name: string } | null;
  /** Mori itself is in front: the user is with her rather than in another app. */
  self?: boolean;
  keyIdle: number;
  pointerIdle: number;
  /** The front app's front window. */
  focus?: DesktopRect & { id: string };
}
export interface CommunityEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  license: string;
  path: string;
  size: number;
  sha256: string;
}
export interface CommunityCatalogue {
  version: 1;
  updated: string;
  pets: (CommunityEntry & { work: string; preview?: string; previewImage?: string })[];
  plugins: (CommunityEntry & { kind: 'behavior' })[];
}
/** A data plugin: a behaviour profile and lines for one character, or for all of them. */
export interface CommunityPlugin {
  version: 1;
  id: string;
  name: string;
  author: string;
  description: string;
  kind: 'behavior';
  target: 'all' | string;
  profile: NonNullable<Character['desktopProfile']>;
}
