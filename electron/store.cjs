'use strict';
const { isAsset, imageDigest, assetUrl, ASSET } = require('./skin-assets.cjs');

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { mergeSnapshots, mergeValue } = require('./merge.cjs');

const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// A frame atlas keeps every authored pixel of up to twenty motions; it may be far larger than one picture.
const MAX_ATLAS_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 192 * 1024 * 1024;
const EMOTIONS = ['neutral', 'happy', 'thinking', 'sad', 'sleepy', 'surprised'];
const ACTIVITIES = require('../shared/activities.json').activities.map((activity) => activity.id);
const ACTIONS = ['walk_left','walk_right','walk_up','walk_down','drag','listen','sit','lie','fly','idle', 'bounce', 'nod', 'shake', 'sleep', 'wave', ...ACTIVITIES];
const KEY_NAMES = ['llmKey', 'searchKey', 'imageKey', 'ttsKey', 'modelKey'];

function invalid(label, detail) {
  throw new Error(`${label}: ${detail}`);
}
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label, 'expected an object');
  return value;
}
function string(value, label, max = 12000, allowEmpty = true) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (!allowEmpty && !value.trim())
  ) {
    invalid(label, `expected ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${max} characters`);
  }
  return value;
}
function id(value, label, allowEmpty = false) {
  if (allowEmpty && value === '') return '';
  string(value, label, 128, false);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value) ||
    ['constructor', 'prototype', '__proto__'].includes(value)
  ) {
    invalid(label, 'invalid identifier');
  }
  return value;
}
function array(value, label, max, validate) {
  if (!Array.isArray(value) || value.length > max)
    invalid(label, `expected an array of at most ${max} items`);
  return value.map((item, i) => validate(item, `${label}[${i}]`));
}
function integerValue(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(label, `expected an integer from ${min} to ${max}`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') invalid(label, 'expected a boolean');
  return value;
}
function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) invalid(label, 'unsupported value');
  return value;
}
function date(value, label) {
  string(value, label, 64, false);
  if (!Number.isFinite(Date.parse(value))) invalid(label, 'invalid date');
  return value;
}
function webUrl(value, label, allowEmpty = false) {
  string(value, label, 4096, allowEmpty);
  if (allowEmpty && value === '') return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid(label, 'invalid URL');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    /[\x00-\x20\x7f]/.test(value)
  ) {
    invalid(label, 'only HTTP(S) URLs without embedded credentials are allowed');
  }
  return parsed.href;
}

