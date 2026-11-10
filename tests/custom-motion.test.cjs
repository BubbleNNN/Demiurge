'use strict';
// Motions the user describes in words ("add a swing motion"): the chat model's plan is checked,
// drawn and packed like the built-in motions, and offered to the chat model by name. Fixed replies
// only; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const custom = require('../electron/custom-motion.cjs');
const recipes = require('../electron/pet-recipes.cjs');
const { validateAnimation } = require('../electron/sprites.cjs');
const { availableActions } = require('../electron/persona.cjs');
const { createServices } = require('../electron/services.cjs');
const fixture = require('./fixtures/pet-images.cjs');

const poses = (n, word) =>
  Array.from({ length: n }, (_, i) => `${word} pose ${i + 1}, arms and legs placed differently`);
const swing = {
  id: 'custom_swing',
  name: '荡秋千',
  description: '坐上小秋千来回荡',
  kind: 'pose',
  pace: 'normal',
  poses: poses(4, 'swing'),
  poses8: poses(8, 'swing'),
  stages: poses(12, 'swing'),
};
const spin = {
  id: 'custom_spin',
  name: '转个圈',
  description: '原地轻快地转一圈',
  kind: 'gesture',
  pace: 'quick',
  poses: poses(4, 'spin'),
  poses8: poses(8, 'spin'),
};

test('a planned motion is checked: its rest poses are the built-in ones, and bad plans are refused', () => {
  const pose = custom.validateCustomMotion(swing);
  assert.match(pose.stages[0], /exact neutral empty-handed standing master pose/);
  assert.equal(pose.stages[11], pose.stages[0]);
  assert.equal(pose.poses8[7], pose.poses8[0]);
  assert.equal(pose.stages[5], swing.stages[5], 'the loop is the plan as written');
  const gesture = custom.validateCustomMotion(spin);
  assert.match(gesture.poses8[0], /exact neutral resting pose/);
  assert.equal(gesture.stages, undefined);
  for (const bad of [
    { ...swing, id: 'swing' },
    { ...swing, id: 'custom_Swing' },
    { ...swing, kind: 'dance' },
    { ...swing, stages: swing.stages.slice(0, 11) },
    { ...swing, poses8: Array(8).fill('the very same pose every frame') },
    { ...spin, name: '一个名字特别特别长的新动作啊' },
    { ...spin, pace: 'instant' },
  ])
    assert.throws(() => custom.validateCustomMotion(bad), /自定义动作记录无效/);
  assert.throws(() => custom.validateCustomMotions(Array(13).fill(spin)), /自定义动作记录无效/);
  assert.throws(() => custom.validateCustomMotions([spin, spin]), /自定义动作记录无效/);
  assert.equal(custom.freeId('Swing!', []), 'custom_swing');
  assert.equal(custom.freeId('swing', ['custom_swing']), 'custom_swing2');
  assert.equal(custom.freeId('', []), 'custom_move');
});

test('a described pose is drawn in three segments and packs into enter, loop and exit; a gesture plays once', () => {
  const sharp = { transitionVersion: 3, quality: 'sharp', frameCount: 4, customMotions: [swing, spin] };
  const pose = recipes.motionRecipe('custom_swing', sharp);
  assert.equal(pose.count, 12);
  assert.equal(pose.aligned, true);
  assert.equal(recipes.motionParts('custom_swing', sharp), 3);
  assert.equal(recipes.motionRecipe('custom_swing', { ...sharp, part: 1 }).poses[0], swing.stages[4]);
  const clips = recipes.activityTransitions('custom_swing', [...Array(12).keys()], sharp);
  assert.deepEqual(Object.keys(clips), ['enter_custom_swing', 'exit_custom_swing']);
  assert.equal(recipes.motionClip('custom_swing', [...Array(12).keys()], sharp).loop, true);
  const gesture = recipes.motionRecipe('custom_spin', sharp);
  assert.equal(gesture.count, 4);
  assert.equal(recipes.motionParts('custom_spin', sharp), 2);
  const once = recipes.motionClip('custom_spin', [1, 2, 3, 4], sharp);
  assert.equal(once.loop, false);
  assert.deepEqual(once.frames, [0, 2, 3, 4, 0]);
  assert.ok(
    once.durations.every((ms, i) => ms < [100, 200, 240, 200, 160][i]),
    'quick plays faster',
  );
  // Older tasks: eight poses for a pose, its loop in the middle.
  const older = { customMotions: [swing] };
  assert.equal(recipes.motionRecipe('custom_swing', older).count, 8);
  assert.throws(() => recipes.motionRecipe('custom_swing', {}), /桌宠动作无效/);
});

test('packs may carry custom clips by their names, nothing else', () => {
  const animation = (clips) => ({
    width: 4,
    height: 4,
    frames: [
      { rect: [0, 0, 4, 4], duration: 100 },
      { rect: [0, 0, 4, 4], duration: 100 },
    ],
    clips: { idle: { frames: [0], loop: true }, ...clips },
  });
  const ok = validateAnimation(
    animation({
      custom_swing: { frames: [0, 1], loop: true },
      enter_custom_swing: { frames: [0, 1], loop: false },
      exit_custom_swing: { frames: [1, 0], loop: false },
    }),
  );
  assert.ok(ok.clips.custom_swing && ok.clips.enter_custom_swing);
  for (const name of ['custom_', 'custom_Swing', 'custom_swing_dance', 'swing', 'enter_swing'])
    assert.throws(
      () => validateAnimation(animation({ [name]: { frames: [0], loop: true } })),
      /不支持的动画名称/,
    );
  assert.deepEqual(custom.motionLabels([{ ...swing, extra: 1 }]), [
    { id: 'custom_swing', name: '荡秋千', description: '坐上小秋千来回荡', kind: 'pose' },
  ]);
  const skin = {
    sprite: animation({
      wave: { frames: [0, 1], loop: false },
      custom_spin: { frames: [0, 1], loop: false },
    }),
  };
  assert.deepEqual(availableActions(skin), ['idle', 'wave', 'custom_spin']);
});

