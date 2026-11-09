'use strict';
const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  dialog,
  shell,
  screen,
  session,
  protocol,
  net,
  nativeImage,
  clipboard,
  powerMonitor,
  Menu,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  createStore,
  validateState,
  validateSettings,
  validateCharacter,
  validateReferences,
  validateSkin,
  validateBundle,
  MAX_FILE_BYTES,
} = require('./store.cjs');
const services = require('./services.cjs').createServices(globalThis.fetch, {
  inspectImage: (bytes) => {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('参考图无法解码。');
    return image.getSize();
  },
});
const { reviewSkin, styleReferencePack, imageBytes } = require('./references.cjs');
const { installModel, installGeneratedModel, resolveAsset } = require('./models.cjs');
const { randomUUID } = require('node:crypto');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mori-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// The app is called Demiurge (it was Mori until 0.3.26). The internal name stays "Mori": it names
// the data folder (~/Library/Application Support/Mori) and the Keychain item that encrypts saved
// API keys, so existing workspaces and keys carry over untouched. Everything shown is Demiurge.
app.setName('Mori');
const DISPLAY_NAME = 'Demiurge';
// Windows takes the window and taskbar icon from each window (macOS from the app bundle).
const windowIcon = (() => {
  if (process.platform !== 'win32') return undefined;
  const file = path.join(__dirname, '../dist/app-icon.png');
  return require('node:fs').existsSync(file) ? file : undefined;
})();
if (process.env.MORI_DATA_DIR) app.setPath('userData', path.resolve(process.env.MORI_DATA_DIR));
if (!require('./instance.cjs').acquireWorkspaceInstance(app, () => createWorkshop())) return;
const devUrl = process.env.MORI_DEV_URL;
if (devUrl && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(devUrl))
  throw new Error('MORI_DEV_URL must use the loopback development server.');
let workshop = null;
let pet = null;
let store;
let modelPipeline;
let petPipeline;
const workspaceGate = require('./workspace-gate.cjs').createWorkspaceGate();
const workspaceBackup = require('./workspace-backup.cjs');
const runningJobs = new Set();
const personaSessions = require('./persona-sessions.cjs').createPersonaSessions();
const chatControllers = new Map();
let chatStatus = { busy: false };
const documentPath = path.resolve(__dirname, '../dist/index.html');
const productionUrl = pathToFileURL(documentPath).href;

function isTrusted(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || (window !== workshop && window !== pet)) return false;
  if (event.senderFrame !== event.sender.mainFrame) return false;
  const url = event.senderFrame.url;
  return devUrl
    ? new URL(url).origin === new URL(devUrl).origin
    : url.split('?')[0].split('#')[0] === productionUrl;
}
function handle(name, callback) {
  ipcMain.handle(`mori:${name}`, async (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Untrusted renderer request.');
    return workspaceGate.run(name, () => callback(event, ...args));
  });
}
function broadcast(state) {
  updatePetLayout(state);
  for (const window of [workshop, pet])
    if (window && !window.isDestroyed()) window.webContents.send('mori:state-changed', state);
}
function updateChatStatus(value) {
  chatStatus = value;
  for (const window of [workshop, pet])
    if (window && !window.isDestroyed()) window.webContents.send('mori:chat-status', value);
}
function bound(value, max = 2 * 1024 * 1024) {
  if (!value || typeof value !== 'object' || Buffer.byteLength(JSON.stringify(value)) > max)
    throw new Error('请求内容无效或过大。');
  return value;
}
// Promotional splash art often shows a small figure inside large decorations. Crop a reference to
// the character's own body, located by the configured chat model, before it guides image
// generation. Returns null when there is nothing worth cropping or no chat service to ask.
async function focusReference(reference, character, settings, credentials) {
  const box = await services.locateCharacter(reference, character, settings, credentials).catch(() => null);
  if (!box) return null;
  const image = nativeImage.createFromDataURL(reference.image);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const padX = (box.right - box.left) * 0.08,
    padY = (box.bottom - box.top) * 0.05;
  const x0 = Math.max(0, Math.floor((box.left - padX) * width)),
    y0 = Math.max(0, Math.floor((box.top - padY) * height)),
    x1 = Math.min(width, Math.ceil((box.right + padX) * width)),
    y1 = Math.min(height, Math.ceil((box.bottom + padY) * height));
  const w = x1 - x0,
    h = y1 - y0;
  // Already focused on the character, or too small to be a useful identity reference.
  if (w * h > width * height * 0.8 || Math.min(w, h) < 320) return null;
  const bytes = image.crop({ x: x0, y: y0, width: w, height: h }).toPNG();
  return {
    ...reference,
    id: randomUUID(),
    name: `${reference.name.replace(/（人物裁切）$/, '')}（人物裁切）`,
    image: `data:image/png;base64,${bytes.toString('base64')}`,
    width: w,
    height: h,
    createdAt: new Date().toISOString(),
  };
}
async function getConfiguration() {
  const state = await store.loadState();
  if (!state) throw new Error('角色工坊尚未初始化，请先打开主窗口。');
  return { settings: state.settings, credentials: await store.getCredentials() };
}
async function job(event, kind, callback) {
  if (runningJobs.has(kind)) throw new Error('同类型任务正在进行，请等待完成后再试。');
  runningJobs.add(kind);
  const progress = (value) => {
    if (!event.sender.isDestroyed()) event.sender.send('mori:progress', value);
  };
  try {
    return await callback(progress);
  } finally {
    runningJobs.delete(kind);
  }
}
function secureWindow(window) {
  const owner = window.webContents.id;
  window.webContents.once('destroyed', () => personaSessions.clear(owner));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}
