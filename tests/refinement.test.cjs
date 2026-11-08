'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const local = (name) =>
    name.endsWith('.json')
      ? require(path.resolve(path.dirname(file), name))
      : load(path.resolve(path.dirname(file), name + '.ts'));
  new Function(
    'exports',
    'require',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, local);
  return exports;
}
const { initialState, cyrene } = load('src/initial.ts');
const { parseCreationDraft } = load('src/creationDraft.ts');
const { existingCharacter, selectedCharacterSkin, characterReadiness } = load('src/characterReadiness.ts');
const { interactionPlan } = load('src/companion.ts');
const { validateState, validateSettings } = require('../electron/store.cjs');
const { petBounds, clampPetPosition } = require('../electron/pet-layout.cjs');
const { localReply, detectIntent } = require('../electron/companion.cjs');
const {
  dialogueContext,
  normalizeAction,
  availableEmotions,
  usableSkin,
  personaContext,
} = require('../electron/persona.cjs');

test('creation draft tolerates interrupted storage and only restores bounded form fields', () => {
  for (const input of [null, '{broken', 'null', '[]']) assert.equal(parseCreationDraft(input).name, '');
  const draft = parseCreationDraft(
    JSON.stringify({
      name: 'n'.repeat(120),
      work: 'work',
      notes: 'x'.repeat(4000),
      mode: 'execute',
      llmKey: 'do-not-retain',
    }),
  );
  assert.equal(draft.name.length, 80);
  assert.equal(draft.notes.length, 3000);
  assert.equal(draft.mode, 'manual');
  assert.equal('llmKey' in draft, false);
});
test('resuming a saved profile respects both name and work and preserves identity', () => {
  const state = initialState();
  assert.equal(existingCharacter(state, ' 昔涟 ', '崩坏 星穹铁道'), state.characters[0]);
  assert.equal(existingCharacter(state, '昔涟', '不同的作品'), undefined);
  assert.equal(existingCharacter(state, '', cyrene.work), undefined);
});
test('per-character selection skips rejected, stale or foreign skins and prefers animation', () => {
  const state = initialState(),
    character = state.characters[0];
  state.activeSkinId = '';
  state.skins.unshift({ ...state.skins[0], id: 'unreviewed', review: { status: 'pending' } });
  state.preferredSkins = { [character.id]: 'unreviewed' };
  assert.notEqual(selectedCharacterSkin(state, character).id, 'unreviewed');
  state.preferredSkins[character.id] = 'cyrene-powerpuff-v1';
  assert.equal(selectedCharacterSkin(state, character).id, 'cyrene-powerpuff-v1');
  const stale = {
    ...state.skins[1],
    id: 'stale',
    review: { status: 'approved' },
    generation: { referenceIds: ['replaced'] },
  };
  state.skins.unshift(stale);
  state.preferredSkins[character.id] = stale.id;
  assert.notEqual(selectedCharacterSkin(state, character).id, stale.id);
});
test('old workspaces stay unchanged; size and owned preferences survive validation and deleted references are dropped', () => {
  const state = initialState();
  assert.equal(validateState(state).preferredSkins, undefined);
  const saved = validateState({
    ...state,
    settings: { ...state.settings, petSize: 'large' },
    preferredSkins: { [cyrene.id]: 'cyrene-powerpuff-v1', deleted: 'cyrene-original-v1' },
  });
  assert.equal(saved.settings.petSize, 'large');
  assert.deepEqual(saved.preferredSkins, { [cyrene.id]: 'cyrene-powerpuff-v1' });
  assert.throws(() => validateSettings({ ...state.settings, petSize: 'huge' }));
  const before = JSON.stringify(state.characters);
  characterReadiness(state.characters[0], state.skins);
  assert.equal(JSON.stringify(state.characters), before);
  assert.equal(
    characterReadiness(
      {
        ...cyrene,
        id: 'fresh',
        visualReferences: [],
        speakingStyle: '',
        roleplay: undefined,
        companion: undefined,
      },
      state.skins,
    ).appearance,
    false,
  );
});
test('pet sizing keeps the foot anchor while preserving the aspect ratio and work area', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const medium = petBounds('medium', 1, area, { x: 500, y: 400, width: 332, height: 432 });
  const large = petBounds('large', 1, area, medium);
  assert.equal(large.y + large.height, medium.y + medium.height);
  assert.equal(large.x + large.width / 2, medium.x + medium.width / 2);
  assert.ok(large.width > medium.width && large.height > medium.height);
  const small = petBounds('small', 0.5, area, large);
  assert.ok(small.height < medium.height);
  assert.equal(small.y + small.height, large.y + large.height);
});
test('her figure stays on negative-coordinate monitors and after display removal', () => {
  const { bands } = require('../electron/pet-layout.cjs');
  const area = { x: -1280, y: 0, width: 1280, height: 720 };
  const bounds = petBounds('large', 1.6, area, { x: 9999, y: -999, width: 340, height: 480 }, undefined);
  // The figure (the window without its bands) is on the monitor; the bands may hang past it.
  assert.ok(bounds.x + bounds.width / 2 > area.x && bounds.x + bounds.width / 2 < 0);
  assert.ok(bounds.y + bands.top >= 0 && bounds.y + bounds.height - bands.bottom <= 720);
  const far = clampPetPosition(-9999, 9999, bounds, area, 1.6);
  assert.equal(far.y, 720 - bounds.height + bands.bottom, 'her feet rest on the bottom edge');
  assert.ok(far.x < area.x, 'the transparent side of the window may hang past the left edge');
});
test('local IPC and pointer interactions choose identical available actions and scene lines', () => {
  for (const event of Object.keys(require('../shared/companion-events.json'))) {
    for (const actions of [['idle'], ['idle', 'wave', 'nod', 'sleep']]) {
      const emotions = ['neutral', 'happy'];
      const native = localReply({
        character: cyrene,
        messages: [],
        event,
        availableActions: actions,
        availableEmotions: emotions,
      });
      const renderer = interactionPlan(event, cyrene, actions, emotions);
      assert.deepEqual({ text: native.text, action: native.action, emotion: native.emotion }, renderer);
    }
  }
});
test('local lines rotate per intent, including legacy messages without scene metadata', () => {
  const character = {
    ...cyrene,
    companion: { replies: { greet: ['hello-1', 'hello-2'], comfort: ['comfort-1', 'comfort-2'] } },
  };
  const messages = [
    { role: 'assistant', origin: 'script', interaction: 'greet', content: 'hello-1' },
    { role: 'user', content: '我很难过' },
  ];
  assert.equal(localReply({ character, messages }).text, 'comfort-1');
  messages.unshift({ role: 'assistant', origin: 'script', content: 'comfort-1' });
  assert.equal(localReply({ character, messages }).text, 'comfort-2');
  assert.equal(detectIntent('不要睡觉，陪我聊聊'), 'unknown');
});
test('dialogue context selects character-written voice examples and prior openings without promoting them to canon', () => {
  const context = dialogueContext(cyrene, [
    { role: 'assistant', content: '今天想聊点什么？' },
    { role: 'user', content: '我有点难过' },
  ]);
  assert.deepEqual(context.authoredInteractionExamples, cyrene.companion.replies.comfort.slice(0, 3));
  assert.equal(context.previousEndedWithQuestion, true);
  assert.deepEqual(context.recentReplyOpenings, ['今天想聊点什么？']);
  assert.match(context.responseLength, /一到三句/);
  const quotes = [{ text: '今天晴天' }, { text: '一起荡秋千吧' }];
  assert.equal(personaContext({ ...cyrene, quotes }, '荡秋千').quoteExamples[0].text, quotes[1].text);
});
test('actions respect conversational intent, explicit requests and recent repetition', () => {
  const allowed = ['idle', 'wave', 'nod', 'bounce', 'sleep'];
  const check = (action, emotion, latest, recentActions = []) =>
    normalizeAction(action, emotion, allowed, { behavior: { energy: 80 } }, { latest, recentActions });
  assert.equal(check('sleep', 'sleepy', '我睡不着'), 'idle');
  assert.equal(check('sleep', 'sleepy', '不要睡觉'), 'idle');
  assert.equal(check('sleep', 'sleepy', '晚安'), 'sleep');
  assert.equal(check('wave', 'happy', '今天吃什么'), 'idle');
  assert.equal(check('wave', 'happy', '你好'), 'wave');
  assert.equal(check('bounce', 'happy', '我很焦虑'), 'idle');
  assert.equal(check('nod', 'happy', '是呀', ['nod', 'nod']), 'idle');
  assert.equal(check('nod', 'happy', '请点头', ['nod', 'nod']), 'nod');
});
test('native appearance eligibility rejects unreviewed and stale generation regardless of character ID', () => {
  const skin = initialState().skins[0];
  assert.ok(usableSkin(skin, cyrene));
  assert.equal(usableSkin({ ...skin, characterId: 'other' }, cyrene), false);
  assert.equal(usableSkin({ ...skin, review: { status: 'pending' } }, cyrene), false);
  assert.equal(
    usableSkin({ ...skin, generation: { referenceDigest: 'old' }, review: { status: 'approved' } }, cyrene),
    false,
  );
  assert.deepEqual(availableEmotions({ images: { neutral: 'n', happy: 'h' } }), ['neutral', 'happy']);
});
test('an authored closed-eye expression is not interrupted by the neutral blinking track', () => {
  const { selectSpriteFrame } = load('src/animation/timeline.ts');
  const { spriteAnimation } = load('src/artwork.ts');
  const animation = spriteAnimation(initialState().skins.find((s) => s.style === 'powerpuff'));
  const input = {
    time: 3200,
    age: 3200,
    action: 'idle',
    emotion: 'happy',
    talking: false,
    paused: false,
    audioDriven: false,
    mouth: 0,
  };
  assert.equal(selectSpriteFrame(animation, input).clip, 'happy');
  assert.equal(selectSpriteFrame(animation, { ...input, emotion: 'neutral' }).clip, 'blink');
});