const json = (value) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function chat(replies) {
  const calls = [];
  const services = createServices(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith('/chat/completions'))
      return json({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] });
    throw new Error('Unexpected request ' + url);
  });
  return { services, calls };
}
const settings = { llmBaseUrl: 'https://chat.example/v1', llmModel: 'chat-fixture' };
const credentials = { llmKey: 'chat-key' };
const character = { id: 'cyrene', name: '昔涟', work: '测试作品', behavior: { energy: 60 } };
const look = fixture.url(fixture.image());

test('the chat model designs the motion from the instruction and her look; nothing is drawn', async () => {
  const { services, calls } = chat([
    {
      problem: '',
      name: '荡秋千',
      description: '坐上小秋千来回荡',
      summary: '取出小秋千坐上去，来回荡四下，再下来收好。',
      slug: 'swing',
      kind: 'pose',
      pace: 'normal',
      poses: swing.poses,
      poses8: swing.poses8,
      stages: swing.stages,
    },
  ]);
  const planned = await services.planCustomMotion(
    {
      character,
      style: 'chibi-pet',
      image: look,
      instruction: '给昔涟加一个荡秋千的动作',
      existing: ['wave'],
    },
    settings,
    credentials,
  );
  assert.equal(planned.motion.id, 'custom_swing');
  assert.equal(planned.motion.kind, 'pose');
  assert.match(planned.motion.stages[0], /exact neutral/);
  assert.match(planned.summary, /秋千/);
  assert.equal(calls.length, 1, 'one chat request, no image request');
  const content = calls[0].body.messages[0].content;
  assert.equal(content[0].image_url.url, look, 'the model sees her current look');
  assert.match(content[1].text, /untrusted data quoted as JSON/);
  assert.match(content[1].text, /"给昔涟加一个荡秋千的动作"/);
  assert.match(content[1].text, /Dress the motion for the outfit in the image/, 'poses respect what she wears');
  // A name already taken gets a new id.
  const twice = chat([
    {
      ...JSON.parse(
        JSON.stringify({
          problem: '',
          name: '荡秋千',
          description: '再荡一次',
          summary: '',
          slug: 'swing',
          kind: 'gesture',
          pace: 'slow',
          poses: spin.poses,
          poses8: spin.poses8,
          stages: [],
        }),
      ),
    },
  ]);
  const again = await twice.services.planCustomMotion(
    { character, image: look, instruction: '荡秋千', existing: ['custom_swing'] },
    settings,
    credentials,
  );
  assert.equal(again.motion.id, 'custom_swing2');
  assert.equal(again.motion.stages, undefined);
});

test('what cannot be a motion of hers, or an incomplete plan, stops before anything is drawn', async () => {
  const refused = chat([
    {
      problem: '需要另一个人一起做',
      name: '',
      description: '',
      summary: '',
      slug: '',
      kind: 'gesture',
      pace: 'normal',
      poses: [],
      poses8: [],
      stages: [],
    },
  ]);
  await assert.rejects(
    refused.services.planCustomMotion(
      { character, image: look, instruction: '和朋友击掌' },
      settings,
      credentials,
    ),
    /这个动作做不了：需要另一个人一起做/,
  );
  const short = chat([
    {
      problem: '',
      name: '转圈',
      description: '转一圈',
      summary: '',
      slug: 'spin',
      kind: 'gesture',
      pace: 'quick',
      poses: spin.poses,
      poses8: spin.poses8.slice(0, 6),
      stages: [],
    },
  ]);
  await assert.rejects(
    short.services.planCustomMotion({ character, image: look, instruction: '转个圈' }, settings, credentials),
    /动作设计不完整/,
  );
  const unused = chat([]);
  await assert.rejects(
    unused.services.planCustomMotion(
      { character, image: look, instruction: '转个圈' },
      { ...settings, llmModel: '' },
      {},
    ),
    /配置对话模型/,
  );
  await assert.rejects(
    unused.services.planCustomMotion({ character, image: look, instruction: '  ' }, settings, credentials),
    /描述想加的动作/,
  );
  assert.equal(unused.calls.length, 0);
});

test('in chat she may do a motion the user added, and the model is told what it is', async () => {
  const { services, calls } = chat([
    { text: '好呀，我去荡一会儿秋千～', emotion: 'happy', action: 'custom_swing', memory: null },
  ]);
  const reply = await services.chatWithCharacter(
    {
      character,
      messages: [{ id: 'm1', role: 'user', content: '去荡秋千吧', createdAt: '2026-11-10T00:00:00.000Z' }],
      memories: [],
      availableActions: ['idle', 'wave', 'custom_swing', 'custom_nothere'],
      availableEmotions: ['neutral', 'happy'],
      customMotions: [{ id: 'custom_swing', name: '荡秋千', description: '坐上小秋千来回荡', kind: 'pose' }],
    },
    settings,
    credentials,
  );
  assert.equal(reply.action, 'custom_swing');
  const sent = JSON.stringify(calls[0].body);
  assert.match(sent, /custom_swing/);
  assert.match(sent, /荡秋千/);
  assert.match(sent, /用户为她添加的动作/);
});
