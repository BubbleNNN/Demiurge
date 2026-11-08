'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(`mori:${channel}`, ...args);
const subscribe = (channel) => (callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(`mori:${channel}`, listener);
  return () => ipcRenderer.removeListener(`mori:${channel}`, listener);
};
contextBridge.exposeInMainWorld('mori', {
  load: invoke('load'),
  save: invoke('save'),
  saveSettings: invoke('save-settings'),
  importModel: invoke('import-model'),
  importImage: invoke('import-image'),
  importSprite: invoke('import-sprite'),
  importFrames: invoke('import-frames'),
  speak: invoke('speak'),
  research: invoke('research'),
  testSearchConnection: invoke('test-search'),
  chat: invoke('chat'),
  cancelChat: invoke('cancel-chat'),
  previewPersona: invoke('preview-persona'),
  clearPersonaPreview: invoke('clear-persona-preview'),
  exportChat: invoke('export-chat'),
  copyText: invoke('copy-text'),
  generateSkin: invoke('generate-skin'),
  prepareSkinGeneration: invoke('prepare-skin-generation'),
  generateExpressions: invoke('generate-expressions'),
  reviewSkin: invoke('review-skin'),
  startPetJob: invoke('start-pet-job'),
  advancePetJob: invoke('advance-pet-job'),
  listPetJobs: invoke('list-pet-jobs'),
  retryPetStep: invoke('retry-pet-step'),
  cancelPetJob: invoke('cancel-pet-job'),
  petJobResults: invoke('pet-job-results'),
  petJobMasters: invoke('pet-job-masters'),
  petJobStyleReference: invoke('pet-job-style-reference'),
  selectPetBase: invoke('select-pet-base'),
  refinePetBase: invoke('refine-pet-base'),
  retryPetBaseEdit: invoke('retry-pet-base-edit'),
  revisePetJob: invoke('revise-pet-job'),
  getRecoveryStatus: invoke('get-recovery-status'),
  restorePreviousState: invoke('restore-previous-state'),
  resetCredentials: invoke('reset-credentials'),
  openDataDirectory: invoke('open-data-directory'),
  exportWorkspace: invoke('export-workspace'),
  importWorkspace: invoke('import-workspace'),
  importReferences: invoke('import-references'),
  importStyleReference: invoke('import-style-reference'),
  discoverReferences: invoke('discover-references'),
  focusReference: invoke('focus-reference'),
  useReferenceImage: invoke('use-reference-image'),
  startModelJob: invoke('start-model-job'),
  advanceModelJob: invoke('advance-model-job'),
  recoverModelJob: invoke('recover-model-job'),
  listModelJobs: invoke('list-model-jobs'),
  testConnection: invoke('test-connection'),
  desktopScene: invoke('desktop-scene'),
  stepPet: invoke('step-pet'),
  openPet: invoke('open-pet'),
  closePet: invoke('close-pet'),
  openWorkshop: invoke('open-workshop'),
  exportCharacter: invoke('export-character'),
  importCharacter: invoke('import-character'),
  openExternal: invoke('open-external'),
  movePet: (delta) => ipcRenderer.send('mori:move-pet', delta),
  setPetClickThrough: (enabled) => ipcRenderer.send('mori:pet-click-through', enabled),
  onProgress: subscribe('progress'),
  onStateChanged: subscribe('state-changed'),
  onKeysChanged: subscribe('keys-changed'),
  onChatStatusChanged: subscribe('chat-status'),
  // The main process asks before closing; the page replies once pending saves are written.
  onBeforeClose: (callback) => {
    const listener = () => {
      Promise.resolve()
        .then(callback)
        .catch(() => {})
        .finally(() => ipcRenderer.send('mori:close-ready'));
    };
    ipcRenderer.on('mori:before-close', listener);
    return () => ipcRenderer.removeListener('mori:before-close', listener);
  },
});