test('one chat request carries voice continuity and only returns supported emotions/actions', async () => {
  let body,
    calls = 0;
  const services = require('../electron/services.cjs').createServices(async (_, options) => {
    calls++;
    body = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: '我们慢慢来。',
                emotion: 'surprised',
                action: 'wave',
                memory: null,
              }),
            },
          },
        ],
      }),
    );
  });
  const input = {
    character: cyrene,
    memories: [],
    messages: [
      { role: 'assistant', content: '今天想聊点什么？', action: 'wave' },
      { role: 'user', content: '我有点难过' },
    ],
    availableActions: ['idle', 'wave'],
    availableEmotions: ['neutral', 'happy'],
  };
  const reply = await services.chatWithCharacter(
    input,
    {
      ...initialState().settings,
      llmBaseUrl: 'https://example.test/v1',
      llmModel: 'fixture',
      llmProtocol: 'openai',
    },
    { llmKey: 'fixture-no-real-secret' },
  );
  assert.equal(calls, 1);
  assert.equal(reply.emotion, 'neutral');
  assert.equal(reply.action, 'idle');
  const context = body.messages.find(
    (message) => message.role === 'system' && message.content.includes('authoredInteractionExamples'),
  ).content;
  assert.ok(context.includes(cyrene.companion.replies.comfort[0]));
  assert.ok(context.includes('previousEndedWithQuestion'));
  assert.ok(context.includes('不改变已保存的角色身份'));
});
test('sequence framing unions all poses so raised arms do not change scale; unreadable images keep full bounds', () => {
  const { measureSequenceBounds, fullFigure } = load('src/animation/framing.ts');
  const before = global.document;
  let current;
  const context = {
    clearRect() {},
    drawImage(cell) {
      current = cell;
    },
    getImageData() {
      if (current.unreadable) throw Error('CORS');
      const data = new Uint8ClampedArray(128 * 128 * 4);
      for (const [x, y] of current.opaque) data[(y * 128 + x) * 4 + 3] = 255;
      return { data };
    },
  };
  global.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const idle = {
        opaque: [
          [48, 30],
          [80, 110],
        ],
      },
      wave = {
        opaque: [
          [20, 15],
          [80, 110],
        ],
      };
    const bounds = measureSequenceBounds([idle, wave]);
    assert.deepEqual(bounds, { x: 18 / 128, y: 13 / 128, width: 65 / 128, height: 100 / 128 });
    assert.deepEqual(measureSequenceBounds([wave, idle]), bounds);
    assert.deepEqual(measureSequenceBounds([{ unreadable: true }]), fullFigure);
  } finally {
    global.document = before;
  }
});
test('hit testing ignores transparent pixels and applies head proportion within shared figure bounds', () => {
  const { hitCharacter } = load('src/animation/framing.ts');
  let alpha = 255;
  const canvas = {
    width: 200,
    height: 400,
    dataset: { figureBounds: JSON.stringify({ x: 20, y: 80, width: 160, height: 240 }) },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 200 }),
    getContext: () => ({ getImageData: () => ({ data: [0, 0, 0, alpha] }) }),
  };
  const root = {
    querySelector: (selector) =>
      selector.includes('canvas') ? canvas : { dataset: { artStyle: 'powerpuff' } },
  };
  assert.equal(hitCharacter(root, 50, 90), 'headpat');
  assert.equal(hitCharacter(root, 50, 165), 'poke');
  alpha = 0;
  assert.equal(hitCharacter(root, 50, 90), null);
  assert.equal(hitCharacter(root, -5, -5), null);
});

