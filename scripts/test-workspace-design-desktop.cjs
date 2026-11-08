const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const assert = require('node:assert/strict');
const out = path.join(root, 'artifacts/workspace-ui');
let apiCalls = 0;
global.fetch = async () => {
  apiCalls++;
  throw new Error('UI verification must not call an API');
};
fs.mkdirSync(out, { recursive: true });
process.env.MORI_DATA_DIR = path.join(out, 'workspace-' + randomUUID());
delete process.env.MORI_DEV_URL;
delete process.env.MORI_DEV_VIEW;
let win;
const deadline = setTimeout(() => app.exit(1), 60000);
app.on('browser-window-created', (_, w) => {
  if (win) return;
  win = w;
  w.webContents.once('did-finish-load', async () => {
    try {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const js = (code) => w.webContents.executeJavaScript(code, true);
      w.setContentSize(1440, 940);
      for (let i = 0; i < 100; i++) {
        if (await js(`!!document.querySelector('.scene-artwork canvas[data-clip]')`)) break;
        await delay(80);
      }
      await delay(400);
      const results = [];
      // Navigation: rail (home, settings), the studio pill and its tabs, and the history drawer.
      const press = (label) =>
        js(
          `[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)})&&!b.disabled).click()`,
        );
      const go = async (view) => {
        await press(view === 'settings' ? '连接与设置' : 'Mori 首页');
        if (view === 'chat') await press('查看对话记录');
        const tab = { characters: '角色档案', wardrobe: '外观与动作', memories: '相处记忆' }[view];
        if (tab) {
          await press('角色工作室');
          await press(tab);
        }
        await delay(350);
      };
      for (const view of ['home', 'chat', 'wardrobe', 'characters', 'memories', 'settings']) {
        await go(view);
        assert.equal(await js(`document.querySelector('main').dataset.feature`), view === 'chat' ? 'home' : view);
        if (view === 'home') {
          assert.ok(
            await js(
              `document.querySelector('.room-figure').getBoundingClientRect().bottom <= document.querySelector('.room-composer').getBoundingClientRect().top + 1`,
            ),
            'The composer must not cover the character feet',
          );
        }
        if (view === 'chat') assert.ok(await js(`!!document.querySelector('.history-drawer')`));

        if (view === 'wardrobe') {
          assert.equal(await js(`document.querySelector('.creation-tools').open`), false);
          assert.equal(await js(`document.querySelector('.motion-workbench').open`), false);
          await js(`document.querySelector('.creation-tools summary').click()`);
          assert.ok(
            await js(
              `document.querySelector('[aria-label="使用预制角色包"]').getBoundingClientRect().height > 0`,
            ),
          );
          await js(`document.querySelector('[aria-label="使用预制角色包"]').click()`);
          await delay(200);
          assert.ok(await js(`!!document.querySelector('[role="dialog"][aria-label="角色包与本地互动"]')`));
          await js(`document.querySelector('[aria-label="关闭弹窗"]').click()`);
          await js(`document.querySelector('.creation-tools summary').click()`);
          await js(`document.querySelector('.production-entry').click()`);
          await delay(300);
          assert.ok(await js(`!!document.querySelector('[role="dialog"][aria-label="自动制作桌宠"]')`));
          await js(`document.querySelector('[aria-label="关闭弹窗"]').click()`);
          await js(`document.querySelectorAll('.wardrobe-card')[2].click()`);
          for (let i = 0; i < 80; i++) {
            if (
              await js(`document.querySelectorAll('.wardrobe-card')[2].getAttribute('aria-pressed')==='true'`)
            )
              break;
            await delay(50);
          }
          assert.equal(
            await js(`document.querySelectorAll('.wardrobe-card')[2].getAttribute('aria-pressed')`),
            'true',
          );
          await js(`document.querySelector('.motion-workbench summary').click()`);
          await delay(200);
          assert.ok(
            await js(`document.querySelector('.workbench-controls').getBoundingClientRect().height > 0`),
          );
          await js(`document.querySelector('.motion-workbench summary').click()`);
        }
        fs.writeFileSync(path.join(out, view + '.png'), (await w.webContents.capturePage()).toPNG());
        results.push(
          await js(
            `({view:document.querySelector('main').dataset.feature,overflow:document.documentElement.scrollWidth>innerWidth+1,heading:document.querySelector('main h1')?.textContent})`,
          ),
        );
      }
      w.setContentSize(900, 760);
      for (const view of ['home', 'wardrobe']) {
        await go(view);
        await delay(350);
        fs.writeFileSync(path.join(out, view + '-compact.png'), (await w.webContents.capturePage()).toPNG());
        results.push(
          await js(
            `({view:document.querySelector('main').dataset.feature,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1})`,
          ),
        );
      }
      assert.equal(apiCalls, 0);
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ out, results, apiCalls }));
      clearTimeout(deadline);
      app.exit(results.some((r) => r.overflow) ? 1 : 0);
    } catch (e) {
      console.error(e);
      clearTimeout(deadline);
      app.exit(1);
    }
  });
});
require('../electron/main.cjs');