// How a character lives on the desktop (src/characterBehavior.ts): carried in character packs and
// set by behaviour plugins. Every part is optional; what is missing comes from her profile.
const HABITS = ['sit', 'lie', 'lookAround', 'stretch', 'hum'];
const TRAVEL = ['walk', 'run', 'hop', 'fly'];
const MANNERS = ['shy', 'teasing', 'playful', 'calm'];
const LINE_KEYS = ['arrive', 'seek', 'headpat', 'poke', 'hum', 'peek'];
function validateDesktopProfile(value, label) {
  const p = record(value, label);
  const out = {};
  if (p.hobbies !== undefined)
    out.hobbies = array(p.hobbies, `${label}.hobbies`, 6, (v, l) => enumValue(v, ACTIVITIES, l));
  if (p.habits !== undefined)
    out.habits = array(p.habits, `${label}.habits`, 5, (v, l) => enumValue(v, HABITS, l));
  if (p.travel !== undefined) out.travel = enumValue(p.travel, TRAVEL, `${label}.travel`);
  if (p.manner !== undefined) {
    const manner = record(p.manner, `${label}.manner`);
    out.manner = {};
    for (const key of Object.keys(manner)) {
      if (!MANNERS.includes(key) || typeof manner[key] !== 'number' || !(manner[key] >= 0 && manner[key] <= 1))
        invalid(`${label}.manner.${key}`, 'expected shy, teasing, playful or calm from 0 to 1');
      out.manner[key] = manner[key];
    }
  }
  if (p.lines !== undefined) {
    const lines = record(p.lines, `${label}.lines`);
    out.lines = {};
    for (const key of Object.keys(lines)) {
      if (!LINE_KEYS.includes(key)) invalid(`${label}.lines.${key}`, 'unknown line kind');
      out.lines[key] = array(lines[key], `${label}.lines.${key}`, 8, (v, l) => string(v, l, 200, false));
    }
  }
  return out;
}
function validateCharacter(value, label = 'character', budget = { bytes: 0 }) {
  const c = record(value, label);
  const behavior = record(c.behavior, `${label}.behavior`);
  if (c.knowledge !== undefined) {
    const knowledge = record(c.knowledge, `${label}.knowledge`);
    if (
      (knowledge.kind === 'draft' && knowledge.method !== 'model') ||
      (knowledge.kind === 'manual' && knowledge.method !== 'manual') ||
      (knowledge.kind === 'sourced' &&
        !['links', 'claude', 'searxng', 'wiki', 'tavily', 'saved'].includes(knowledge.method))
    )
      invalid(`${label}.knowledge`, 'status and collection method do not match');
  }
  const numbers = {};
  for (const key of ['energy', 'affection', 'curiosity']) {
    if (
      typeof behavior[key] !== 'number' ||
      !Number.isFinite(behavior[key]) ||
      behavior[key] < 0 ||
      behavior[key] > 100
    ) {
      invalid(`${label}.behavior.${key}`, 'expected a number from 0 to 100');
    }
    numbers[key] = behavior[key];
  }
  return {
    id: id(c.id, `${label}.id`),
    name: string(c.name, `${label}.name`, 200, false),
    work: string(c.work, `${label}.work`, 500),
    summary: string(c.summary, `${label}.summary`, 20000),
    personality: array(c.personality, `${label}.personality`, 32, (v, l) => string(v, l, 1000)),
    speakingStyle: string(c.speakingStyle, `${label}.speakingStyle`, 12000),
    appearance: string(c.appearance, `${label}.appearance`, 12000),
    ...(c.knowledge !== undefined
      ? {
          knowledge: {
            kind: enumValue(
              record(c.knowledge, `${label}.knowledge`).kind,
              ['draft', 'sourced', 'manual'],
              `${label}.knowledge.kind`,
            ),
            method: enumValue(
              c.knowledge.method,
              ['model', 'links', 'claude', 'searxng', 'wiki', 'tavily', 'manual', 'saved'],
              `${label}.knowledge.method`,
            ),
            collectedAt: date(c.knowledge.collectedAt, `${label}.knowledge.collectedAt`),
          },
        }
      : {}),
    ...(c.dossier !== undefined ? {dossier: require('./character-dossier.cjs').validateDossier(c.dossier)} : {}),
    ...(c.roleplay !== undefined ? { roleplay: validateRoleplay(c.roleplay, `${label}.roleplay`) } : {}),
    ...(c.companion !== undefined ? { companion: validateCompanion(c.companion, `${label}.companion`) } : {}),
    ...(c.desktopProfile !== undefined
      ? { desktopProfile: validateDesktopProfile(c.desktopProfile, `${label}.desktopProfile`) }
      : {}),
    ...(c.visualReferences !== undefined
      ? { visualReferences: validateReferences(c.visualReferences, `${label}.visualReferences`, budget) }
      : {}),
    ...(c.referenceCandidates !== undefined
      ? {
          referenceCandidates: validateReferences(
            c.referenceCandidates,
            `${label}.referenceCandidates`,
            budget,
            8,
          ),
        }
      : {}),
    ...(c.referenceWarnings !== undefined
      ? {
          referenceWarnings: array(c.referenceWarnings, `${label}.referenceWarnings`, 10, (v, l) =>
            string(v, l, 1000),
          ),
        }
      : {}),
    quotes: array(c.quotes, `${label}.quotes`, 50, (v, l) => {
      record(v, l);
      const quote = { text: string(v.text, `${l}.text`, 4000) };
      if (v.sourceUrl !== undefined) quote.sourceUrl = webUrl(v.sourceUrl, `${l}.sourceUrl`);
      return quote;
    }),
    sources: array(c.sources, `${label}.sources`, 50, (v, l) => {
      record(v, l);
      return {
        title: string(v.title, `${l}.title`, 1000),
        url: webUrl(v.url, `${l}.url`),
        snippet: string(v.snippet, `${l}.snippet`, 12000),
      };
    }),
    unknowns: array(c.unknowns, `${label}.unknowns`, 50, (v, l) => string(v, l, 4000)),
    ...(c.theme !== undefined
      ? {
          theme: enumValue(c.theme, ['auto', 'rose', 'violet', 'ocean', 'forest', 'amber'], `${label}.theme`),
        }
      : {}),
    ...(c.accent !== undefined
      ? { accent: /^#[0-9a-f]{6}$/i.test(c.accent) ? c.accent : invalid(label, 'invalid accent color') }
      : {}),
    behavior: numbers,
    createdAt: date(c.createdAt, `${label}.createdAt`),
  };
}

function validateCompanion(value, label) {
  const profile = record(value, label);
  if (profile.version !== 1) invalid(label, 'unsupported companion profile version');
  const replies = record(profile.replies, `${label}.replies`);
  const events = [
    'greet',
    'touch',
    'headpat',
    'poke',
    'drag',
    'rest',
    'wake',
    'comfort',
    'thanks',
    'focus',
    'farewell',
    'unknown',
  ];
  if (Object.keys(replies).some((key) => !events.includes(key))) invalid(label, 'unknown interaction event');
  return {
    version: 1,
    replies: Object.fromEntries(
      Object.entries(replies).map(([key, lines]) => [
        key,
        array(lines, `${label}.replies.${key}`, 12, (line, l) => string(line, l, 1000, false)),
      ]),
    ),
  };
}
function validateRoleplay(value, label) {
  const r = record(value, label);
  return {
    timeline: string(r.timeline, label, 1000),
    relationship: string(r.relationship, label, 1000),
    voiceRules: array(r.voiceRules, label, 12, (v, l) => string(v, l, 400)),
    avoid: array(r.avoid, label, 12, (v, l) => string(v, l, 400)),
    customFacts: array(r.customFacts, label, 24, (v, l) => string(v, l, 500)),
    spoilerPolicy: enumValue(r.spoilerPolicy, ['avoid', 'allow'], label),
  };
}
function rasterImage(value, label, budget, limit = MAX_IMAGE_BYTES) {
  // Keep imported assets self-contained. In particular, SVG, file URLs and remote trackers are not accepted.
  string(value, label, Math.ceil(limit / 3) * 4 + 64, false);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) invalid(label, 'expected a base64 PNG, JPEG or WebP image');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > limit || bytes.toString('base64') !== match[2])
    invalid(label, 'invalid or oversized image');
  const valid =
    match[1] === 'png'
      ? bytes.length >= 24 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString('ascii', 12, 16) === 'IHDR'
      : match[1] === 'jpeg'
        ? bytes.length >= 4 &&
          bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes[2] === 0xff &&
          bytes[bytes.length - 2] === 0xff &&
          bytes[bytes.length - 1] === 0xd9
        : bytes.length >= 16 &&
          bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) invalid(label, 'image contents do not match the declared format');
  if (
    match[1] === 'png' &&
    (bytes.readUInt32BE(16) > 8192 ||
      bytes.readUInt32BE(20) > 8192 ||
      !bytes.readUInt32BE(16) ||
      !bytes.readUInt32BE(20))
  ) {
    invalid(label, 'image dimensions must be between 1 and 8192 pixels');
  }
  budget.bytes += bytes.length;
  if (budget.bytes > MAX_TOTAL_IMAGE_BYTES) invalid(label, 'total image size exceeds 192 MiB');
  return value;
}