test('a static imported model does not pretend to have interactive animation', () => {
  const character = { ...cyrene, id: 'new' };
  const skin = {
    ...initialState().skins[0],
    characterId: 'new',
    builtin: undefined,
    kind: 'glb',
    images: {},
    model: { motionMap: {}, boneMap: {} },
  };
  assert.equal(characterReadiness(character, [skin]).animation, false);
  skin.model.boneMap.head = 'Head';
  assert.equal(characterReadiness(character, [skin]).animation, true);
});

test('quiet reserved characters use restrained gestures without changing their authored words', () => {
  const quiet = { ...cyrene, behavior: { energy: 20, affection: 15, curiosity: 30 } };
  const actions = ['idle', 'nod', 'wave', 'shake'];
  const emotions = ['neutral', 'happy', 'surprised'];
  for (const event of ['greet', 'headpat', 'poke', 'thanks']) {
    const result = interactionPlan(event, quiet, actions, emotions);
    assert.equal(result.emotion, 'neutral');
    assert.equal(result.action, 'nod');
    const backend = localReply({
      character: quiet,
      event,
      messages: [],
      availableActions: actions,
      availableEmotions: emotions,
    });
    assert.equal(result.action, backend.action);
    assert.equal(result.emotion, backend.emotion);
    assert.equal(result.text, backend.text);
  }
});

