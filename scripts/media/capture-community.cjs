'use strict';
const {app,BrowserWindow,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),out=path.join(root,'.local/promo-chibi');
process.env.MORI_QUIET='1';process.env.MORI_DATA_DIR=fs.mkdtempSync('/tmp/demiurge-media-ui-');delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable=()=>false;
const {REGISTRIES}=require(path.join(root,'electron/community.cjs'));
global.fetch=async url=>{const u=String(url);const base=REGISTRIES.find(b=>u.startsWith(b));if(!base)throw Error('External requests disabled for capture');const p=path.resolve(root,'community',u.slice(base.length));if(!p.startsWith(path.join(root,'community')+path.sep))throw Error('Invalid path');return new Response(fs.readFileSync(p));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
setTimeout(()=>app.exit(1),40000);
app.on('browser-window-created',(_e,win)=>{if(started)return;started=true;win.webContents.setBackgroundThrottling(false);win.setSize(1440,1000);win.webContents.once('did-finish-load',async()=>{try{const js=s=>win.webContents.executeJavaScript(s,true);for(let i=0;i<100;i++){if(await js('!!document.querySelector(".room-rail")'))break;await sleep(100)}
const click=async label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw Error('missing button');b.click()})()`);
await click('社区桌宠与插件');await sleep(1000);
for(const [label,file] of [['插件','community-plugins.png'],['分享我的桌宠','community-share.png']]){await click(label);await sleep(500);const rect=await js(`(()=>{const r=document.querySelector('.community').closest('[role="dialog"]')?.getBoundingClientRect()||document.querySelector('.community').parentElement.getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);fs.writeFileSync(path.join(out,file),(await win.webContents.capturePage(rect)).toPNG())}
console.log('Captured actual community UI; no external calls; quiet='+process.env.MORI_QUIET);app.exit(0)}catch(e){console.error(e);app.exit(1)}})});
require(path.join(root,'electron/main.cjs'));
