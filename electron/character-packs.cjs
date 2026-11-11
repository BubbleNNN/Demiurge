'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateCharacter, validateSkin, createBundle } = require('./store.cjs');
const cyreneSprite = require('../shared/cyrene-sprite.json');
const motionPack = require('../shared/cyrene-motion-pack.json');
async function portableBundle(character, skins, artDirectory) {
  const checkedCharacter = validateCharacter(character);
  if (!Array.isArray(skins) || skins.length > 24) throw new Error('角色包最多包含 24 套外观。');
  const portable = [];
  for (const value of skins) {
    const skin = validateSkin(value);
    if (skin.characterId !== checkedCharacter.id) throw new Error('外观不属于当前角色。');
    if (skin.model || ['live2d', 'vrm', 'glb'].includes(skin.kind)) continue;
    if (skin.builtin && !skin.images.neutral) {
      // validateSkin restricts this filename to bundled art. Never follow input paths.
      const authored = !skin.sprite && motionPack.entries.find((entry) => entry.builtin === skin.builtin);
      const bytes = await fs.readFile(path.join(artDirectory, authored?.file || skin.builtin + '.png'));
      skin.images = { ...skin.images, neutral: 'data:image/png;base64,' + bytes.toString('base64') };
      if (authored) {
        skin.sprite = structuredClone(authored.animation);
        if (skin.sprite.pages)
          skin.sprite.pages = await Promise.all(
            skin.sprite.pages.map(async (page, index) => {
              // Paths come from the bundled catalogue, never from imported user data.
              const file = authored.pageFiles[index];
              const bytes = await fs.readFile(path.join(artDirectory, file));
              return { ...page, src: 'data:image/png;base64,' + bytes.toString('base64') };
            }),
          );
      } else if (skin.builtin === 'cyrene-8bit-v5') skin.sprite = structuredClone(cyreneSprite);
      else if (skin.builtin.endsWith('-v4')) {
        // Legacy cards show the top-left pose of a 2x2 atlas. Preserve that
        // exact display as one static frame, without inventing animation.
        const width = bytes.readUInt32BE(16) / 2,
          height = bytes.readUInt32BE(20) / 2;
        skin.sprite = {
          width,
          height,
          pixelated: skin.style === 'pixel',
          frames: [{ rect: [0, 0, width, height], duration: 140 }],
          clips: { idle: { frames: [0], loop: true } },
        };
      }
    }
    delete skin.builtin;
    portable.push(skin);
  }
  return createBundle(checkedCharacter, portable);
}
module.exports = { portableBundle };
