'use strict';
process.env.MORI_QUIET = '1';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const dir = path.resolve(__dirname, '../.local/profile-chat-' + require('node:crypto').randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
let calls = [],
  win;
global.fetch = async (url, init) => {
  assert.equal(String(url), 'https://fixture.example/v1/chat/completions');
  const body = JSON.parse(init.body);
  calls.push(body);
  assert.ok(Buffer.byteLength(init.body) < 40000, 'Only dialogue context reaches the model');
  assert.equal(init.body.includes('data:image'), false);
  assert.equal(init.body.includes('referenceCandidates'), false);
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              text: '一起看书吧，刚才说好的那一章。',
              emotion: 'happy',
              action: 'nod',
              memory: null,
            }),
          },
        },
      ],
    }),
  );
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = setTimeout(() => finish(Error('Profile chat timed out')), 65000);
function finish(error) {
  clearTimeout(deadline);
  if (error) console.error(error.stack);
  console.log('Evidence: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_, created) => {
  if (win) return;
  win = created;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await delay(50);
    }
    throw Error('UI not ready: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-figure')`);
      const image =
        'data:image/png;base64,' +
        fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi-v6-reference.png')).toString('base64');
      const empty = { personal: [], relationships: [], events: [], traits: [], voice: [] };
      const dossier = {
        ...empty,
        relationships: [
          {
            title: '旧日同伴',
            detail: '与同伴互相信任，用户不是这位同伴。',
            sourceUrls: ['https://example.org/canon'],
            status: 'sourced',
            spoiler: false,
          },
        ],
        voice: [
          {
            title: '称呼和节奏',
            detail: '轻快短句，偶尔用人家，不要每句使用同一句口癖。',
            sourceUrls: [],
            status: 'user',
            spoiler: false,
          },
        ],
        events: [
          {
            title: '未揭晓的结局',
            detail: 'HIDDEN_SPOILER',
            sourceUrls: ['https://example.org/canon'],
            status: 'sourced',
            spoiler: true,
          },
        ],
      };
      await js(
        `window.mori.load().then(({state:s})=>window.mori.save({...s,characters:s.characters.map(c=>c.id===s.activeCharacterId?{...c,dossier:${JSON.stringify(dossier)},referenceCandidates:[{id:'big-reference-1',name:'图一',image:${JSON.stringify(image)},createdAt:new Date().toISOString()},{id:'big-reference-2',name:'图二',image:${JSON.stringify(image)},createdAt:new Date().toISOString()},{id:'big-reference-3',name:'图三',image:${JSON.stringify(image)},createdAt:new Date().toISOString()}]}:c),memories:[...s.memories,{id:'interaction-memory',characterId:s.activeCharacterId,text:'我们约好一起看书',kind:'promise',origin:'user-confirmed',createdAt:new Date().toISOString()}]},s))`,
      );
      await js(
        `window.mori.load().then(({state:s})=>window.mori.saveSettings({...s.settings,chatMode:'model',llmProtocol:'openai',llmBaseUrl:'https://fixture.example/v1',llmEndpointMode:'base',llmModel:'fixture',proactiveEnabled:false,desktopLifeEnabled:false},{llmKey:'fixture-not-real'}))`,
      );
      const before = await js('window.mori.load().then(r=>r.state)');
      const character = before.characters.find((c) => c.id === before.activeCharacterId);
      assert.ok(
        Buffer.byteLength(JSON.stringify(character.referenceCandidates)) > 2 * 1024 * 1024,
        'Reproduces original IPC-overflow condition',
      );
      await js(
        `(()=>{const el=document.querySelector('[aria-label="聊天消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'还记得一起看书的约定吗？');el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
      await click('发送消息');
      await wait(
        `window.mori.load().then(({state:s})=>s.messages[s.activeCharacterId]?.at(-1)?.role==='assistant')`,
      );
      assert.equal(calls.length, 1);
      const context = JSON.parse(
        calls[0].messages[1].content.slice(calls[0].messages[1].content.indexOf('{')),
      );
      assert.ok(context.roleplay.dossier.voice.length);
      assert.equal(JSON.stringify(context).includes('HIDDEN_SPOILER'), false);
      assert.equal(context.userMemory.promises[0].text, '我们约好一起看书');
      const after = await js('window.mori.load().then(r=>r.state)');
      assert.deepEqual(after.characters, before.characters);
      assert.deepEqual(after.skins, before.skins);
      assert.deepEqual(after.memories, before.memories);
      for (const window of BrowserWindow.getAllWindows()) {
        assert.equal(window.getOpacity(), 0);
        assert.equal(window.isFocused(), false);
      }
      const report = {
        passed: true,
        largeImageCharacterChat: true,
        referenceImageBytes: Buffer.byteLength(JSON.stringify(character.referenceCandidates)),
        providerRequestBytes: Buffer.byteLength(JSON.stringify(calls[0])),
        calls: calls.length,
        realProviderCalls: 0,
        structuredDossier: true,
        spoilersExcluded: true,
        classifiedMemory: true,
        existingDataPreserved: true,
        quiet: true,
      };
      fs.writeFileSync(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      finish();
    } catch (e) {
      finish(e);
    }
  });
});
require('../electron/main.cjs');
