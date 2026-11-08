'use strict';
// Large atlas images live as files named by the SHA-256 of their bytes, referenced from skins as
// `mori-asset://skins/<sha256>.png`. The name is the digest the reviews already record for the
// same bytes as an embedded data URL, so moving an atlas out of the state changes no review.
const { createHash } = require('node:crypto');
const ASSET = /^mori-asset:\/\/skins\/([0-9a-f]{64})\.png$/;
const isAsset = (value) => typeof value === 'string' && ASSET.test(value);
const assetUrl = (sha) => `mori-asset://skins/${sha}.png`;
/** SHA-256 of an image given as a data URL or as a stored asset reference. */
function imageDigest(source) {
  const match = typeof source === 'string' && ASSET.exec(source);
  if (match) return match[1];
  const encoded = String(source).slice(String(source).indexOf(',') + 1);
  return createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex');
}
module.exports = { ASSET, isAsset, assetUrl, imageDigest };