test('guided setup chooses the missing dependency and does not require originals for a finished imported pack', () => {
  const { nextCharacterStep } = load('src/characterReadiness.ts');
  const fresh = {
    ...cyrene,
    id: 'new',
    visualReferences: [],
    referenceCandidates: [],
    speakingStyle: '',
    roleplay: undefined,
    companion: undefined,
  };
  assert.equal(nextCharacterStep(fresh, []).key, 'reference');
  assert.match(nextCharacterStep({ ...fresh, referenceCandidates: [{ id: 'candidate' }] }, []).title, /核对/);
  assert.equal(nextCharacterStep({ ...fresh, visualReferences: [{ id: 'ref' }] }, []).key, 'appearance');
  const staticSkin = {
    ...initialState().skins[0],
    characterId: 'new',
    builtin: undefined,
    images: { neutral: 'file.png' },
  };
  assert.equal(nextCharacterStep(fresh, [staticSkin]).key, 'voice');
  assert.equal(nextCharacterStep({ ...fresh, speakingStyle: '自然' }, [staticSkin]).key, 'interaction');
  assert.equal(
    nextCharacterStep({ ...fresh, speakingStyle: '自然', companion: { replies: { greet: ['你好'] } } }, [
      staticSkin,
    ]).key,
    'animation',
  );
  assert.equal(nextCharacterStep({ ...cyrene, visualReferences: [] }, initialState().skins), null);
});
test('copied rehearsal summaries distinguish manual marks and excerpts and stay within clipboard limits', () => {
  const { previewSummary } = load('src/personaPreview.ts');
  const turns = Array.from({ length: 8 }, (_, index) => ({
    question: '问'.repeat(4000),
    reply: { text: '答'.repeat(5000), action: 'idle' },
    feedback: index ? 'adjust' : undefined,
    issues: ['身份设定', '事实依据', '说话语气', '相处关系', '动作表现'],
    note: '注'.repeat(100),
  }));
  const report = previewSummary({ name: '名'.repeat(80), work: '作'.repeat(120) }, turns);
  assert.ok(report.length < 5000);
  assert.match(report, /人工标记/);
  assert.match(report, /摘录/);
  assert.match(report, /尚未标记/);
  assert.match(report, /需要调整/);
});