function validateReferences(value, label = 'visualReferences', budget = { bytes: 0 }, max = 4) {
  const references = array(value, label, max, (v, l) => {
    record(v, l);
    return {
      id: id(v.id, `${l}.id`),
      name: string(v.name, `${l}.name`, 300, false),
      image: rasterImage(v.image, `${l}.image`, budget),
      ...(v.sourceUrl ? { sourceUrl: webUrl(v.sourceUrl, `${l}.sourceUrl`) } : {}),
      ...(v.imageUrl ? { imageUrl: webUrl(v.imageUrl, `${l}.imageUrl`) } : {}),
      ...(v.origin !== undefined ? { origin: enumValue(v.origin, ['catalog', 'page', 'wiki'], l) } : {}),
      ...(v.match !== undefined ? { match: enumValue(v.match, ['name', 'unverified'], l) } : {}),
      ...(v.width !== undefined || v.height !== undefined
        ? {
            width:
              Number.isInteger(v.width) && v.width > 0 && v.width <= 8192
                ? v.width
                : invalid(l, 'invalid image width'),
            height:
              Number.isInteger(v.height) && v.height > 0 && v.height <= 8192
                ? v.height
                : invalid(l, 'invalid image height'),
          }
        : {}),
      createdAt: date(v.createdAt, `${l}.createdAt`),
    };
  });
  unique(references, label);
  return references;
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(label, 'invalid SHA-256');
  return value;
}

function validateStyleReference(value, label = 'styleReference') {
  const reference = record(value, label);
  return {
    id: id(reference.id, `${label}.id`),
    name: string(reference.name, `${label}.name`, 300, false),
    digest: digest(reference.digest, `${label}.digest`),
  };
}

function validateGeneration(value, label) {
  const g = record(value, label);
  const referenceIds = array(g.referenceIds, label, 4, (v, l) => id(v, l));
  if (!referenceIds.length || new Set(referenceIds).size !== referenceIds.length)
    invalid(label, 'expected unique reference identifiers');
  return {
    referenceIds,
    ...(g.chibiResearch !== undefined ? { chibiResearch: require('./chibi-references.cjs').validateChibiResearch(g.chibiResearch) } : {}),
    referenceDigest: digest(g.referenceDigest, label),
    model: string(g.model, label, 300, false),
    prompt: string(g.prompt, label, 12000, false),
    ...(g.mode !== undefined ? { mode: enumValue(g.mode, ['image', 'program'], label) } : {}),
    ...(g.correctionRequest !== undefined ? { correctionRequest: string(g.correctionRequest, `${label}.correctionRequest`, 600, false) } : {}),
    ...(g.parentSkinId !== undefined ? { parentSkinId: id(g.parentSkinId, label) } : {}),
    ...(g.styleReference !== undefined
      ? { styleReference: validateStyleReference(g.styleReference, `${label}.styleReference`) }
      : {}),
    ...(g.candidateDirection !== undefined
      ? {
          candidateDirection: enumValue(
            g.candidateDirection,
            ['balanced', 'bold', 'soft'],
            `${label}.candidateDirection`,
          ),
        }
      : {}),
  };
}

function validateReview(value, label) {
  const r = record(value, label);
  const status = enumValue(r.status, ['pending', 'approved', 'rejected'], label);
  let animation;
  if (r.animation !== undefined) {
    const a = record(r.animation, label);
    if (
      !Array.isArray(a.frames) ||
      !a.frames.length ||
      a.frames.length > 256 ||
      new Set(a.frames).size !== a.frames.length ||
      a.frames.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
      a.anatomy !== true ||
      a.identity !== true ||
      a.continuity !== true
    )
      invalid(label, '动画逐帧验收记录无效');
    animation = { frames: a.frames, anatomy: true, identity: true, continuity: true };
  }
  return {
    status,
    referenceDigest: digest(r.referenceDigest, label),
    imageDigest: digest(r.imageDigest, label),
    ...(r.animationDigest !== undefined ? { animationDigest: digest(r.animationDigest, label) } : {}),
    ...(animation ? { animation } : {}),
    ...(status !== 'pending' ? { reviewedAt: date(r.reviewedAt, label) } : {}),
  };
}

