'use strict';
// Native rehearsal acceptance with a fixed local transport; no real provider.
const { app, clipboard } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const dir = path.resolve(__dirname, '../.local/persona-sessions-' + require('node:crypto').randomUUID());
const output = path.resolve(__dirname, '../artifacts/refinement-round2-2026-10-07');
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(output, { recursive: true });
process.env.MORI_DATA_DIR = dir;
process.env.MORI_DEV_VIEW = 'characters';
delete process.env.MORI_DEV_URL;
let win,
  mode = 'ok',
  calls = [];
global.fetch = async (url, options) => {
  assert.equal(String(url), 'https://fixture.mori.example/v1/chat/completions');
  const body = JSON.parse(options.body);
  calls.push(body);
  if (mode === 'fail') {
    mode = 'ok';
    return new Response(JSON.stringify({ error: { message: 'Fixture temporary failure' } }), { status: 400 });
  }
  if (mode === 'wait') {
    mode = 'ok';
    return new Promise((_, reject) => {
      const stop = () => reject(new DOMException('Cancelled', 'AbortError'));
      if (options.signal.aborted) stop();
      else options.signal.addEventListener('abort', stop, { once: true });
    });
  }
  const response = {
    text: calls.length === 1 ? '那就先读完这本书吧。明天再聊下一章。' : '我还记得刚才的话。我们接着聊。',
    emotion: 'happy',
    action: 'nod',
    memory: null,
  };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }));
};
const deadline = setTimeout(() => finish(new Error('Persona rehearsal timed out')), 80000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-2000));
    }
  }
  console.log('Fixture directory: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_, created) => {
  if (win) return;
  win = created;
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw Error(code.slice(0, 250) + ': ' + error.message);
    });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code) => {
    for (let n = 0; n < 180; n++) {
      if (await js(code)) return;
      await delay(40);
    }
    throw Error('UI not ready: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const root=document.querySelector('.modal')||document;const b=[...root.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  const fill = (label, value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const state = () => js('window.mori.load().then(r=>r.state)');
  const capture = async (name) => {
    await delay(200);
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.profile-hero')`);
      await js(
        `window.mori.load().then(({state:s})=>window.mori.saveSettings({...s.settings,chatMode:'model',llmBaseUrl:'https://fixture.mori.example/v1',llmProtocol:'openai',llmModel:'offline-fixture'},{llmKey:'fixture-no-real-provider'}))`,
      );
      await js(
        `window.mori.load().then(({state:s})=>window.mori.save({...s,memories:[{id:'private-memory',characterId:s.activeCharacterId,text:'PRIVATE_MEMORY_NOT_FOR_REHEARSAL',createdAt:new Date().toISOString()}],messages:{[s.activeCharacterId]:[{id:'private-chat',role:'user',content:'PRIVATE_CHAT_NOT_FOR_REHEARSAL',createdAt:new Date().toISOString()}]}},s))`,
      );
      const before = await state();
      await click('角色试聊');
      await wait(`!!document.querySelector('.persona-preview')`);
      await capture('empty-preview');
      await fill('语气试聊消息', '今天一起读那本书吧。');
      await js(
        `(()=>{const form=document.querySelector('.persona-preview form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()`,
      );
      await wait(
        `document.querySelectorAll('.preview-turn').length===1&&!document.querySelector('.preview-pending')`,
      );
      assert.equal(calls.length, 1, 'Double submission stays one request');
      await fill('语气试聊消息', '你刚才说明天要做什么？');
      await click('继续试聊');
      await wait(
        `document.querySelectorAll('.preview-turn').length===2&&!document.querySelector('.preview-pending')`,
      );
      assert.equal(calls.length, 2);
      assert.ok(
        calls[1].messages.some(
          (message) => message.role === 'assistant' && message.content.includes('明天再聊下一章'),
        ),
      );
      assert.ok(
        calls[1].messages.some(
          (message) => message.role === 'user' && message.content === '今天一起读那本书吧。',
        ),
      );
      assert.equal(JSON.stringify(calls).includes('PRIVATE_'), false);
      assert.match(await js(`document.querySelector('.preview-turn-count').textContent`), /2 \/ 8/);
      await click('第 2 轮需要调整');
      await js(`document.querySelector('[aria-label="第 2 轮调整方向"] button:nth-child(3)').click()`);
      await fill('第 2 轮备注', '不要总用同一个开头。');
      await js(`document.querySelector('[aria-label="第 2 轮备注"]').scrollIntoView({block:'nearest'})`);
      await click('复制试聊摘要');
      assert.match(clipboard.readText(), /用户人工标记/);
      assert.match(clipboard.readText(), /说话语气/);
      assert.match(clipboard.readText(), /不要总用/);
      await capture('multi-turn-preview');
      for (const width of [900, 1400]) {
        win.setSize(width, 900);
        await delay(150);
        assert.equal(
          await js(`(()=>{const m=document.querySelector('.modal');return m.scrollWidth>m.clientWidth+1})()`),
          false,
        );
        assert.equal(
          await js(
            `(()=>{const m=document.querySelector('.modal').getBoundingClientRect(), b=document.querySelector('.preview-submit button').getBoundingClientRect();return b.top>=m.top&&b.bottom<=m.bottom})()`,
          ),
          true,
          'Submit stays visible without scrolling the dialog',
        );
        await capture('preview-' + width);
      }
      mode = 'fail';
      await fill('语气试聊消息', '失败的问题不能进入下一轮');
      await click('继续试聊');
      await wait(
        `!!document.querySelector('.persona-preview .inline-error')&&!document.querySelector('.preview-pending')`,
      );
      assert.equal(await js(`document.querySelectorAll('.preview-turn').length`), 2);
      mode = 'wait';
      await fill('语气试聊消息', '取消的问题不能进入下一轮');
      await click('继续试聊');
      await wait(`!!document.querySelector('.preview-pending')`);
      for (let n = 0; n < 100 && calls.length < 4; n++) await delay(20);
      await click('停止等待');
      await wait(
        `!!document.querySelector('.persona-preview .inline-error')&&!document.querySelector('.preview-pending')`,
      );
      assert.equal(await js(`document.querySelectorAll('.preview-turn').length`), 2);
      await fill('语气试聊消息', '我们继续之前的话题');
      await click('继续试聊');
      await wait(
        `document.querySelectorAll('.preview-turn').length===3&&!document.querySelector('.preview-pending')`,
      );
      assert.equal(JSON.stringify(calls.at(-1)).includes('失败的问题'), false);
      assert.equal(JSON.stringify(calls.at(-1)).includes('取消的问题'), false);
      await js(
        `window.mori.load().then(({state:s})=>window.mori.save({...s,characters:s.characters.map(c=>c.id===s.activeCharacterId?{...c,speakingStyle:'用简短自然的句子，避免重复开头。'}:c)},s))`,
      );
      await fill('语气试聊消息', '按刚保存的语气重新开始');
      await click('继续试聊');
      await wait(
        `document.querySelectorAll('.preview-turn').length===1&&document.querySelector('.persona-preview').textContent.includes('档案已修改')&&!document.querySelector('.preview-pending')`,
      );
      assert.equal(calls.at(-1).messages.filter((message) => message.role === 'user').length, 1);
      await click('开始新试聊');
      await wait(
        `document.querySelectorAll('.preview-turn').length===0&&!document.querySelector('.preview-pending')`,
      );
      await fill('语气试聊消息', '全新试聊');
      await click('听听这句回应');
      await wait(
        `document.querySelectorAll('.preview-turn').length===1&&!document.querySelector('.preview-pending')`,
      );
      assert.equal(calls.at(-1).messages.filter((message) => message.role === 'assistant').length, 0);
      const after = await state();
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual(after.memories, before.memories);
      assert.deepEqual(after.settings, before.settings);
      assert.deepEqual(after.skins, before.skins);
      await click('复制摘要并调整设定');
      await wait(`!!document.querySelector('[aria-label="编辑角色档案"]')`);
      assert.match(clipboard.readText(), /全新试聊/);
      await click('关闭弹窗');
      await click('角色试聊');
      await wait(`!!document.querySelector('.persona-preview')`);
      assert.equal(await js(`document.querySelectorAll('.preview-turn').length`), 0);
      const result = {
        passed: true,
        transport: 'local fixed responses',
        realProviderCalls: 0,
        fixtureCalls: calls.length,
        multiTurnContext: true,
        synchronousSubmitGuard: true,
        noPrivateHistoryOrMemory: true,
        failedCancelledTurnsExcluded: true,
        profileChangeReset: true,
        manualFeedbackAndCopy: true,
        feedbackToEditor: true,
        visibleSubmit: true,
        restartAndCloseClear: true,
        responsiveWidths: [900, 1400],
        formalDataPreserved: true,
      };
      fs.writeFileSync(path.join(output, 'persona-acceptance.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result));
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