function chatJob(event, callback, mode = 'chat', characterId) {
  return job(event, 'chat', async (progress) => {
    const controller = new AbortController();
    const senderId = event.sender.id;
    chatControllers.set(senderId, controller);
    updateChatStatus({
      busy: true,
      mode,
      ...(typeof characterId === 'string' ? { characterId: characterId.slice(0, 128) } : {}),
    });
    const stop = () => controller.abort();
    event.sender.once('destroyed', stop);
    try {
      return await callback(progress, controller.signal);
    } finally {
      event.sender.removeListener('destroyed', stop);
      chatControllers.delete(senderId);
      updateChatStatus({ busy: false });
    }
  });
}
function loadWindow(window, petMode = false) {
  const requestedView = process.env.MORI_DEV_VIEW;
  const feature = require('../shared/features.json').find((item) => item.id === requestedView);
  const query = petMode ? { pet: '1' } : feature ? { view: feature.id } : {};
  if (devUrl) {
    const url = new URL(devUrl);
    url.search = new URLSearchParams(query).toString();
    return window.loadURL(url.href);
  }
  return window.loadFile(documentPath, { query });
}
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
  require('./desktop-surfaces.cjs').stopWatching();
});
// Settings and drafts save a moment after each change. Closing the window or quitting first lets
// the page finish those writes (bounded, so a stuck page can never block quitting).
function finishSavesBeforeClose(window) {
  let allowed = false;
  window.on('close', (event) => {
    const contents = window.webContents;
    if (allowed || contents.isDestroyed() || contents.isLoading() || contents.isCrashed()) return;
    event.preventDefault();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ipcMain.removeListener('mori:close-ready', ready);
      allowed = true;
      if (quitting) app.quit();
      else if (!window.isDestroyed()) window.close();
    };
    const ready = (readyEvent) => {
      if (readyEvent.sender === contents) finish();
    };
    ipcMain.on('mori:close-ready', ready);
    const timer = setTimeout(finish, 2000);
    contents.send('mori:before-close');
  });
}
function createWorkshop() {
  if (workshop && !workshop.isDestroyed()) {
    if (workshop.isMinimized()) workshop.restore();
    workshop.show();
    workshop.focus();
    return workshop;
  }
  workshop = new BrowserWindow({
    title: `${DISPLAY_NAME} · 角色陪伴工坊`,
    ...(windowIcon ? { icon: windowIcon } : {}),
    // Windows shows the menu inside the window; it stays out of the way until Alt is pressed.
    ...(process.platform === 'win32' ? { autoHideMenuBar: true } : {}),
    width: 1400,
    height: 960,
    minWidth: 880,
    minHeight: 660,
    backgroundColor: '#f7f8f4',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  secureWindow(workshop);
  finishSavesBeforeClose(workshop);
  workshop.once('ready-to-show', () => workshop?.show());
  workshop.on('closed', () => {
    workshop = null;
  });
  loadWindow(workshop).catch((error) => dialog.showErrorBox(`无法启动 ${DISPLAY_NAME}`, error.message));
  return workshop;
}
function updatePetLayout(state) {
  if (!pet || pet.isDestroyed() || !state) return;
  const current = pet.getBounds();
  const skin = state.skins.find(
    (s) => s.id === state.activeSkinId && s.characterId === state.activeCharacterId,
  );
  const character = state.characters.find((c) => c.id === state.activeCharacterId);
  if (!character || !require('./persona.cjs').usableSkin(skin, character)) {
    pet.close();
    return;
  }
  const animation =
    skin?.sprite ||
    require('../shared/cyrene-motion-pack.json').entries.find(
      (e) => e.builtin === skin?.builtin && !skin?.images.neutral,
    )?.animation;
  petAspect = animation ? animation.width / animation.height : skin?.style === 'powerpuff' ? 1 : 0.75;
  // While the pet is being resized live, the saved scale catches up afterwards; never undo it.
  if (Date.now() < liveScaleUntil) return;
  const next = require('./pet-layout.cjs').petBounds(
    state.settings.petSize,
    petAspect,
    petArea(current),
    current,
    state.settings.petScale,
  );
  if (Object.keys(next).some((key) => next[key] !== current[key])) pet.setBounds(next);
  reportPetRoom();
}
let petAspect = 0.75,
  liveScaleUntil = 0;
// The work area of the display her figure is on (the window's bands may hang past its edges).
function petArea(bounds) {
  return screen.getDisplayNearestPoint(require('./pet-layout.cjs').figureCentre(bounds)).workArea;
}
// Where she was left on the desktop, so she reopens there instead of at the bottom right.
const petPlaceFile = () => path.join(app.getPath('userData'), 'pet-place.json');
let petPlaceTimer = null,
  lastRoom = '';
function rememberPetPlace() {
  clearTimeout(petPlaceTimer);
  petPlaceTimer = setTimeout(() => {
    if (!pet || pet.isDestroyed()) return;
    const { x, y, width, height } = pet.getBounds();
    void fs
      .writeFile(petPlaceFile(), JSON.stringify({ x, y, width, height }), { mode: 0o600 })
      .catch(() => {});
  }, 800);
}
async function savedPetPlace() {
  try {
    const value = JSON.parse(await fs.readFile(petPlaceFile(), 'utf8'));
    return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value?.[key])) &&
      value.width > 0 &&
      value.height > 0 &&
      value.width < 20000 &&
      value.height < 20000
      ? { x: value.x, y: value.y, width: value.width, height: value.height }
      : null;
  } catch {
    return null;
  }
}
// Which parts of the bands above and below her are on screen, for the page to place her speech
// and the controls where they can be seen.
function reportPetRoom() {
  if (!pet || pet.isDestroyed()) return;
  const bounds = pet.getBounds();
  const room = require('./pet-layout.cjs').petRoom(bounds, petArea(bounds));
  const key = `${room.above}:${room.below}`;
  if (key === lastRoom) return;
  lastRoom = key;
  pet.webContents.send('mori:pet-room', room);
}
function movePetTo(x, y, free = false) {
  const bounds = pet.getBounds();
  const area = petArea({ ...bounds, x, y });
  const position = require('./pet-layout.cjs').clampPetPosition(
    x,
    y,
    bounds,
    area,
    petAspect,
    free ? bounds.width : 0,
  );
  pet.setPosition(position.x, position.y);
  reportPetRoom();
  rememberPetPlace();
  return pet.getBounds();
}
async function createPet() {
  const state = await store.loadState();
  const character = state?.characters.find((c) => c.id === state.activeCharacterId);
  if (
    !character ||
    !state.skins.some((s) => s.id === state.activeSkinId && require('./persona.cjs').usableSkin(s, character))
  )
    throw new Error('请先为当前角色选择已核对的外观，再打开桌宠。');
  if (pet && !pet.isDestroyed()) {
    updatePetLayout(state);
    pet.show();
    return;
  }
  const saved = await savedPetPlace();
  const start = require('./pet-layout.cjs').petBounds(
    state.settings.petSize,
    petAspect,
    saved ? petArea(saved) : screen.getPrimaryDisplay().workArea,
    saved || undefined,
    state.settings.petScale,
  );
  lastRoom = '';
  pet = new BrowserWindow({
    title: `${DISPLAY_NAME} 桌宠`,
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...start,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // The user is nearly always working in another app: the first click on her (a pat, a grab,
    // a toolbar button) must reach her rather than only bring her window forward.
    acceptFirstMouse: true,
    // Her bands may hang past the screen edges so that she can stand right at them.
    enableLargerThanScreen: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  secureWindow(pet);
  updatePetLayout(state);
  pet.setAlwaysOnTop(true, 'floating');
  pet.once('ready-to-show', () => pet?.showInactive());
  pet.webContents.on('did-finish-load', () => {
    lastRoom = '';
    reportPetRoom();
  });
  // She is on every Space, full-screen apps included; moving to another one, she follows from
  // the side the user came from: switching to the Space on the right, she runs in from the left.
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  require('./desktop-surfaces.cjs').onSpaceChange(({ display, from }) => {
    if (!pet || pet.isDestroyed()) return;
    const shown = screen.getDisplayNearestPoint(require('./pet-layout.cjs').figureCentre(pet.getBounds()));
    if (shown.id === display) pet.webContents.send('mori:space-changed', { from });
  });
  pet.on('move', () => {
    reportPetRoom();
    rememberPetPlace();
  });
  pet.on('closed', () => {
    pet = null;
    require('./desktop-surfaces.cjs').stopWatching();
  });
  require('./desktop-surfaces.cjs').startWatching();
  loadWindow(pet, true).catch((error) => dialog.showErrorBox('无法打开桌宠', error.message));
}

app.whenReady().then(async () => {
  // Menus and the About panel say Demiurge (the default menu would use the internal name).
  app.setAboutPanelOptions({
    applicationName: DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'Demiurge（原 Mori）',
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: DISPLAY_NAME,
        submenu: [
          { role: 'about', label: `关于 ${DISPLAY_NAME}` },
          { type: 'separator' },
          // Hiding the app is a macOS idea.
          ...(process.platform === 'darwin'
            ? [
                { role: 'hide', label: `隐藏 ${DISPLAY_NAME}` },
                { role: 'hideOthers', label: '隐藏其他' },
                { role: 'unhide', label: '全部显示' },
                { type: 'separator' },
              ]
            : []),
          { role: 'quit', label: `退出 ${DISPLAY_NAME}` },
        ],
      },
      { role: 'editMenu', label: '编辑' },
      { role: 'viewMenu', label: '显示' },
      { role: 'windowMenu', label: '窗口' },
    ]),
  );
  try {
    await workspaceBackup.recoverInterruptedImport(app.getPath('userData'));
  } catch (error) {
    dialog.showErrorBox(
      '工作区恢复需要处理',
      error.message + '\n原始副本仍保留，未加载工作区。数据目录：' + app.getPath('userData'),
    );
    app.exit(1);
    return;
  }
  store = createStore({ dir: app.getPath('userData'), safeStorage });
  const modelsDir = path.join(app.getPath('userData'), 'models');
  modelPipeline = require('./model-pipeline.cjs').createModelPipeline({
    root: path.join(app.getPath('userData'), 'model-jobs'),
    services,
    installBytes: (bytes, characterId, name) => installGeneratedModel(bytes, modelsDir, characterId, name),
  });
  petPipeline = require('./pet-pipeline.cjs').createPetPipeline({
    root: path.join(app.getPath('userData'), 'pet-jobs'),
    services,
    codec: {
      decode: (bytes) => {
        const image = nativeImage.createFromBuffer(bytes);
        return image.isEmpty() ? null : { ...image.getSize(), bitmap: image.toBitmap() };
      },
      encode: (bitmap, width, height) =>
        nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG(),
    },
    installSkin: async (candidate, digest, replaces) => {
      const base = await store.loadState();
      const character = base?.characters.find((c) => c.id === candidate.characterId);
      if (!character || require('./references.cjs').referencePack(character).digest !== digest)
        throw new Error('角色或参考图刚发生变化，动画结果已留在任务中，请核对后处理。');
      if (base.skins.some((s) => s.id === candidate.id)) return;
      // A repacked result takes the old one's place unless that one was approved or is in use.
      const old =
        replaces && base.skins.find((s) => s.id === replaces && s.characterId === candidate.characterId);
      const drop = old && old.review?.status !== 'approved' && base.activeSkinId !== old.id;
      const skins = [...base.skins.filter((s) => !(drop && s.id === old.id)), candidate];
      const saved = await store.saveMergedState({ ...base, skins }, base);
      broadcast(saved);
    },
  });
  protocol.handle('mori-asset', async (request) => {
    try {
      // Stored animation atlases (content-addressed) or installed model files.
      const stored = require('./skin-assets.cjs').ASSET.exec(request.url);
      const file = stored
        ? path.join(store.assetDir, `${stored[1]}.png`)
        : resolveAsset(modelsDir, request.url);
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const policy = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${devUrl ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: mori-asset:; font-src 'self'; media-src 'self' data: blob:; connect-src 'self' mori-asset: blob:${devUrl ? ' ws://127.0.0.1:*' : ''}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
  handle('load', async () => ({
    state: await store.retryLoadState(),
    keys: await store.getKeyStatus(),
    chatStatus,
  }));
  handle('save', async (_event, value, base) => {
    const clean = validateState(value);
    const merged = await store.saveMergedState(clean, base);
    broadcast(merged);
    return merged;
  });
  handle('save-settings', async (_event, settings, credentials, baseSettings) => {
    validateSettings(settings);
    bound(credentials, 30000);
    const keys = await store.saveSettings(settings, credentials, baseSettings);
    for (const window of [workshop, pet])
      if (window && !window.isDestroyed()) window.webContents.send('mori:keys-changed', keys);
    const state = await store.loadState();
    if (state) broadcast(state);
    return keys;
  });
  handle('research', (event, input) =>
    job(event, 'research', async (progress) => {
      bound(input, 18000);
      if (
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.length > 80 ||
        typeof input.work !== 'string' ||
        typeof input.notes !== 'string' ||
        input.notes.length > 3000 ||
        input.work.length > 200 ||
        (input.mode !== undefined && !['draft', 'links', 'search', 'saved'].includes(input.mode)) ||
        (input.urls !== undefined &&
          (!Array.isArray(input.urls) ||
            input.urls.length > 6 ||
            input.urls.some((url) => typeof url !== 'string' || url.length > 2000)))
      )
        throw new Error('请填写有效的角色名和补充资料。');
      const existing = input.characterId
        ? (await store.loadState())?.characters.find((c) => c.id === input.characterId)
        : undefined;
      if (input.characterId && (!existing || existing.name !== input.name || existing.work !== input.work))
        throw new Error('角色资料已变化，请重新打开资料更新窗口。');
      const { settings, credentials } = await getConfiguration();
      const result = await services.researchCharacter(
        { ...input, existingSources: existing?.sources || [] },
        settings,
        credentials,
        progress,
      );
      return validateCharacter(result);
    }),
  );
  handle('test-search', (event) =>
    job(event, 'research', async () => {
      const { settings, credentials } = await getConfiguration();
      return services.testSearchConnection(settings, credentials);
    }),
  );
  handle('chat', (event, input) =>
    chatJob(
      event,
      async (progress, signal) => {
        bound(input);
        validateCharacter(input.character);
        if (!Array.isArray(input.messages) || !Array.isArray(input.memories))
          throw new Error('聊天资料格式无效。');
        const state = await store.loadState();
        if (!state) throw new Error('角色工坊尚未初始化，请先打开主窗口。');
        const settings = state.settings;
        const character = state?.characters.find((c) => c.id === input.character.id);
        if (!character) throw new Error('请先保存角色档案。');
        const skin = state.skins.find(
          (s) =>
            s.id === (input.skinId || state.activeSkinId) &&
            require('./persona.cjs').usableSkin(s, character),
        );
        if (settings.chatMode === 'local')
          return require('./companion.cjs').localReply({
            character,
            messages: require('./conversations.cjs').requestHistory(
              state.messages[character.id] || [],
              input.messages.at(-1)?.id,
            ),
            availableActions: require('./persona.cjs').availableActions(skin),
            availableEmotions: require('./persona.cjs').availableEmotions(skin),
          });
        const credentials = await store.getCredentials();
        return await services.chatWithCharacter(
          {
            ...input,
            character,
            messages: require('./conversations.cjs').requestHistory(
              state.messages[character.id] || [],
              input.messages.at(-1)?.id,
            ),
            memories: state.memories,
            availableActions: require('./persona.cjs').availableActions(skin),
            availableEmotions: require('./persona.cjs').availableEmotions(skin),
          },
          settings,
          credentials,
          progress,
          signal,
        );
      },
      'chat',
      input?.character?.id,
    ),
  );
  handle('preview-persona', (event, input) =>
    chatJob(
      event,
      async (progress, signal) => {
        bound(input, 18000);
        if (
          typeof input.characterId !== 'string' ||
          typeof input.text !== 'string' ||
          !input.text.trim() ||
          input.text.length > 4000
        )
          throw new Error('请输入一条试聊消息。');
        const { settings, credentials } = await getConfiguration();
        const state = await store.loadState();
        const character = state?.characters.find((c) => c.id === input.characterId);
        if (!character) throw new Error('角色不存在，请先保存角色档案。');
        const skin = state.skins.find(
          (s) =>
            s.id === (input.skinId || state.activeSkinId) &&
            require('./persona.cjs').usableSkin(s, character),
        );
        const session = personaSessions.prepare({
          owner: event.sender.id,
          character,
          sessionId: input.sessionId,
          text: input.text,
        });
        const reply = await services.chatWithCharacter(
          {
            character,
            memories: [],
            messages: session.messages,
            availableActions: require('./persona.cjs').availableActions(skin),
            availableEmotions: require('./persona.cjs').availableEmotions(skin),
          },
          settings,
          credentials,
          progress,
          signal,
        );
        if (signal.aborted) throw new Error('已停止等待这次试聊。');
        return session.commit(reply);
      },
      'preview',
      input?.characterId,
    ),
  );
  handle('clear-persona-preview', (event) => personaSessions.clear(event.sender.id));
  handle('cancel-chat', (event) => {
    chatControllers.get(event.sender.id)?.abort();
  });
  handle('copy-text', (_event, value) => {
    if (typeof value !== 'string' || value.length > 5000) throw new Error('复制内容过长或无效。');
    clipboard.writeText(value);
  });
  handle('export-chat', async (event, characterId) => {
    const state = await store.loadState();
    const character = state?.characters.find((c) => c.id === characterId);
    if (!character) throw new Error('角色不存在。');
    const history = state.messages[characterId] || [];
    if (!history.length) throw new Error('还没有可以导出的对话。');
    const selected = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导出这段对话',
      defaultPath: `mori-${character.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}-chat.txt`,
      filters: [{ name: '对话文本', extensions: ['txt'] }],
    });
    if (selected.canceled || !selected.filePath) return false;
    await fs.writeFile(selected.filePath, require('./conversations.cjs').formatChat(character, history), {
      mode: 0o600,
    });
    return true;
  });
  handle('prepare-skin-generation', async (_event, input) => {
    bound(input, 2000);
    const state = await store.loadState();
    const character = state?.characters.find((c) => c.id === input.characterId);
    if (!character) throw new Error('角色不存在，请先保存角色档案。');
    const sourceSkin = input.sourceSkinId ? state.skins.find((s) => s.id === input.sourceSkinId) : undefined;
    if (input.sourceSkinId && !sourceSkin) throw new Error('所选基准图不存在。');
    const { settings, credentials } = await getConfiguration();
    return services.prepareSkinGeneration({ character, sourceSkin, mode: input.mode }, settings, credentials);
  });
  handle('start-pet-job', (event, input) =>
    job(event, 'skin', async (progress) => {
      // One optional style image is snapshotted with the job, outside its metadata.
      bound(input, 12 * 1024 * 1024);
      const styleGuide = styleReferencePack(input.styleReference);
      if (styleGuide) {
        const image = nativeImage.createFromBuffer(imageBytes(styleGuide.reference.image).bytes);
        const size = image.getSize();
        if (image.isEmpty() || size.width > 8192 || size.height > 8192)
          throw new Error('画风参考无法解码或尺寸超过 8192 像素。');
        if (
          input.sourceSkinId ||
          !Array.isArray(input.styles) ||
          !input.styles.some((style) => style !== 'original')
        )
          throw new Error('画风参考用于新建非原作画风的角色图；为已有角色图补动作时不使用。');
      }
      let state = await store.loadState();
      let character = state?.characters.find((c) => c.id === input.characterId);
      if (!character) throw new Error('请先保存角色档案。');
      const { settings, credentials } = await getConfiguration();
      // Configuration is checked before automatic collection or any billable work.
      if (settings.imageProvider !== 'codex' && (!settings.imageModel || !credentials.imageKey))
        throw new Error(
          '请先在连接设置中选择本机 Codex，或填写图像 API Key 和图像模型。Claude 聊天接口不能代替图像编辑服务。',
        );
      services.checkImageConfiguration(settings, credentials);
      if (!character.visualReferences?.length && input.autoCollect) {
        const result = await services.discoverReferences(character, settings, progress);
        const recommended = result.candidates.find(
          (c) => c.origin === 'catalog' && c.match === 'name' && /角色立绘/.test(c.name),
        );
        progress({ stage: '整理参考图', detail: '正在把宣传立绘裁到人物本身，避免装饰被画成头发或服装…' });
        const focused = recommended && (await focusReference(recommended, character, settings, credentials));
        const closeUp = recommended
          ? result.candidates.find(
              (c) => c.origin === 'catalog' && c.match === 'name' && /角色预览/.test(c.name),
            )
          : undefined;
        const next = {
          ...state,
          characters: state.characters.map((c) =>
            c.id === character.id
              ? {
                  ...c,
                  // Cropped full figure for outfit and silhouette, plus the close-up for face and ornaments.
                  ...(recommended
                    ? { visualReferences: [focused || recommended, ...(closeUp ? [closeUp] : [])] }
                    : {}),
                  // The uncropped original stays available as a candidate.
                  referenceCandidates: result.candidates.filter(
                    (c) => (c.id !== recommended?.id || focused) && c.id !== closeUp?.id,
                  ),
                  referenceWarnings: result.warnings,
                }
              : c,
          ),
        };
        state = await store.saveMergedState(next, state);
        broadcast(state);
        character = state.characters.find((c) => c.id === input.characterId);
        if (!character.visualReferences?.length)
          throw new Error(
            '已收集候选图，但没有可自动采纳的同名角色立绘。请在参考图中核对并选用一张，再继续自动制作。',
          );
      }
      const sourceSkin = input.sourceSkinId
        ? state.skins.find((s) => s.id === input.sourceSkinId && s.characterId === character.id)
        : undefined;
      if (input.sourceSkinId && !sourceSkin) throw new Error('已选基准不存在。');
      return petPipeline.start(character, { ...input, sourceSkin }, settings, credentials);
    }),
  );
  handle('advance-pet-job', (event, jobId) =>
    job(event, 'skin', async (progress) => {
      const task = await petPipeline.load(jobId);
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === task.characterId);
      if (!character) throw new Error('任务对应的角色不存在，已有素材仍保留。');
      return petPipeline.advance(jobId, character, state.settings, await store.getCredentials(), progress);
    }),
  );
  handle('list-pet-jobs', async (_event, characterId) => {
    if (typeof characterId !== 'string' || characterId.length > 128) throw new Error('角色标识无效。');
    return petPipeline.list(characterId);
  });
  // Installed results come from the workspace, where their atlases are stored files; only results
  // not installed yet are sent with their embedded images.
  handle('pet-job-results', async (_event, jobId) => {
    const results = await petPipeline.results(jobId);
    const state = await store.loadState();
    return results.map((skin) => state?.skins.find((saved) => saved.id === skin.id) || skin);
  });
  handle('pet-job-masters', async (_event, jobId) => petPipeline.masters(jobId));
  handle('pet-job-style-reference', async (_event, jobId) => petPipeline.styleReference(jobId));
  handle('retry-pet-step', (event, input) =>
    job(event, 'skin', async () => {
      bound(input, 2000);
      return petPipeline.retry(input.jobId, input.index);
    }),
  );
  handle('repack-pet-job', (event, jobId) => job(event, 'skin', async () => petPipeline.repack(jobId)));
  handle('cancel-pet-job', (event, jobId) => job(event, 'skin', async () => petPipeline.cancel(jobId)));
  handle('select-pet-base', (event, input) =>
    job(event, 'skin', async () => {
      bound(input, 2000);
      return petPipeline.selectBase(input.jobId, input.style, input.skinId);
    }),
  );
  handle('refine-pet-base', (event, input) =>
    job(event, 'skin', async (progress) => {
      bound(input, 4000);
      const task = await petPipeline.load(input.jobId);
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === task.characterId);
      if (!character) throw new Error('任务对应的角色不存在，已有素材仍保留。');
      return petPipeline.refineBase(
        input.jobId,
        input,
        character,
        state.settings,
        await store.getCredentials(),
        progress,
      );
    }),
  );
  handle('retry-pet-base-edit', (event, input) =>
    job(event, 'skin', async (progress) => {
      bound(input, 2000);
      const task = await petPipeline.load(input.jobId);
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === task.characterId);
      if (!character) throw new Error('任务对应的角色不存在，已有素材仍保留。');
      return petPipeline.retryBaseEdit(
        input.jobId,
        input.editId,
        character,
        state.settings,
        task.baseEdits?.find((edit) => edit.id === input.editId)?.status === 'unsaved'
          ? {}
          : await store.getCredentials(),
        progress,
      );
    }),
  );
  handle('revise-pet-job', (event, input) =>
    job(event, 'skin', async () => {
      bound(input, 4000);
      const task = await petPipeline.load(input.jobId);
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === task.characterId);
      if (!character) throw new Error('角色不存在。');
      return petPipeline.revise(input.jobId, input, character, state.settings);
    }),
  );
  handle('extend-pet-job', (event, input) =>
    job(event, 'skin', async () => {
      bound(input, 4000);
      const task = await petPipeline.load(input.jobId);
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === task.characterId);
      if (!character) throw new Error('角色不存在。');
      return petPipeline.extend(input.jobId, input, character, state.settings);
    }),
  );
  handle('export-workspace', async () => {
    if (runningJobs.size || chatStatus.busy) throw new Error('请等待当前任务完成后备份工作区。');
    const { canceled, filePath } = await dialog.showSaveDialog(workshop, {
      title: '导出工作区备份',
      defaultPath: `Demiurge-workspace-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Demiurge 工作区备份', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return false;
    const state = await store.loadState();
    if (!state) throw new Error('工作区尚未初始化。');
    const bytes = await workspaceBackup.exportWorkspace(app.getPath('userData'), state);
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { mode: 0o600 });
      await fs.rename(temporary, filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return true;
  });
  handle('import-workspace', async () => {
    if (runningJobs.size || chatStatus.busy) throw new Error('请等待当前任务完成后恢复工作区。');
    let relaunch = false;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(workshop, {
        title: '从备份恢复工作区',
        properties: ['openFile'],
        filters: [{ name: 'Demiurge 工作区备份', extensions: ['zip'] }],
      });
      if (canceled || !filePaths[0]) return false;
      const stat = await fs.stat(filePaths[0]);
      if (!stat.isFile() || stat.size > 600 * 1024 * 1024) throw new Error('工作区备份文件过大或无效。');
      // Drain prior serialized state writes before replacing workspace files.
      await store.getRecoveryStatus();
      await workspaceBackup.importWorkspace(app.getPath('userData'), await fs.readFile(filePaths[0]));
      relaunch = true;
      return true;
    } catch (error) {
      if (error.recoveryRequired) {
        relaunch = true;
        dialog.showErrorBox(
          '工作区恢复尚未完成',
          error.message + '\nDemiurge 将重新启动以继续恢复，原工作区副本仍保留。',
        );
      }
      throw error;
    } finally {
      if (relaunch) {
        workspaceGate.seal();
        app.relaunch();
        setTimeout(() => app.exit(0), 200);
      }
    }
  });
  handle('get-recovery-status', async () => store.getRecoveryStatus());
  handle('restore-previous-state', async () => {
    if (runningJobs.size || chatStatus.busy) throw new Error('请等待当前任务完成后恢复存档。');
    const state = await store.restorePreviousState();
    broadcast(state);
    return { state, keys: await store.getKeyStatus() };
  });
  handle('reset-credentials', async () => {
    if (runningJobs.size || chatStatus.busy) throw new Error('请等待当前任务完成后重新配置密钥。');
    const keys = await store.resetCredentials();
    for (const window of [workshop, pet])
      if (window && !window.isDestroyed()) window.webContents.send('mori:keys-changed', keys);
    return keys;
  });
  handle('open-data-directory', async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error('无法打开数据目录：' + error);
  });
  handle('generate-skin', (event, input) =>
    job(event, 'skin', async (progress) => {
      bound(input, 8192);
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === input.characterId);
      if (!character) throw new Error('角色不存在，请先保存角色档案。');
      const sourceSkin = input.sourceSkinId
        ? state.skins.find((s) => s.id === input.sourceSkinId)
        : undefined;
      if (input.sourceSkinId && !sourceSkin) throw new Error('所选基准图不存在。');
      const programSkin = input.programSkinId
        ? state.skins.find((s) => s.id === input.programSkinId && s.characterId === input.characterId)
        : undefined;
      if (input.programSkinId && (!programSkin || input.mode !== 'program'))
        throw new Error('程序动画修正候选不存在或制作方式不匹配。');
      const { settings, credentials } = await getConfiguration();
      const result = await services.generateSkin(
        {
          character,
          style: input.style,
          sourceSkin,
          referenceDigest: input.referenceDigest,
          mode: input.mode,
          programSkin,
          feedback: input.feedback,
        },
        settings,
        credentials,
        progress,
      );
      return validateSkin(result);
    }),
  );
  handle('generate-expressions', (event, input) =>
    job(event, 'skin', async (progress) => {
      bound(input, 2000);
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === input.characterId);
      const skin = state?.skins.find((s) => s.id === input.skinId && s.characterId === input.characterId);
      if (!character || !skin) throw new Error('角色或基准图不存在，请先保存。');
      const { settings, credentials } = await getConfiguration();
      const result = await services.generateExpressions({ character, skin }, settings, credentials, progress);
      return { ...result, skin: validateSkin(result.skin) };
    }),
  );
  handle('review-skin', async (_event, input) => {
    bound(input, 2000);
    const state = await store.loadState();
    const character = state?.characters.find((c) => c.id === input.characterId);
    const skin = state?.skins.find((s) => s.id === input.skinId && s.characterId === input.characterId);
    if (!character || !skin) throw new Error('角色或候选图不存在。');
    return validateSkin(reviewSkin(character, skin, input.decision, input.frameReview));
  });
  async function importReferenceImages(event, styleOnly = false) {
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: styleOnly
        ? '添加画风参考（仅参考画法，选择 1 张）'
        : '添加角色参考原图（同一角色与服装，最多 4 张）',
      properties: styleOnly ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [{ name: '参考原图', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selected.canceled) return [];
    if (selected.filePaths.length > (styleOnly ? 1 : 4))
      throw new Error(styleOnly ? '画风参考只能选择一张图片。' : '每个角色最多保存 4 张参考图。');
    const references = [];
    for (const file of selected.filePaths) {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
        throw new Error('每张参考图需要是小于 8 MiB 的图片文件。');
      const bytes = await fs.readFile(file);
      const decoded = nativeImage.createFromBuffer(bytes);
      const size = decoded.getSize();
      if (decoded.isEmpty() || size.width > 8192 || size.height > 8192)
        throw new Error('参考图无法解码或尺寸超过 8192 像素。');
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg';
      references.push({
        id: randomUUID(),
        name: path.basename(file),
        image: `data:image/${mime};base64,${bytes.toString('base64')}`,
        createdAt: new Date().toISOString(),
      });
    }
    return validateReferences(references);
  }
  handle('import-references', async (event) => importReferenceImages(event));
  handle('import-style-reference', async (event) => (await importReferenceImages(event, true))[0] || null);
  handle('discover-references', (event, characterId) =>
    job(event, 'references', async (progress) => {
      if (typeof characterId !== 'string' || characterId.length > 128) throw new Error('角色标识无效。');
      const base = await store.loadState();
      const character = base?.characters.find((c) => c.id === characterId);
      if (!character) throw new Error('请先保存角色档案。');
      const result = await services.discoverReferences(character, base.settings, progress);
      const recommended = !character.visualReferences?.length
        ? result.candidates.find(
            (c) => c.origin === 'catalog' && c.match === 'name' && /角色立绘/.test(c.name),
          )
        : undefined;
      if (recommended)
        progress({ stage: '整理参考图', detail: '正在把宣传立绘裁到人物本身，避免装饰被画成头发或服装…' });
      const focused =
        recommended &&
        (await focusReference(recommended, character, base.settings, await store.getCredentials()));
      const closeUp = recommended
        ? result.candidates.find(
            (c) => c.origin === 'catalog' && c.match === 'name' && /角色预览/.test(c.name),
          )
        : undefined;
      const next = {
        ...base,
        characters: base.characters.map((c) =>
          c.id === characterId
            ? {
                ...c,
                // Cropped full figure for outfit and silhouette, plus the close-up for face and ornaments.
                ...(recommended
                  ? { visualReferences: [focused || recommended, ...(closeUp ? [closeUp] : [])] }
                  : {}),
                // The uncropped original stays available as a candidate.
                referenceCandidates: result.candidates.filter(
                  (candidate) =>
                    (candidate.id !== recommended?.id || focused) && candidate.id !== closeUp?.id,
                ),
                referenceWarnings: result.warnings,
              }
            : c,
        ),
      };
      const saved = await store.saveMergedState(next, base);
      broadcast(saved);
      return saved;
    }),
  );
  handle('focus-reference', (event, input) =>
    job(event, 'references', async (progress) => {
      const { characterId, referenceId } = input || {};
      if (typeof characterId !== 'string' || typeof referenceId !== 'string')
        throw new Error('参考图标识无效。');
      const base = await store.loadState();
      const character = base?.characters.find((c) => c.id === characterId);
      const reference = character?.visualReferences?.find((r) => r.id === referenceId);
      if (!reference) throw new Error('参考图不存在。');
      const { settings, credentials } = await getConfiguration();
      if (settings.llmProtocol !== 'codex' && !(credentials.llmKey && settings.llmModel))
        throw new Error('识别人物位置需要聊天服务。请先在连接设置中选择本机 Codex，或配置可看图的聊天模型。');
      progress({ stage: '整理参考图', detail: '正在识别人物位置并裁掉宣传装饰…' });
      const focused = await focusReference(reference, character, settings, credentials);
      if (!focused) throw new Error('这张图已经以人物为主，或没能识别出单一人物，未做裁切。');
      const next = {
        ...base,
        characters: base.characters.map((c) =>
          c.id === characterId
            ? {
                ...c,
                visualReferences: c.visualReferences.map((r) => (r.id === referenceId ? focused : r)),
                referenceCandidates: [reference, ...(c.referenceCandidates || [])].slice(0, 12),
              }
            : c,
        ),
      };
      const saved = await store.saveMergedState(next, base);
      broadcast(saved);
      return saved;
    }),
  );
  handle('start-model-job', (event, characterId) =>
    job(event, 'model', async () => {
      if (typeof characterId !== 'string' || characterId.length > 128) throw new Error('角色标识无效。');
      const state = await store.loadState();
      const character = state?.characters.find((c) => c.id === characterId);
      if (!character) throw new Error('角色不存在。');
      return modelPipeline.start(character, state.settings, await store.getCredentials());
    }),
  );
  handle('use-reference-image', async (_event, characterId) => {
    if (typeof characterId !== 'string' || characterId.length > 128) throw new Error('角色标识无效。');
    const state = await store.loadState();
    const character = state?.characters.find((c) => c.id === characterId);
    const ref = character?.visualReferences?.[0];
    if (!ref) throw new Error('请先收集并保存主参考图。');
    const existing = state.skins.find(
      (skin) =>
        skin.characterId === characterId &&
        skin.kind === 'image' &&
        !skin.generated &&
        skin.images.neutral === ref.image,
    );
    if (existing) return existing;
    return validateSkin({
      id: randomUUID(),
      characterId,
      name: `${character.name} · 来源原图立绘`,
      style: 'anime',
      kind: 'image',
      images: { neutral: ref.image },
      generated: false,
      createdAt: new Date().toISOString(),
    });
  });
  handle('advance-model-job', (event, jobId) =>
    job(event, 'model', async () => {
      const { settings, credentials } = await getConfiguration();
      const result = await modelPipeline.advance(jobId, settings, credentials);
      return { ...result, ...(result.skin ? { skin: validateSkin(result.skin) } : {}) };
    }),
  );
  handle('recover-model-job', (event, input) =>
    job(event, 'model', async () => {
      bound(input, 1000);
      const { settings, credentials } = await getConfiguration();
      return modelPipeline.recover(input.jobId, input.taskId, settings, credentials);
    }),
  );
  handle('list-model-jobs', async (_event, characterId) => {
    if (typeof characterId !== 'string' || characterId.length > 128) throw new Error('角色标识无效。');
    const state = await store.loadState();
    if (!state?.characters.some((c) => c.id === characterId)) throw new Error('角色不存在。');
    const result = await modelPipeline.list(characterId);
    return result.map((j) => ({ ...j, ...(j.skin ? { skin: validateSkin(j.skin) } : {}) }));
  });
  handle('import-model', async (event, characterId, kind) => {
    const state = await store.loadState();
    if (!state?.characters.some((c) => c.id === characterId) || !['live2d', 'vrm'].includes(kind))
      throw new Error('角色或模型类型无效。');
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: kind === 'live2d' ? '导入 Live2D 模型（model3.json 或 ZIP）' : '导入 VRM 模型',
      properties: ['openFile'],
      filters: [{ name: '角色模型', extensions: kind === 'live2d' ? ['json', 'zip'] : ['vrm'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return installModel(selected.filePaths[0], kind, modelsDir, characterId);
  });
  handle('import-sprite', async (event, characterId, style) => {
    const state = await store.loadState();
    if (!state?.characters.some((c) => c.id === characterId)) throw new Error('角色无效。');
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导入逐帧动画（Aseprite JSON 或 Demiurge / Mori 动画包，PNG 与 JSON 放在一起）',
      properties: ['openFile'],
      filters: [{ name: '动画时间线', extensions: ['json'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const skin = await require('./sprites.cjs').readSprite(
      selected.filePaths[0],
      characterId,
      style,
      (bytes) => {
        const image = nativeImage.createFromBuffer(bytes);
        return image.isEmpty() ? null : image.getSize();
      },
    );
    return validateSkin(skin);
  });
  handle('import-frames', async (event, characterId, style) => {
    const state = await store.loadState();
    if (!state?.characters.some((c) => c.id === characterId)) throw new Error('角色无效。');
    if (!Object.hasOwn(require('../shared/art-styles.json'), style)) throw new Error('画风无效。');
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导入 PNG 动作文件夹（包含 idle、wave 等子文件夹）',
      properties: ['openDirectory'],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return validateSkin(
      await require('./sprite-sequences.cjs').readSequenceFolder(selected.filePaths[0], characterId, style, {
        decode: (bytes) => {
          const image = nativeImage.createFromBuffer(bytes);
          return image.isEmpty() ? null : { ...image.getSize(), bitmap: image.toBitmap() };
        },
        encode: (bitmap, width, height) =>
          nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG(),
      }),
    );
  });
  handle('import-image', async (event, characterId, style) => {
    const state = await store.loadState();
    if (!state?.characters.some((c) => c.id === characterId)) throw new Error('角色无效。');
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导入角色立绘',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const file = selected.filePaths[0];
    const stat = await fs.stat(file);
    if (stat.size > 8 * 1024 * 1024) throw new Error('图片需要小于 8 MiB。');
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg';
    const skin = {
      id: randomUUID(),
      characterId,
      name: path.basename(file),
      style,
      kind: 'image',
      images: { neutral: `data:image/${mime};base64,${(await fs.readFile(file)).toString('base64')}` },
      generated: false,
      createdAt: new Date().toISOString(),
    };
    return validateBundle({
      version: 1,
      character: state.characters.find((c) => c.id === characterId),
      skins: [skin],
    }).skins[0];
  });
  handle('speak', async (_event, value) => {
    const { settings, credentials } = await getConfiguration();
    if (typeof value !== 'string' || value.length > 5000) throw new Error('语音文本无效。');
    return services.synthesizeSpeech(value, settings, credentials);
  });
  handle('test-connection', async () => {
    const { settings, credentials } = await getConfiguration();
    return services.testConnection(settings, credentials);
  });
  handle('desktop-scene', async (event, icons) => {
    if (!pet || event.sender !== pet.webContents) throw Error('请在桌宠窗口中探索桌面。');
    const bounds = pet.getBounds(),
      area = petArea(bounds);
    const windows = await require('./desktop-surfaces.cjs').desktopSurfaces({ x: 0, y: 0 });
    const targets =
      icons === true
        ? await require('./desktop-icons.cjs').desktopIcons({ x: 0, y: 0 })
        : { icons: [], supported: true };
    const { top, bottom } = require('./pet-layout.cjs').bands;
    return {
      bounds,
      area,
      // How far the window may hang past the top and bottom of the work area.
      // The band below her stays on screen (her toolbar opens there), so only the top may hang past.
      margins: { top, bottom: 0 },
      at: Number.isFinite(windows.at) ? windows.at : Date.now(),
      surfaces: windows.surfaces,
      // What the user is doing: the front app, its window, and seconds since typing or pointing.
      ...(windows.activity ? { activity: windows.activity } : {}),
      icons: targets.icons,
      supported: windows.supported,
      reason: windows.reason || targets.reason,
    };
  });
  handle('step-pet', (event, target) => {
    if (
      !pet ||
      event.sender !== pet.webContents ||
      !Number.isFinite(target?.x) ||
      !Number.isFinite(target?.y)
    )
      throw Error('桌宠位置无效');
    const bounds = pet.getBounds();
    // A free step may take her just past a side of the screen, to run in from there.
    // A jump goes there at once (vanishing and reappearing, or starting just off screen).
    if (target.jump === true) return movePetTo(target.x, target.y, target.free === true);
    return movePetTo(
      bounds.x + Math.max(-150, Math.min(150, target.x - bounds.x)),
      bounds.y + Math.max(-150, Math.min(150, target.y - bounds.y)),
      target.free === true,
    );
  });
  handle('open-pet', () => createPet());
  handle('close-pet', () => {
    pet?.close();
  });
  handle('open-workshop', () => {
    createWorkshop();
  });
  handle('open-external', async (_event, address) => {
    if (typeof address !== 'string' || address.length > 4096) throw new Error('无效链接。');
    const url = new URL(address);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('仅允许普通网页链接。');
    await shell.openExternal(url.href);
  });
  handle('export-character', async (event, input) => {
    bound(input, MAX_FILE_BYTES);
    // A character pack is self-contained: stored atlases go back in as embedded images.
    const bundle = await require('./character-packs.cjs').portableBundle(
      input.character,
      await store.inlineAssets(Array.isArray(input.skins) ? input.skins : []),
      require('./artwork.cjs').artDirectory(),
    );
    const selected = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导出角色包',
      defaultPath: `demiurge-${bundle.character.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.json`,
      filters: [{ name: 'Demiurge 角色包', extensions: ['json'] }],
    });
    if (selected.canceled || !selected.filePath) return false;
    await fs.writeFile(selected.filePath, JSON.stringify(bundle, null, 2), { mode: 0o600 });
    return true;
  });
  // The community catalogue (electron/community.cjs): read-only downloads, checked and validated.
  const community = () =>
    require('./community.cjs').createCommunity({
      fetch: (...args) => globalThis.fetch(...args),
      dir: app.getPath('userData'),
      validateBundle,
      validateDesktopProfile: require('./store.cjs').validateDesktopProfile,
    });
  handle('community-catalogue', () => community().catalogue());
  handle('community-pet', (_event, id) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('桌宠编号无效。');
    return community().pet(id, MAX_FILE_BYTES);
  });
  handle('community-install-plugin', (_event, id) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('插件编号无效。');
    return community().installPlugin(id);
  });
  handle('community-plugins', () => community().plugins());
  handle('community-remove-plugin', (_event, id) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('插件编号无效。');
    return community().removePlugin(id);
  });
  handle('community-share', async () => {
    await shell.openExternal(require('./community.cjs').SHARE_URL);
  });
  handle('import-character', async (event) => {
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导入角色包',
      properties: ['openFile'],
      filters: [{ name: 'Demiurge 角色包', extensions: ['json'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const file = selected.filePaths[0];
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('角色包过大或不是普通文件。');
    return validateBundle(JSON.parse(await fs.readFile(file, 'utf8')));
  });
  ipcMain.on('mori:move-pet', (event, delta) => {
    if (
      !isTrusted(event) ||
      !pet ||
      event.sender !== pet.webContents ||
      !Number.isFinite(delta?.x) ||
      !Number.isFinite(delta?.y)
    )
      return;
    const [x, y] = pet.getPosition();
    movePetTo(
      x + Math.max(-150, Math.min(150, Math.round(delta.x))),
      y + Math.max(-150, Math.min(150, Math.round(delta.y))),
    );
  });
  // Live resizing while the user scrolls or pinches over the pet; the renderer saves the final
  // scale a moment later, and the layout then lands on the same bounds.
  ipcMain.on('mori:scale-pet', (event, scale) => {
    if (!isTrusted(event) || !pet || event.sender !== pet.webContents || !Number.isFinite(scale)) return;
    const current = pet.getBounds();
    liveScaleUntil = Date.now() + 1500;
    pet.setBounds(
      require('./pet-layout.cjs').petBounds('medium', petAspect, petArea(current), current, scale),
    );
    reportPetRoom();
    rememberPetPlace();
  });
  // Seconds since the last keyboard or mouse input anywhere, so the character asks for attention
  // at a pause rather than in the middle of the user's typing.
  handle('user-idle', () => powerMonitor.getSystemIdleTime());
  ipcMain.on('mori:pet-click-through', (event, enabled) => {
    if (isTrusted(event) && pet && event.sender === pet.webContents && typeof enabled === 'boolean')
      pet.setIgnoreMouseEvents(enabled, { forward: true });
  });
  // Atlases of deleted or replaced looks are removed a little after startup.
  setTimeout(() => void store.collectAssets().catch(() => {}), 60000);
  createWorkshop();
  screen.on('display-metrics-changed', () => {
    void store
      .loadState()
      .then(updatePetLayout)
      .catch(() => {});
  });
  screen.on('display-removed', () => {
    void store
      .loadState()
      .then(updatePetLayout)
      .catch(() => {});
  });
  app.on('activate', () => createWorkshop());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