function validateSkin(value, label = 'skin', budget = { bytes: 0 }) {
  const s = record(value, label);
  const inputImages = record(s.images, `${label}.images`);
  const images = {};
  // An animation atlas may be stored as a file next to the state (see skin-assets.cjs); its
  // size is then recorded with the skin, since the image is not at hand here.
  const storedAtlas = s.sprite !== undefined && isAsset(inputImages.neutral);
  for (const emotion of EMOTIONS) {
    if (inputImages[emotion] === undefined) continue;
    if (emotion === 'neutral' && storedAtlas) images.neutral = inputImages.neutral;
    else
      images[emotion] = rasterImage(
        inputImages[emotion],
        `${label}.images.${emotion}`,
        budget,
        emotion === 'neutral' && s.sprite !== undefined ? MAX_ATLAS_BYTES : MAX_IMAGE_BYTES,
      );
  }
  let sprite, atlasSize;
  if (s.sprite !== undefined) {
    if (!(storedAtlas || images.neutral?.startsWith('data:image/png;')) || (s.kind && s.kind !== 'image'))
      invalid(label, '逐帧动画需要自包含的 PNG 图集');
    if (storedAtlas) {
      const size = record(s.atlasSize, `${label}.atlasSize`);
      atlasSize = {
        width: integerValue(size.width, `${label}.atlasSize.width`, 1, 8192),
        height: integerValue(size.height, `${label}.atlasSize.height`, 1, 8192),
      };
    } else {
      const bytes = Buffer.from(images.neutral.split(',')[1], 'base64');
      atlasSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    sprite = require('./sprites.cjs').validateAnimation(s.sprite, atlasSize);
    // Embedded extra pages count toward the workspace image budget like the main atlas.
    for (const [i, page] of (sprite.pages || []).entries())
      if (!isAsset(page.src)) rasterImage(page.src, `${label}.sprite.pages.${i}`, budget, MAX_ATLAS_BYTES);
  }
  let drawing;
  if (s.drawing !== undefined) {
    if (!sprite) invalid(label, '程序绘图需要配套的像素动画图集');
    drawing = require('./pixel-program.cjs').validateProgram(s.drawing, s.style);
  }
  let review = s.review !== undefined ? validateReview(s.review, `${label}.review`) : undefined;
  if (review && sprite) {
    const currentDigest = require('./animation-quality.cjs').animationDigest(sprite);
    if (review.status === 'approved' && review.animationDigest !== undefined) {
      if (review.animationDigest !== currentDigest || review.imageDigest !== imageDigest(images.neutral))
        invalid(label, '动画图像或时序已经改变，请重新逐帧核对');
      require('./animation-quality.cjs').validateFrameReview(sprite, review.imageDigest, {
        ...review.animation,
        imageDigest: review.imageDigest,
        animationDigest: review.animationDigest,
      });
    } else if (review.status === 'pending') review = { ...review, animationDigest: currentDigest };
  }
  return {
    ...(storedAtlas ? { atlasSize } : {}),
    id: id(s.id, `${label}.id`),
    characterId: id(s.characterId, `${label}.characterId`),
    name: string(s.name, `${label}.name`, 300, false),
    style: enumValue(
      s.style,
      [
        'original',
        'anime',
        'chibi',
        'chibi-pet',
        'sticker',
        'pastel',
        'figure',
        'powerpuff',
        'pixel',
        '8bit',
        'realistic',
        '3d',
        'watercolor',
        'plush',
        'figurine',
      ],
      `${label}.style`,
    ),
    ...(s.kind !== undefined
      ? { kind: enumValue(s.kind, ['image', 'live2d', 'vrm', 'glb'], `${label}.kind`) }
      : {}),
    // Motions the user described themselves, by name (the clips are in the sprite).
    ...(s.customMotions !== undefined && sprite
      ? { customMotions: require('./custom-motion.cjs').motionLabels(s.customMotions) }
      : {}),
    ...(s.builtin !== undefined
      ? {
          builtin: enumValue(
            s.builtin,
            [
              'cyrene-chibi-v6',
              'cyrene-original-v1',
              'cyrene-powerpuff-v1',
              'cyrene-pixel-v6',
              'cyrene-anime-v5',
              'cyrene-8bit-v5',
              'cyrene-realistic-v5',
              'cyrene-3d-v5',
              'cyrene-anime-v4',
              'cyrene-chibi-v4',
              'cyrene-pixel-v4',
              'cyrene-watercolor-v4',
              'cyrene-plush-v4',
              'cyrene-figurine-v4',
              'cyrene-reference-v3',
              'cyrene-anime',
              'cyrene-chibi',
              'cyrene-pixel',
              'cyrene-plush',
            ],
            `${label}.builtin`,
          ),
        }
      : {}),
    ...(s.model !== undefined ? { model: validateModel(s.model, label) } : {}),
    ...(sprite ? { sprite } : {}),
    ...(drawing ? { drawing } : {}),
    images,
    createdAt: date(s.createdAt, `${label}.createdAt`),
    generated: boolean(s.generated, `${label}.generated`),
    ...(s.generation !== undefined
      ? { generation: validateGeneration(s.generation, `${label}.generation`) }
      : {}),
    ...(review ? { review } : {}),
  };
}

function validateModel(value, label) {
  const m = record(value, label);
  require('./models.cjs').safePath(m.entry);
  const motions = {};
  for (const [key, count] of Object.entries(record(m.motions, label))) {
    string(key, label, 128);
    if (
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > 100
    )
      invalid(label, 'invalid motions');
    motions[key] = count;
  }
  if (Object.keys(motions).length > 100) invalid(label, 'too many motions');
  const expressions = array(m.expressions, label, 100, (v, l) => string(v, l, 128));
  const expressionMap = {},
    motionMap = {};
  for (const key of EMOTIONS)
    if (m.expressionMap?.[key] && expressions.includes(m.expressionMap[key]))
      expressionMap[key] = m.expressionMap[key];
  for (const key of ACTIONS)
    if (m.motionMap?.[key] && Object.hasOwn(motions, m.motionMap[key])) motionMap[key] = m.motionMap[key];
  const boneMap = {};
  if (m.boneMap?.head !== undefined) boneMap.head = string(m.boneMap.head, label, 128, false);
  return {
    id: id(m.id, label),
    entry: m.entry,
    expressions,
    motions,
    expressionMap,
    motionMap,
    ...(Object.keys(boneMap).length ? { boneMap } : {}),
  };
}

function scaleValue(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(label, 'expected a number');
  return Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;
}
function validateSettings(value) {
  const s = record(value, 'settings');
  if (s.codexHome !== undefined && (typeof s.codexHome !== 'string' || s.codexHome.length > 1024 || s.codexHome.includes('\0') || (s.codexHome && !path.isAbsolute(s.codexHome))))
    throw new Error('Codex 账号目录必须是绝对路径，留空使用默认登录。');
  return {
    ...(s.rememberInteractions !== undefined ? {rememberInteractions:boolean(s.rememberInteractions,'settings.rememberInteractions')} : {}),
    ...(s.codexHome !== undefined ? { codexHome: s.codexHome } : {}),
    ...(s.desktopLifeEnabled !== undefined ? {desktopLifeEnabled:boolean(s.desktopLifeEnabled,'settings.desktopLifeEnabled')} : {}),
    ...(s.petSize !== undefined
      ? { petSize: enumValue(s.petSize, ['small', 'medium', 'large'], 'settings.petSize') }
      : {}),
    // Free sizing: the desktop pet's figure height and the in-app stage zoom.
    ...(s.petScale !== undefined ? { petScale: scaleValue(s.petScale, 0.45, 2.6, 'settings.petScale') } : {}),
    ...(s.stageZoom !== undefined ? { stageZoom: scaleValue(s.stageZoom, 0.5, 2, 'settings.stageZoom') } : {}),
    // Built-in looks the user deleted; they are not restored on the next start.
    ...(s.removedBuiltins !== undefined
      ? {
          removedBuiltins: array(s.removedBuiltins, 'settings.removedBuiltins', 50, (v, l) =>
            string(v, l, 128, false),
          ),
        }
      : {}),
    ...(s.welcomeDismissed !== undefined ? { welcomeDismissed: boolean(s.welcomeDismissed, 'settings.welcomeDismissed') } : {}),
    ...(s.chatMode !== undefined
      ? { chatMode: enumValue(s.chatMode, ['model', 'local'], 'settings.chatMode') }
      : {}),
    ...(s.llmProvider !== undefined ? {llmProvider:enumValue(s.llmProvider,require('../shared/chat-providers.json').map(p=>p.id),'settings.llmProvider')} : {}),
    ...(s.llmOutputMode !== undefined ? {llmOutputMode:enumValue(s.llmOutputMode,['json','prompt'],'settings.llmOutputMode')} : {}),
    ...(s.llmThinking !== undefined ? {llmThinking:enumValue(s.llmThinking,['auto','off'],'settings.llmThinking')} : {}),
    llmBaseUrl: webUrl(s.llmBaseUrl, 'settings.llmBaseUrl', true),
    ...(s.llmProtocol !== undefined
      ? { llmProtocol: enumValue(s.llmProtocol, ['openai', 'anthropic', 'codex'], 'settings.llmProtocol') }
      : {}),
    ...(s.llmAuthMode !== undefined
      ? { llmAuthMode: enumValue(s.llmAuthMode, ['api-key', 'bearer'], 'settings.llmAuthMode') }
      : {}),
    ...(s.llmEndpointMode !== undefined
      ? { llmEndpointMode: enumValue(s.llmEndpointMode, ['base', 'exact'], 'settings.llmEndpointMode') }
      : {}),
    llmModel: string(s.llmModel, 'settings.llmModel', 300),
    ...(s.searchProvider !== undefined
      ? {
          searchProvider: enumValue(
            s.searchProvider,
            ['none', 'claude', 'codex', 'searxng', 'wiki', 'tavily'],
            'settings.searchProvider',
          ),
        }
      : {}),
    ...(s.searxngBaseUrl !== undefined
      ? { searxngBaseUrl: webUrl(s.searxngBaseUrl, 'settings.searxngBaseUrl', true) }
      : {}),
    ...(s.wikiApiUrl !== undefined ? { wikiApiUrl: webUrl(s.wikiApiUrl, 'settings.wikiApiUrl', true) } : {}),
    ...(s.chatHistoryBudget !== undefined
      ? {
          chatHistoryBudget: enumValue(
            s.chatHistoryBudget,
            [6000, 12000, 24000],
            'settings.chatHistoryBudget',
          ),
        }
      : {}),
    imageBaseUrl: webUrl(s.imageBaseUrl, 'settings.imageBaseUrl', true),
    imageModel: string(s.imageModel, 'settings.imageModel', 300),
    ...(s.modelBaseUrl !== undefined
      ? { modelBaseUrl: webUrl(s.modelBaseUrl, 'settings.modelBaseUrl', true) }
      : {}),
    ...(s.modelVersion !== undefined
      ? { modelVersion: string(s.modelVersion, 'settings.modelVersion', 100) }
      : {}),
    ...(s.imageProvider !== undefined
      ? { imageProvider: enumValue(s.imageProvider, ['api', 'codex'], 'settings.imageProvider') }
      : {}),
    ...(s.imageInputFidelity !== undefined
      ? {
          imageInputFidelity: enumValue(
            s.imageInputFidelity,
            ['auto', 'high'],
            'settings.imageInputFidelity',
          ),
        }
      : {}),
    ...(s.ttsBaseUrl !== undefined ? { ttsBaseUrl: webUrl(s.ttsBaseUrl, 'settings.ttsBaseUrl', true) } : {}),
    ...(s.ttsModel !== undefined ? { ttsModel: string(s.ttsModel, 'settings.ttsModel', 300) } : {}),
    ...(s.ttsVoice !== undefined ? { ttsVoice: string(s.ttsVoice, 'settings.ttsVoice', 200) } : {}),
    ...(s.voiceEnabled !== undefined
      ? { voiceEnabled: boolean(s.voiceEnabled, 'settings.voiceEnabled') }
      : {}),
    ...(s.voiceRate !== undefined
      ? {
          voiceRate:
            typeof s.voiceRate === 'number' && s.voiceRate >= 0.5 && s.voiceRate <= 2
              ? s.voiceRate
              : invalid('settings', 'invalid voice rate'),
        }
      : {}),
    demoMode: boolean(s.demoMode, 'settings.demoMode'),
    proactiveEnabled: boolean(s.proactiveEnabled, 'settings.proactiveEnabled'),
    ...(s.motionEnabled !== undefined
      ? { motionEnabled: boolean(s.motionEnabled, 'settings.motionEnabled') }
      : {}),
    ...(s.trackingEnabled !== undefined
      ? { trackingEnabled: boolean(s.trackingEnabled, 'settings.trackingEnabled') }
      : {}),
  };
}
function unique(values, label) {
  const ids = new Set();
  for (const value of values) {
    if (ids.has(value.id)) invalid(label, `duplicate identifier ${value.id}`);
    ids.add(value.id);
  }
  return ids;
}
function validateMessage(value, label) {
  const m = record(value, label);
  const result = {
    id: id(m.id, `${label}.id`),
    role: enumValue(m.role, ['user', 'assistant'], `${label}.role`),
    content: string(m.content, `${label}.content`, 32000),
    createdAt: date(m.createdAt, `${label}.createdAt`),
  };
  if (m.emotion !== undefined) result.emotion = enumValue(m.emotion, EMOTIONS, `${label}.emotion`);
  if (m.action !== undefined)
    result.action = require('./custom-motion.cjs').ID.test(m.action)
      ? m.action
      : enumValue(m.action, ACTIONS, `${label}.action`);
  if (m.origin !== undefined) {
    if (m.role !== 'assistant') invalid(label, 'only assistant replies have an origin');
    result.origin = enumValue(m.origin, ['model', 'script'], `${label}.origin`);
  }
  if (m.interaction !== undefined) {
    if (m.origin !== 'script') invalid(label, 'only a local response can declare a scripted interaction');
    result.interaction = enumValue(
      m.interaction,
      [
        'greet',
        'touch',
        'headpat',
        'poke',
        'drag',
        'rest',
        'wake',
        'comfort',
        'thanks',
        'focus',
        'farewell',
        'unknown',
      ],
      `${label}.interaction`,
    );
  }
  if (m.contextStart !== undefined) {
    if (m.role !== 'user') invalid(label, 'only a user message can begin a topic');
    result.contextStart = boolean(m.contextStart, `${label}.contextStart`);
  }
  if (m.replyTo !== undefined) {
    if (m.role !== 'assistant') invalid(label, 'only an assistant message can reference a reply');
    result.replyTo = id(m.replyTo, `${label}.replyTo`);
  }
  return result;
}

function validateState(value) {
  const s = record(value, 'state');
  const budget = { bytes: 0 };
  const characters = array(s.characters, 'characters', 100, (v, l) => validateCharacter(v, l, budget));
  const characterIds = unique(characters, 'characters');
  const skins = array(s.skins, 'skins', 200, (v, l) => validateSkin(v, l, budget));
  const skinIds = unique(skins, 'skins');
  for (const skin of skins) if (!characterIds.has(skin.characterId)) invalid('skins', 'unknown character');
  const activeCharacterId = id(s.activeCharacterId, 'activeCharacterId', true);
  const activeSkinId = id(s.activeSkinId, 'activeSkinId', true);
  if (activeCharacterId && !characterIds.has(activeCharacterId))
    invalid('activeCharacterId', 'unknown character');
  if (
    activeSkinId &&
    (!skinIds.has(activeSkinId) ||
      skins.find((skin) => skin.id === activeSkinId).characterId !== activeCharacterId)
  )
    invalid('activeSkinId', 'skin does not belong to the active character');
  const messages = {};
  let preferredSkins;
  if (s.preferredSkins !== undefined) {
    const input = record(s.preferredSkins, 'preferredSkins');
    if (Object.keys(input).length > 100) invalid('preferredSkins', 'too many characters');
    preferredSkins = Object.fromEntries(
      Object.entries(input).filter(
        ([characterId, skinId]) =>
          characterIds.has(characterId) &&
          skins.some((skin) => skin.id === skinId && skin.characterId === characterId),
      ),
    );
  }
  const inputMessages = record(s.messages, 'messages');
  if (Object.keys(inputMessages).length > 100) invalid('messages', 'too many conversations');
  for (const [characterId, history] of Object.entries(inputMessages)) {
    id(characterId, 'messages character identifier');
    if (!characterIds.has(characterId)) invalid('messages', 'unknown character');
    messages[characterId] = array(history, `messages.${characterId}`, 100000, validateMessage);
    unique(messages[characterId], `messages.${characterId}`);
  }
  const memories = array(s.memories, 'memories', 5000, (m, l) => {
    record(m, l);
    const characterId = id(m.characterId, `${l}.characterId`);
    if (!characterIds.has(characterId)) invalid(l, 'unknown character');
    return {
      id: id(m.id, `${l}.id`),
      characterId,
      text: string(m.text, `${l}.text`, 8000),
      ...(m.kind !== undefined ? {kind:enumValue(m.kind,['preference','interaction','promise','boundary'],l)} : {}),
      ...(m.origin !== undefined ? {origin:enumValue(m.origin,['user-confirmed','user-stated','interaction'],l)} : {}),
      ...(m.sourceMessageId !== undefined ? {sourceMessageId:id(m.sourceMessageId,l)} : {}),
      createdAt: date(m.createdAt, `${l}.createdAt`),
      ...(m.pinned !== undefined ? { pinned: boolean(m.pinned, l) } : {}),
      ...(m.excluded !== undefined ? { excluded: boolean(m.excluded, l) } : {}),
    };
  });
  unique(memories, 'memories');
  return {
    settings: validateSettings(s.settings),
    characters,
    skins,
    activeCharacterId,
    activeSkinId,
    ...(preferredSkins ? { preferredSkins } : {}),
    messages,
    memories,
    ...(s.revision !== undefined
      ? {
          revision:
            Number.isSafeInteger(s.revision) && s.revision >= 0
              ? s.revision
              : invalid('revision', 'invalid workspace revision'),
        }
      : {}),
  };
}

function validateBundle(value) {
  const b = record(value, 'bundle');
  if (b.version !== 1) invalid('bundle.version', 'unsupported character bundle version');
  const budget = { bytes: 0 };
  const character = validateCharacter(b.character, 'character', budget);
  if (b.skins?.some((s) => s.model || ['live2d', 'vrm'].includes(s.kind)))
    invalid('bundle', '请单独导入 Live2D / VRM 模型，角色包不携带本机模型路径');
  const skins = array(b.skins, 'skins', 24, (v, l) => validateSkin(v, l, budget));
  unique(skins, 'skins');
  if (skins.some((skin) => skin.characterId !== character.id))
    invalid('skins', 'skin belongs to another character');
  return { character, skins };
}
function createBundle(character, skins) {
  return { version: 1, ...validateBundle({ version: 1, character, skins }) };
}

async function readJson(file, limit = MAX_FILE_BYTES) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.size > limit)
    throw new Error('file is not a regular file or exceeds the size limit');
  const contents = await fs.readFile(file);
  if (contents.length > limit) throw new Error('file exceeds the size limit');
  return JSON.parse(contents.toString('utf8'));
}
async function atomicJson(file, value, limit = MAX_FILE_BYTES) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > limit)
    throw new Error('Local data exceeds the storage size limit. Remove unused skins or conversations.');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temp).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function createStore({ dir, safeStorage }) {
  if (typeof dir !== 'string' || !dir) throw new Error('A storage directory is required.');
  const stateFile = path.join(dir, 'state.json');
  const previousStateFile = path.join(dir, 'state.previous.json');
  const keysFile = path.join(dir, 'credentials.enc.json');
  let state = null;
  let stateLoaded = false;
  let stateFault = null;
  let credentials = {};
  let credentialsLoaded = false;
  let credentialsFault = null;
  let queue = Promise.resolve();
  const serial = (task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const secure = () => {
    try {
      return Boolean(
        safeStorage &&
          safeStorage.isEncryptionAvailable() &&
          (!safeStorage.getSelectedStorageBackend ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text'),
      );
    } catch {
      return false;
    }
  };
  const status = () => ({
    llmKey: Boolean(credentials.llmKey),
    searchKey: Boolean(credentials.searchKey),
    imageKey: Boolean(credentials.imageKey),
    ttsKey: Boolean(credentials.ttsKey),
    ...(credentials.modelKey ? { modelKey: true } : {}),
    secure: secure(),
  });
  async function ensureState() {
    if (stateFault) throw stateFault;
    if (stateLoaded) return;
    try {
      const data = await readJson(stateFile);
      state = data === undefined ? null : validateState(data);
      stateLoaded = true;
    } catch (error) {
      stateFault = new Error(
        `Cannot read local state; the original file has been preserved at ${stateFile}. Restore or move this file before restarting. ${error.message}`,
      );
      throw stateFault;
    }
  }
  // Animation atlases are stored as files named by their digest, not inside state.json: a full
  // motion pack is tens of megabytes, and the state is rewritten and sent to every window on
  // each save. The file is written before the state that refers to it.
  const assetDir = path.join(dir, 'skin-assets');
  async function storeAsset(dataUrl) {
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const sha = imageDigest(dataUrl);
    const file = path.join(assetDir, `${sha}.png`);
    try {
      const stat = await fs.lstat(file);
      if (stat.isFile() && stat.size === bytes.length) return { url: assetUrl(sha), bytes };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.mkdir(assetDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, file);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    return { url: assetUrl(sha), bytes };
  }
  async function externalize(value) {
    let changed = false;
    const skins = [];
    for (const skin of value.skins) {
      let next = skin;
      if (skin.sprite && skin.images.neutral?.startsWith('data:image/png;')) {
        const { url, bytes } = await storeAsset(skin.images.neutral);
        next = {
          ...next,
          images: { ...next.images, neutral: url },
          atlasSize: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
        };
        changed = true;
      }
      if (skin.sprite?.pages?.some((page) => !isAsset(page.src))) {
        const pages = [];
        for (const page of skin.sprite.pages)
          pages.push(isAsset(page.src) ? page : { ...page, src: (await storeAsset(page.src)).url });
        next = { ...next, sprite: { ...next.sprite, pages } };
        changed = true;
      }
      skins.push(next);
    }
    return changed ? validateState({ ...value, skins }) : value;
  }
  async function writeState(value) {
    // Only a successfully validated state can become the previous snapshot.
    // If either write fails, keep the in-memory state at its last committed value.
    value = await externalize(value);
    if (state !== null) await atomicJson(previousStateFile, state);
    await atomicJson(stateFile, value);
    state = value;
  }
  const referenced = (value, into) => {
    for (const skin of value?.skins || []) {
      for (const source of [skin.images?.neutral, ...(skin.sprite?.pages || []).map((p) => p.src)]) {
        const match = typeof source === 'string' && ASSET.exec(source);
        if (match) into.add(`${match[1]}.png`);
      }
    }
    return into;
  };
  async function readAsset(url) {
    const match = ASSET.exec(url);
    if (!match) throw new Error('无效的动画图集引用。');
    const bytes = await fs.readFile(path.join(assetDir, `${match[1]}.png`));
    if (imageDigest(`data:image/png;base64,${bytes.toString('base64')}`) !== match[1])
      throw new Error('动画图集文件已损坏或被修改。');
    return bytes;
  }
  async function preserveOriginal(file, name) {
    try {
      await fs.lstat(file);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const preserved = path.join(dir, `${name}.rejected-${Date.now()}-${randomUUID()}.json`);
    await fs.copyFile(file, preserved, require('node:fs').constants.COPYFILE_EXCL);
    await fs.chmod(preserved, 0o600);
    return preserved;
  }
  async function ensureCredentials() {
    if (credentialsFault) throw credentialsFault;
    if (credentialsLoaded) return;
    // On systems without secure encryption, secrets live only in this process.
    // Existing encrypted credentials are left untouched for a future secure session.
    if (!secure()) {
      credentialsLoaded = true;
      return;
    }
    try {
      const envelope = await readJson(keysFile, 128 * 1024);
      if (envelope !== undefined) {
        record(envelope, 'encrypted credentials');
        if (
          envelope.version !== 1 ||
          typeof envelope.data !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data) ||
          envelope.data.length % 4 !== 0
        )
          throw new Error('invalid credential envelope');
        const bytes = Buffer.from(envelope.data, 'base64');
        if (bytes.toString('base64') !== envelope.data) throw new Error('invalid encrypted data');
        const plain = safeStorage.decryptString(bytes);
        const decoded = record(JSON.parse(plain), 'credentials');
        for (const key of KEY_NAMES) {
          if (decoded[key] !== undefined) {
            const value = string(decoded[key], key, 8192);
            if (value) credentials[key] = value;
          }
        }
      }
      credentialsLoaded = true;
    } catch (error) {
      credentials = {};
      credentialsFault = new Error(
        `Cannot decrypt saved API keys; the original file has been preserved at ${keysFile}. Restore or move this file before restarting.`,
      );
      throw credentialsFault;
    }
  }
  return {
    assetDir,
    readAsset,
    /** Skins with stored atlases turned back into self-contained data URLs (for export). */
    inlineAssets: async (skins) =>
      Promise.all(
        skins.map(async (skin) => {
          if (!skin.sprite || !isAsset(skin.images?.neutral)) return skin;
          const inline = async (url) => `data:image/png;base64,${(await readAsset(url)).toString('base64')}`;
          const { atlasSize: _size, ...rest } = skin;
          return {
            ...rest,
            images: { ...skin.images, neutral: await inline(skin.images.neutral) },
            sprite: skin.sprite.pages
              ? { ...skin.sprite, pages: await Promise.all(skin.sprite.pages.map(async (p) => ({ ...p, src: isAsset(p.src) ? await inline(p.src) : p.src }))) }
              : skin.sprite,
          };
        }),
      ),
    /** Remove stored atlases nothing refers to any more (deleted or replaced looks). */
    collectAssets: () =>
      serial(async () => {
        await ensureState();
        const keep = referenced(state, new Set());
        try {
          referenced(await readJson(previousStateFile), keep);
        } catch {
          return 0; // An unreadable snapshot might still need its files.
        }
        let removed = 0;
        let names = [];
        try {
          names = await fs.readdir(assetDir);
        } catch (error) {
          if (error.code === 'ENOENT') return 0;
          throw error;
        }
        for (const name of names) {
          if (keep.has(name) || !/^[0-9a-f]{64}\.png$/.test(name)) continue;
          const stat = await fs.lstat(path.join(assetDir, name));
          // Leave anything written in the last few minutes to a save that is still settling.
          if (Date.now() - stat.mtimeMs < 10 * 60000) continue;
          await fs.rm(path.join(assetDir, name), { force: true });
          removed++;
        }
        return removed;
      }),
    loadState: () =>
      serial(async () => {
        await ensureState();
        return state === null ? null : structuredClone(state);
      }),
    retryLoadState: () =>
      serial(async () => {
        stateLoaded = false;
        stateFault = null;
        await ensureState();
        return state === null ? null : structuredClone(state);
      }),
    getRecoveryStatus: () =>
      serial(async () => {
        try {
          const previous = await readJson(previousStateFile);
          if (previous === undefined) return { hasPreviousState: false };
          validateState(previous);
          return { hasPreviousState: true };
        } catch {
          return { hasPreviousState: false };
        }
      }),
    restorePreviousState: () =>
      serial(async () => {
        const previous = await readJson(previousStateFile);
        if (previous === undefined) throw new Error('没有可恢复的上一份工作区存档。');
        const snapshot = validateState(previous);
        // Restoring old content is a new commit. Existing pet windows discard
        // broadcasts with an older revision, so never roll the counter back.
        const restored = validateState({
          ...snapshot,
          revision: Math.max(state?.revision || 0, snapshot.revision || 0) + 1,
        });
        await preserveOriginal(stateFile, 'state');
        // Do not replace the known-good backup with the damaged current file.
        await atomicJson(stateFile, restored);
        state = restored;
        stateLoaded = true;
        stateFault = null;
        return structuredClone(state);
      }),
    resetCredentials: () =>
      serial(async () => {
        await preserveOriginal(keysFile, 'credentials');
        await fs.rm(keysFile, { force: true });
        credentials = {};
        credentialsFault = null;
        credentialsLoaded = true;
        return status();
      }),
    saveState: (value) =>
      serial(async () => {
        const cleaned = validateState(value);
        await ensureState();
        await writeState(cleaned);
      }),
    saveMergedState: (value, base) =>
      serial(async () => {
        const next = validateState(value),
          before = base ? validateState(base) : null;
        await ensureState();
        const merged = validateState({
          ...mergeSnapshots(before, next, state),
          revision: (state?.revision || 0) + 1,
        });
        await writeState(merged);
        return structuredClone(state);
      }),
    saveSettings: (settings, changes = {}, baseSettings) =>
      serial(async () => {
        let cleanedSettings = validateSettings(settings);
        record(changes, 'credentials');
        await ensureState();
        if (baseSettings && state)
          cleanedSettings = validateSettings(
            mergeValue(validateSettings(baseSettings), cleanedSettings, state.settings, ['settings']),
          );
        let credentialsAvailable = true;
        try {
          await ensureCredentials();
        } catch (error) {
          if (KEY_NAMES.some((key) => changes[key] !== undefined)) throw error;
          // A broken keychain must not prevent selecting local chat or changing
          // other offline preferences. Leave the encrypted file untouched.
          credentialsAvailable = false;
        }
        const next = { ...credentials };
        for (const key of KEY_NAMES) {
          if (changes[key] !== undefined) {
            const value = string(changes[key], key, 8192).trim();
            if (value) next[key] = value;
            else delete next[key];
          }
        }
        if (credentialsAvailable && secure()) {
          const encrypted = safeStorage.encryptString(JSON.stringify(next));
          if (!Buffer.isBuffer(encrypted) || !encrypted.length)
            throw new Error('The system key store failed to encrypt API keys.');
          await atomicJson(keysFile, { version: 1, data: encrypted.toString('base64') }, 128 * 1024);
        }
        credentials = next;
        if (state !== null) {
          const nextState = {
            ...state,
            settings: cleanedSettings,
            ...(state.revision !== undefined ? { revision: state.revision + 1 } : {}),
          };
          await writeState(nextState);
        }
        return { ...status(), ...(credentialsFault ? { credentialError: credentialsFault.message } : {}) };
      }),
    getCredentials: () =>
      serial(async () => {
        await ensureCredentials();
        return { ...credentials };
      }),
    getKeyStatus: () =>
      serial(async () => {
        try {
          await ensureCredentials();
          return status();
        } catch (error) {
          return { ...status(), credentialError: error.message };
        }
      }),
  };
}

module.exports = {
  createStore,
  validateState,
  validateSettings,
  validateCharacter,
  validateReferences,
  validateStyleReference,
  validateSkin,
  validateBundle,
  createBundle,
  validateDesktopProfile,
  MAX_FILE_BYTES,
};
