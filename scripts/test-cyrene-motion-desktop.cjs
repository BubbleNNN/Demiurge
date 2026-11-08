'use strict';
// Actual player captures, with isolated local state and no API credentials.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.local', 'sprite-smoke-' + randomUUID());
const requestedStyles = process.env.MORI_MOTION_TEST_STYLES?.split(',').filter(Boolean);
const catalog = require('../shared/cyrene-motion-pack.json');
const entries = catalog.entries.filter((entry) => !requestedStyles || requestedStyles.includes(entry.style));
assert.ok(
  entries.length && (!requestedStyles || entries.length === new Set(requestedStyles).size),
  'Unknown or repeated motion test styles',
);
const release = /V(\d+)_REVIEW/.exec(catalog.reviewFile)?.[1] || '2';
const review = process.env.MORI_MOTION_REVIEW_DIR
  ? path.resolve(process.env.MORI_MOTION_REVIEW_DIR)
  : path.join(root, 'artifacts/animation/cyrene-v' + release);
const captureName = entries.length === 4 ? 'four-styles-runtime' : 'seven-styles-runtime';
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(review, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
process.env.MORI_DEV_VIEW = 'wardrobe';
let started = false,
  calls = 0;
global.fetch = async () => {
  calls++;
  throw new Error('Motion regression must stay offline');
};
const timer = setTimeout(() => finish(new Error('Sprite test timed out')), 180000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error.stack);
  console.log('Sprite test artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_, win) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  win.webContents.setBackgroundThrottling(false);
  if (started) return;
  started = true;
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error(code.slice(0, 300) + ': ' + error.message);
    });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code, label = code) => {
    for (let n = 0; n < 180; n++) {
      if (await js(code)) return;
      await delay(30);
    }
    throw new Error('Timeout: ' + label);
  };
  const click = (title) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(title)})&&!b.disabled);if(!b)throw new Error('Button missing: '+${JSON.stringify(title)});b.click()})()`,
    );
  const canvas =
    'document.querySelector(".workbench-stage .animated-illustration canvas:not(.canvas-pending)")';
  const sample = async (ms) =>
    js(
      `new Promise(resolve=>{const seen=new Set();const end=performance.now()+${ms};function poll(){const c=${canvas};if(c)seen.add(c.dataset.frame);if(performance.now()>=end)resolve([...seen]);else setTimeout(poll,20)}poll()})`,
    );
  const boardCell = (index, row, caption) =>
    js(
      `(()=>{const board=window.__motionBoard,ctx=board.getContext('2d'),c=${canvas},b=window.__motionBounds(c);const x=${index}*200,y=${row}*350;ctx.fillStyle='#ffffff';ctx.fillRect(x+5,y+5,190,340);ctx.fillStyle='#4d3749';ctx.font='16px sans-serif';ctx.textAlign='center';ctx.fillText(${JSON.stringify(caption)},x+100,y+29);const scale=Math.min(180/b.w,294/b.h);ctx.drawImage(c,b.x,b.y,b.w,b.h,x+100-b.w*scale/2,y+336-b.h*scale,b.w*scale,b.h*scale)})()`,
    );
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait('window.mori.load().then(({state})=>state?.skins.length===7)');
      await wait(`!!document.querySelector('.workbench')`);
      // The motion workbench is collapsed by default; open it to inspect playback.
      await js(`document.querySelector('.motion-workbench').open=true`);
      await js(`document.querySelector('.workbench').scrollIntoView({block:'center',behavior:'instant'})`);
      await wait(`${canvas}?.dataset.motion==='active'`);
      assert.equal(await js(`document.querySelectorAll('.wardrobe-card').length`), 7);
      assert.deepEqual(
        await js(
          `[...document.querySelectorAll('.action-list button')].filter(b=>b.disabled).map(b=>b.textContent.trim()).sort()`,
        ),
        ['小跳', '摇头', '读书', '玩掌机'].sort(),
        'Built-in art must not advertise unsupported gestures or newly added activities',
      );
      await js(`(()=>{
        window.__motionBounds=c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x=c.width,y=c.height,r=0,b=0;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++)if(p[(j*c.width+i)*4+3]>40){x=Math.min(x,i);y=Math.min(y,j);r=Math.max(r,i);b=Math.max(b,j)}return{x,y,w:r-x+1,h:b-y+1}};
        const board=document.createElement('canvas');board.width=${entries.length * 200};board.height=700;board.getContext('2d').fillStyle='#f7edf3';board.getContext('2d').fillRect(0,0,board.width,700);window.__motionBoard=board;
        const video=document.createElement('canvas');video.width=960;video.height=720;const ctx=video.getContext('2d');let raf;
        const draw=()=>{ctx.fillStyle='#fbf6f9';ctx.fillRect(0,0,960,720);ctx.fillStyle='#513447';ctx.textAlign='center';ctx.font='26px sans-serif';ctx.fillText('Demiurge · 昔涟 · '+(window.__motionTitle||''),480,43);ctx.font='18px sans-serif';ctx.fillText('真实播放器：待机 / 眨眼 / 招手 / 点头 / 说话 / 休息',480,78);const c=${canvas},b=window.__motionCrop;if(c&&b){const scale=Math.min(680/b.w,594/b.h);ctx.drawImage(c,b.x,b.y,b.w,b.h,480-b.w*scale/2,710-b.h*scale,b.w*scale,b.h*scale)}raf=requestAnimationFrame(draw)};draw();
        const recorder=new MediaRecorder(video.captureStream(24),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:2200000});const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.start(500);window.__stopMotionRecording=()=>new Promise(resolve=>{recorder.onstop=async()=>{cancelAnimationFrame(raf);const a=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));resolve(btoa(s))};recorder.stop()});
      })()`);
      const report = [];
      const names = {
        original: '原作画风',
        anime: '精绘',
        chibi: 'Q 版',
        powerpuff: '飞天小女警',
        pixel: '复古像素',
        '8bit': '8-bit',
        '3d': '低多边形 3D',
      };
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        await js(
          `window.mori.load().then(({state})=>window.mori.save({...state,activeSkinId:${JSON.stringify(entry.builtin)}}))`,
        );
        await wait(
          `document.querySelector('.wardrobe-card.selected strong')?.textContent.includes(${JSON.stringify(names[entry.style])})`,
        );
        await wait(
          `${canvas}?.dataset.motion==='active' && ${canvas}?.dataset.skin===${JSON.stringify(entry.builtin)}`,
        );
        await js(`window.__motionTitle=${JSON.stringify(names[entry.style])}`);
        await click('平静');
        await wait(`${canvas}?.dataset.frame==='0'`);
        await js(
          `(()=>{const c=${canvas},b=window.__motionBounds(c),pad=Math.ceil(b.w*.14);window.__motionCrop={x:Math.max(0,b.x-pad),y:Math.max(0,b.y-8),w:Math.min(c.width,b.w+pad*2),h:Math.min(c.height,b.h+16)}})()`,
        );
        await boardCell(index, 0, names[entry.style] + ' · 待机');
        const idle = await sample(3600);
        assert.ok(idle.includes('3'), entry.style + ': breathing frame absent');
        assert.ok(
          idle.includes('2'),
          entry.style + ': closed blink absent, observed ' + JSON.stringify(idle),
        );
        if (entry.animation.pixelated) {
          const stats = await js(
            `(()=>{const c=${canvas},p=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();let semi=0;for(let i=0;i<p.length;i+=4){if(p[i+3])colors.add([p[i],p[i+1],p[i+2]].join(','));if(p[i+3]>0&&p[i+3]<255)semi++}return {colors:colors.size,semi}})()`,
          );
          assert.ok(
            stats.colors > 8 && stats.colors <= entry.animation.palette.length,
            JSON.stringify(stats),
          );
          assert.equal(stats.semi, 0, 'Pixel edges must stay opaque');
        }
        await click('招呼');
        await wait(`${canvas}?.dataset.frame==='10'`);
        await boardCell(index, 1, names[entry.style] + ' · 招手');
        await delay(1300);
        assert.equal(await js(`${canvas}.dataset.clip`), 'idle');
        await click('点头');
        const nod = await sample(1000);
        assert.ok(nod.includes('12') && nod.includes('13'), entry.style + ': nod frames absent');
        assert.equal(await js(`${canvas}.dataset.clip`), 'idle');
        await click('预览说话口型');
        const talk = await sample(2700);
        assert.ok(talk.includes('4') && talk.includes('5'), entry.style + ': mouth frames absent');
        await click('休息');
        const sleep = await sample(Math.max(1800, (entry.animation.clips.sleep.durations?.[0] || 0) + 350));
        assert.ok(sleep.includes('14') && sleep.includes('15'), entry.style + ': sleep frames absent');
        await click('平静');
        report.push({ style: entry.style, idle, nod, talk, sleep });
        console.log('PASS real frames: ' + entry.style);
      }
      fs.writeFileSync(
        path.join(review, captureName + '.png'),
        Buffer.from((await js(`window.__motionBoard.toDataURL('image/png')`)).split(',')[1], 'base64'),
      );
      fs.writeFileSync(
        path.join(review, captureName + '.webm'),
        Buffer.from(await js('window.__stopMotionRecording()'), 'base64'),
      );
      const toggle = `[...document.querySelectorAll('label')].find(l=>l.textContent.includes('播放逐帧动画')).querySelector('input')`;
      await js(`${toggle}.click()`);
      await wait(`${canvas}?.dataset.motion==='paused' && ${canvas}?.dataset.frame==='0'`);
      await delay(150);
      const paused = await js(`${canvas}.toDataURL()`);
      await delay(350);
      assert.ok(await js(`${canvas}.toDataURL()===${JSON.stringify(paused)}`));
      await click('休息');
      await wait(`${canvas}?.dataset.frame==='14'`);
      await click('平静');
      await js(`${toggle}.click()`);
      await wait(`${canvas}?.dataset.motion==='active'`);
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await wait(
        `matchMedia('(prefers-reduced-motion: reduce)').matches && ${canvas}?.dataset.motion==='paused' && ${canvas}?.dataset.frame==='0'`,
      );
      await delay(150);
      const reduced = await js(`${canvas}.toDataURL()`);
      await delay(350);
      assert.ok(await js(`${canvas}.toDataURL()===${JSON.stringify(reduced)}`));
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      win.webContents.debugger.detach();
      await click('平静');
      await js(`document.querySelector('.room-back').click()`);
      await wait(`!!document.querySelector('[data-feature="home"]')`);
      await js(
        `document.querySelector('.main-content')?.scrollTo({top:0,behavior:'instant'});window.scrollTo(0,0)`,
      );
      await delay(650);
      await js(`document.querySelector('.head-zone').click()`);
      await wait(`document.querySelector('.room-figure canvas')?.dataset.clip==='nod'`);
      await delay(1100);
      await click('放到桌面');
      await delay(500);
      const pet = BrowserWindow.getAllWindows().find((window) => window !== win);
      assert.ok(pet, 'Desktop pet window missing');
      for (let n = 0; n < 120; n++) {
        if (
          await pet.webContents.executeJavaScript(
            `document.querySelector('.animated-illustration canvas')?.dataset.motion==='active'`,
          )
        )
          break;
        await delay(50);
      }
      assert.equal(
        await pet.webContents.executeJavaScript(
          `document.querySelector('.animated-illustration canvas')?.dataset.motion`,
        ),
        'active',
      );
      fs.writeFileSync(path.join(dir, 'desktop-pet.png'), (await pet.webContents.capturePage()).toPNG());
      assert.equal(calls, 0);
      fs.writeFileSync(
        path.join(review, 'runtime-verification.json'),
        JSON.stringify(
          {
            styles: report,
            pause: true,
            reducedMotion: true,
            headpat: true,
            desktopPet: true,
            networkCalls: calls,
          },
          null,
          2,
        ) + '\n',
      );
      console.log(
        `PASS ${entries.length} style animations, gestures, speech, palettes, pause, reduced motion, head touch and desktop pet; zero model calls`,
      );
      finish();
    } catch (error) {
      fs.writeFileSync(path.join(dir, 'error.png'), (await win.webContents.capturePage()).toPNG());
      finish(error);
    }
  });
});
require('../electron/main.cjs');
