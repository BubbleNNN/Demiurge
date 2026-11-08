'use strict';
// A Node coordinator runs two genuine Electron processes against isolated data.
// The first imports through the UI and exits; the second verifies the fresh startup.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { unzipSync } = require('fflate');
const { validateState } = require('../electron/store.cjs');
const modelId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const timestamp = '2026-10-22T00:00:00.000Z';
const secret = 'isolated-workspace-secret-not-for-export';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(root, name, value) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(
    path.join(root, name),
    typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value,
  );
}
function fixtureState(label) {
  const image = require('../tests/fixtures/pet-images.cjs').url(
    require('../tests/fixtures/pet-images.cjs').image(),
  );
  return validateState({
    settings: {
      llmBaseUrl: 'https://never-call.example/v1',
      llmModel: '',
      chatMode: 'local',
      imageBaseUrl: 'https://never-call.example/v1',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
      voiceEnabled: false,
    },
    characters: [
      {
        id: 'recovery-character',
        name: label,
        work: '隔离恢复验收',
        summary: label,
        personality: ['温和'],
        speakingStyle: '',
        appearance: '',
        quotes: [],
        sources: [],
        unknowns: [],
        behavior: { energy: 50, affection: 50, curiosity: 50 },
        createdAt: timestamp,
      },
    ],
    skins: [
      {
        id: 'display-image',
        characterId: 'recovery-character',
        name: '固定测试图',
        style: 'chibi',
        kind: 'image',
        images: { neutral: image },
        generated: false,
        createdAt: timestamp,
      },
      {
        id: 'archived-model',
        characterId: 'recovery-character',
        name: '备份模型',
        style: '3d',
        kind: 'vrm',
        images: {},
        generated: false,
        createdAt: timestamp,
        model: { id: modelId, entry: 'avatar.vrm', expressions: [], motions: {} },
      },
    ],
    activeCharacterId: 'recovery-character',
    activeSkinId: 'display-image',
    messages: {
      'recovery-character': [
        {
          id: 'fixture-message',
          role: 'user',
          content: `Private conversation ${label}`,
          createdAt: timestamp,
        },
      ],
    },
    memories: [
      {
        id: 'fixture-memory',
        characterId: 'recovery-character',
        text: `Private memory ${label}`,
        createdAt: timestamp,
      },
    ],
    revision: 1,
  });
}
function populate(root, label) {
  const state = fixtureState(label);
  write(root, 'state.json', state);
  write(root, `models/${modelId}/avatar.vrm`, `isolated model fixture ${label}`);
  write(root, `models/${modelId}/textures/色彩.png`, Buffer.from([0, 1, 2, 3, label.length]));
  write(root, 'pet-jobs/task.asset.json', { image: `pet artifact ${label}` });
  write(root, 'model-jobs/task.json', { status: 'ready', taskId: `model artifact ${label}` });
  return state;
}

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  (async () => {
    const dir = path.resolve(__dirname, '../.local/workspace-recovery-desktop-' + randomUUID());
    const target = path.join(dir, 'target'),
      source = path.join(dir, 'source');
    fs.mkdirSync(dir, { recursive: true });
    const previous = populate(target, '恢复前的角色');
    write(target, 'state.previous.json', previous);
    write(target, 'state.json', '{broken original state');
    write(target, 'credentials.enc.json', {
      version: 1,
      data: Buffer.from('broken-original-keys').toString('base64'),
    });
    write(target, 'Cache/private-fixture', 'cache-must-not-export');
    const incoming = populate(source, '从备份导入的角色');
    const zip = await require('../electron/workspace-backup.cjs').exportWorkspace(source, incoming);
    write(dir, 'incoming.zip', zip);
    write(dir, 'expected.json', { previous, incoming });
    const run = (phase) =>
      new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename, phase, dir], { env, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`))));
      });
    await run('recovery');
    assert.equal(readJson(path.join(dir, 'import-phase.json')).relaunchRequested, true);
    await run('verify');
    console.log(
      'PASS: real Electron corrupt-state recovery, credential reset, workspace ZIP export/import and fresh-process verification. No network or real user data.',
    );
    console.log('Artifacts: ' + dir);
  })().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
} else {
  const { app, dialog, safeStorage, shell } = require('electron');
  const [phase, dir] = process.argv.slice(2),
    target = path.join(dir, 'target');
  const expected = readJson(path.join(dir, 'expected.json'));
  process.env.MORI_DATA_DIR = target;
  delete process.env.MORI_DEV_URL;
  safeStorage.isEncryptionAvailable = () => true;
  safeStorage.getSelectedStorageBackend = () => 'fixture-encrypted';
  safeStorage.encryptString = (text) => Buffer.from('fixture:' + text);
  safeStorage.decryptString = (bytes) => {
    const text = bytes.toString();
    if (!text.startsWith('fixture:')) throw new Error('Fixture old keychain is unavailable');
    return text.slice(8);
  };
  global.fetch = async () => {
    throw new Error('Unexpected network request in recovery test');
  };
  let openedDirectory = 0,
    confirmationSeen = false,
    relaunchRequested = false,
    completed = false,
    win;
  let releaseModelDialog,
    exportDialogs = 0,
    importDialogs = 0,
    operationGateChecked = false;
  shell.openPath = async (directory) => {
    assert.equal(directory, target);
    openedDirectory++;
    return '';
  };
  dialog.showSaveDialog = async () => {
    exportDialogs++;
    return { canceled: false, filePath: path.join(dir, 'exported.zip') };
  };
  dialog.showOpenDialog = async (_owner, options) => {
    if (options.title === '导入 VRM 模型')
      return new Promise((resolve) => {
        releaseModelDialog = resolve;
      });
    importDialogs++;
    return { canceled: false, filePaths: [path.join(dir, 'incoming.zip')] };
  };
  dialog.showErrorBox = (title, message) => {
    throw new Error(`${title}: ${message}`);
  };
  app.relaunch = () => {
    relaunchRequested = true;
  };
  const realExit = app.exit.bind(app);
  const deadline = setTimeout(() => finish(new Error(`Recovery desktop ${phase} timed out`)), 60000);
  async function finish(error) {
    if (completed) return;
    completed = true;
    clearTimeout(deadline);
    if (error) {
      console.error(error.stack);
      if (win && !win.isDestroyed()) {
        console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-9000));
        write(dir, `${phase}-failure.png`, (await win.webContents.capturePage()).toPNG());
      }
    }
    realExit(error ? 1 : 0);
  }
  app.exit = (code) => {
    if (phase === 'recovery' && relaunchRequested && code === 0) {
      try {
        const imported = readJson(path.join(target, 'state.json'));
        assert.deepEqual(imported, expected.incoming);
        assert.equal(
          fs.readFileSync(path.join(target, `models/${modelId}/avatar.vrm`), 'utf8'),
          'isolated model fixture 从备份导入的角色',
        );
        const recoveryDirectory = fs.readdirSync(target).find((name) => name.startsWith('recovery-'));
        assert.ok(recoveryDirectory);
        const saved = readJson(path.join(target, recoveryDirectory, 'state.json'));
        assert.deepEqual(saved.characters, expected.previous.characters);
        assert.deepEqual(saved.messages, expected.previous.messages);
        assert.equal(
          fs.readFileSync(path.join(target, recoveryDirectory, `models/${modelId}/avatar.vrm`), 'utf8'),
          'isolated model fixture 恢复前的角色',
        );
        assert.equal(
          safeStorage
            .decryptString(Buffer.from(readJson(path.join(target, 'credentials.enc.json')).data, 'base64'))
            .includes(secret),
          true,
        );
        write(dir, 'import-phase.json', {
          operationGateChecked,
          relaunchRequested,
          confirmationSeen,
          openedDirectory,
          recoveryDirectory,
          importedStateMatches: true,
          oldWorkspacePreserved: true,
          credentialPreserved: true,
        });
        clearTimeout(deadline);
        realExit(0);
      } catch (error) {
        void finish(error);
      }
    } else realExit(code);
  };
  app.on('browser-window-created', (_event, created) => {
    // Animation state is read from the page; a window behind other apps must keep its frames.
    created.webContents.setBackgroundThrottling(false);
    if (win) return;
    win = created;
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const wait = async (code) => {
      for (let n = 0; n < 250; n++) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('UI did not reach: ' + code);
    };
    const click = (label) =>
      js(
        `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
      );
    const capture = async (name) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      write(dir, name, (await win.webContents.capturePage()).toPNG());
    };
    win.webContents.once('did-finish-load', async () => {
      try {
        if (phase === 'verify') {
          await wait(`!!document.querySelector('.room-rail')`);
          const loaded = await js('window.mori.load()');
          assert.deepEqual(loaded.state, expected.incoming);
          assert.equal(loaded.keys.imageKey, true);
          assert.equal(loaded.keys.credentialError, undefined);
          assert.equal(await js(`document.body.innerText.includes('从备份导入的角色')`), true);
          assert.equal(
            fs.readFileSync(path.join(target, `models/${modelId}/avatar.vrm`), 'utf8'),
            'isolated model fixture 从备份导入的角色',
          );
          assert.deepEqual(
            fs.readFileSync(path.join(target, `models/${modelId}/textures/色彩.png`)),
            fs.readFileSync(path.join(dir, 'source', `models/${modelId}/textures/色彩.png`)),
          );
          assert.deepEqual(
            readJson(path.join(target, 'pet-jobs/task.asset.json')),
            readJson(path.join(dir, 'source/pet-jobs/task.asset.json')),
          );
          assert.deepEqual(
            readJson(path.join(target, 'model-jobs/task.json')),
            readJson(path.join(dir, 'source/model-jobs/task.json')),
          );
          assert.equal(fs.existsSync(path.join(target, '.workspace-import-journal.json')), false);
          await capture('fresh-start-after-import.png');
          write(dir, 'checks.json', {
            passed: true,
            realElectronProcesses: 2,
            networkRequests: 0,
            corruptedStatePreserved: true,
            previousStateRecovered: true,
            credentialWarningAndReset: true,
            exportExcludesCredentialsAndCache: true,
            confirmedImport: true,
            importedStateAndModelsMatch: true,
            importedTasksMatch: true,
            credentialsSurviveImport: true,
            oldWorkspaceSnapshotRetained: true,
            cleanFreshStartup: true,
            ...readJson(path.join(dir, 'import-phase.json')),
          });
          await finish();
          return;
        }
        await wait(`!!document.querySelector('[aria-label="恢复上一份有效存档"]')`);
        assert.match(await js('document.body.innerText'), /无法读取工作区/);
        assert.equal(fs.readFileSync(path.join(target, 'state.json'), 'utf8'), '{broken original state');
        await click('打开数据文件夹');
        await capture('startup-recovery.png');
        await click('恢复上一份有效存档');
        await wait(`!!document.querySelector('.room-rail')`);
        let loaded = await js('window.mori.load()');
        assert.deepEqual({ ...loaded.state, revision: expected.previous.revision }, expected.previous);
        assert.ok(loaded.state.revision > expected.previous.revision);
        assert.ok(loaded.keys.credentialError);
        const preservedState = fs.readdirSync(target).find((name) => /^state\.rejected-/.test(name));
        assert.equal(fs.readFileSync(path.join(target, preservedState), 'utf8'), '{broken original state');
        await click('连接设置');
        await wait(`!!document.querySelector('[aria-label="重新配置密钥"]')`);
        await capture('credential-recovery.png');
        const originalCredentials = fs.readFileSync(path.join(target, 'credentials.enc.json'));
        await click('重新配置密钥');
        await wait(`!document.querySelector('[aria-label="重新配置密钥"]')`);
        loaded = await js('window.mori.load()');
        assert.equal(loaded.keys.credentialError, undefined);
        assert.equal(loaded.keys.imageKey, false);
        const preservedKeys = fs.readdirSync(target).find((name) => /^credentials\.rejected-/.test(name));
        assert.deepEqual(fs.readFileSync(path.join(target, preservedKeys)), originalCredentials);
        assert.equal(fs.existsSync(path.join(target, 'credentials.enc.json')), false);
        await js(
          `window.mori.load().then(r=>window.mori.saveSettings(r.state.settings,{imageKey:${JSON.stringify(secret)}}))`,
        );
        await js(`void(window.__modelPending=window.mori.importModel('recovery-character','vrm'))`);
        for (let n = 0; n < 100 && !releaseModelDialog; n++)
          await new Promise((resolve) => setTimeout(resolve, 20));
        assert.ok(releaseModelDialog, 'The model import must be held in its actual main-process dialog');
        const gateResults = await js(
          `Promise.all([window.mori.exportWorkspace(),window.mori.importWorkspace()].map(p=>p.then(()=>({allowed:true}),error=>({error:error.message}))))`,
        );
        assert.ok(gateResults.every((result) => /等待当前操作完成/.test(result.error)));
        assert.equal(exportDialogs, 0, 'A denied export must not open another dialog');
        assert.equal(importDialogs, 0, 'A denied import must not open another dialog');
        releaseModelDialog({ canceled: true, filePaths: [] });
        assert.equal(await js('window.__modelPending'), null);
        operationGateChecked = true;
        await js(
          `[...document.querySelectorAll('details')].find(e=>e.querySelector('h2')?.textContent==='工作区备份与恢复').open=true`,
        );
        await wait(`!document.querySelector('[aria-label="导出工作区备份"]').disabled`);
        await click('导出工作区备份');
        await wait(`document.body.innerText.includes('工作区备份已导出')`);
        const archive = unzipSync(fs.readFileSync(path.join(dir, 'exported.zip')));
        assert.ok(
          Object.keys(archive).every(
            (name) =>
              name === 'manifest.json' ||
              name === 'state.json' ||
              /^(models|pet-jobs|model-jobs)\//.test(name),
          ),
        );
        assert.equal(
          Object.keys(archive).some((name) => /credentials|Cache|rejected/.test(name)),
          false,
        );
        assert.equal(
          Object.values(archive).some((bytes) => Buffer.from(bytes).includes(Buffer.from(secret))),
          false,
        );
        assert.deepEqual(
          JSON.parse(Buffer.from(archive['state.json']).toString()).messages,
          expected.previous.messages,
        );
        assert.deepEqual(
          Buffer.from(archive[`models/${modelId}/avatar.vrm`]),
          fs.readFileSync(path.join(target, `models/${modelId}/avatar.vrm`)),
        );
        await js(
          `document.querySelector('[aria-label="导出工作区备份"]').scrollIntoView({block:'center',behavior:'instant'})`,
        );
        await capture('workspace-backup-controls.png');
        await js(`void(window.confirm=(message)=>{window.__recoveryConfirmation=message;return true})`);
        await click('从备份恢复工作区');
        // Confirmation is synchronous and completes before the asynchronous archive import.
        const confirmation = await js('window.__recoveryConfirmation');
        assert.match(confirmation, /替换当前工作区/);
        assert.match(confirmation, /副本/);
        confirmationSeen = true;
        // Main-process app.exit is intercepted above only to record checks; a new
        // Electron process is launched by the coordinator after this one exits.
      } catch (error) {
        await finish(error);
      }
    });
  });
  require('../electron/main.cjs');
}
