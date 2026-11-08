import type { AppState, MoriBridge, KeyStatus } from './types';
import { initialState } from './initial';
const emptyKeys: KeyStatus = {
  llmKey: false,
  searchKey: false,
  imageKey: false,
  ttsKey: false,
  secure: false,
};
const listeners = new Set<(state: AppState) => void>();
const storageKey = 'mori-workspace-v2';
let browserState = initialState();
const desktopRequired = async (): Promise<never> => {
  throw new Error(
    '请使用桌面开发版执行真实 API 调用与本地模型导入。运行 pnpm desktop，或双击 Start Mori.command。',
  );
};
export const isDesktop = Boolean(window.mori);
export const bridge: MoriBridge = window.mori ?? {
  async load() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) browserState = JSON.parse(raw);
    } catch {
      /* preserve default */
    }
    return { state: browserState, keys: emptyKeys };
  },
  async save(state) {
    browserState = structuredClone(state);
    localStorage.setItem(storageKey, JSON.stringify(state));
    listeners.forEach((cb) => cb(state));
    return browserState;
  },
  saveSettings: desktopRequired,
  focusReference: desktopRequired,
  resetCredentials: desktopRequired,
  getRecoveryStatus: desktopRequired,
  restorePreviousState: desktopRequired,
  openDataDirectory: desktopRequired,
  exportWorkspace: desktopRequired,
  importWorkspace: desktopRequired,
  research: desktopRequired,
  testSearchConnection: desktopRequired,
  chat: desktopRequired,
  cancelChat: desktopRequired,
  previewPersona: desktopRequired,
  clearPersonaPreview: desktopRequired,
  exportChat: desktopRequired,
  async copyText(text) {
    await navigator.clipboard.writeText(text);
  },
  generateSkin: desktopRequired,
  prepareSkinGeneration: desktopRequired,
  generateExpressions: desktopRequired,
  reviewSkin: desktopRequired,
  startPetJob: desktopRequired,
  advancePetJob: desktopRequired,
  listPetJobs: desktopRequired,
  retryPetStep: desktopRequired,
  repackPetJob: desktopRequired,
  cancelPetJob: desktopRequired,
  petJobResults: desktopRequired,
  petJobMasters: desktopRequired,
  petJobStyleReference: desktopRequired,
  selectPetBase: desktopRequired,
  refinePetBase: desktopRequired,
  retryPetBaseEdit: desktopRequired,
  revisePetJob: desktopRequired,
  importReferences: desktopRequired,
  importStyleReference: desktopRequired,
  discoverReferences: desktopRequired,
  useReferenceImage: desktopRequired,
  startModelJob: desktopRequired,
  advanceModelJob: desktopRequired,
  recoverModelJob: desktopRequired,
  listModelJobs: desktopRequired,
  importModel: desktopRequired,
  importImage: desktopRequired,
  importSprite: desktopRequired,
  importFrames: desktopRequired,
  speak: desktopRequired,
  testConnection: desktopRequired,
  desktopScene: desktopRequired,
  stepPet: desktopRequired,
  openPet: desktopRequired,
  async closePet() {
    window.close();
  },
  movePet() {},
  setPetClickThrough() {},
  scalePet() {},
  userIdle: async () => 0,
  async openWorkshop() {
    location.search = '';
  },
  exportCharacter: desktopRequired,
  importCharacter: desktopRequired,
  async openExternal(url) {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
  },
  onProgress() {
    return () => {};
  },
  onKeysChanged() {
    return () => {};
  },
  onChatStatusChanged() {
    return () => {};
  },
  onStateChanged(callback) {
    listeners.add(callback);
    const listener = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue) {
        try {
          browserState = JSON.parse(event.newValue);
          callback(browserState);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', listener);
    return () => {
      listeners.delete(callback);
      window.removeEventListener('storage', listener);
    };
  },
};
const closeFlushers = new Set<() => Promise<unknown>>();
window.mori?.onBeforeClose?.(() => Promise.allSettled([...closeFlushers].map((flush) => flush())));
// Register work that must reach disk before the window closes or the app quits.
export function flushBeforeClose(flush: () => Promise<unknown>): () => void {
  closeFlushers.add(flush);
  return () => {
    closeFlushers.delete(flush);
  };
}
