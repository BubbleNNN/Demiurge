'use strict';
// Explicit read-only input: export ONLY approved artwork and sprite timing, never credentials or chat.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [dataDirectory, outputDirectory, skinId] = process.argv.slice(2);
if (!dataDirectory || !outputDirectory) throw Error('Usage: node prepare-social.cjs DATA_DIRECTORY OUTPUT_DIRECTORY [SKIN_ID]');
const data = path.resolve(dataDirectory), out = path.resolve(outputDirectory);
const state = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
const skin = state.skins.find(s => s.id === (skinId || state.activeSkinId));
if (!skin?.sprite || skin.review?.status !== 'approved') throw Error('Choose a reviewed animated appearance');
fs.mkdirSync(out, { recursive: true });
const sources = [skin.images.neutral, ...(skin.sprite.pages || []).map(p => p.src)];
const hashes = [];
for (const [i, src] of sources.entries()) {
  if (!/^mori-asset:\/\/skins\/[a-f0-9]{64}\.png$/.test(src)) throw Error('Expected stored PNG atlas');
  const bytes = fs.readFileSync(path.join(data, 'skin-assets', src.split('/').at(-1)));
  fs.writeFileSync(path.join(out, `atlas-${i}.png`), bytes);
  hashes.push(crypto.createHash('sha256').update(bytes).digest('hex'));
}
fs.writeFileSync(path.join(out, 'sprite.json'), JSON.stringify(skin.sprite));
fs.writeFileSync(path.join(out, 'source-manifest.json'), JSON.stringify({name:skin.name, style:skin.style, createdAt:skin.createdAt, frames:skin.sprite.frames.length, clips:Object.keys(skin.sprite.clips).length, atlasSha256:hashes},null,2));
console.log(`Prepared ${skin.sprite.frames.length} frames; no account settings, chat, or memory exported.`);
