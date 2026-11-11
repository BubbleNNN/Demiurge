'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { validateDossier, researchedDossier, dossierContext } = require('../electron/character-dossier.cjs');
const { chatRequest } = require('../electron/chat-request.cjs');
const { parameters, presets, requestUrl } = require('../electron/chat-provider.cjs');
const { memoryContext, personaContext, PERSONA_RULES } = require('../electron/persona.cjs');
const { createServices } = require('../electron/services.cjs');
const { validateSettings, validateCharacter } = require('../electron/store.cjs');
const blank = () => ({ personal: [], relationships: [], events: [], traits: [], voice: [] });
const row = (title, extra = {}) => ({
  title,
  detail: '可追溯的具体资料',
  sourceUrls: ['https://example.org/character'],
  spoiler: false,
  status: 'sourced',
  ...extra,
});
test('chat IPC uses only saved identity and message references, even with multi-megabyte images', () => {
  const input = { characterId: 'c', latestMessageId: 'm', skinId: 's' };
  assert.ok(Buffer.byteLength(JSON.stringify(chatRequest(input))) < 1024);
  const legacy = {
    character: { id: 'c', referenceCandidates: [{ image: 'a'.repeat(5000000) }] },
    messages: [{ id: 'm' }],
    memories: [],
  };
  assert.deepEqual(chatRequest(legacy), {
    characterId: 'c',
    latestMessageId: 'm',
    skinId: undefined,
    situation: undefined,
  });
  assert.throws(() => chatRequest({ characterId: 'c', latestMessageId: '' }), /保存/);
});
test('researched biography only attaches sources that actually participated in collection', () => {
  const d = researchedDossier(
    {
      ...blank(),
      relationships: [row('同伴', { sourceUrls: ['https://invented.example/fake'] })],
      personal: [row('姓名')],
    },
    [{ url: 'https://example.org/character' }],
  );
  assert.equal(d.personal[0].status, 'sourced');
  assert.equal(d.relationships[0].status, 'unverified');
  assert.deepEqual(d.relationships[0].sourceUrls, []);
  assert.equal(researchedDossier({ personal: [row('姓名')] }, [], true).personal[0].status, 'unverified');
});
test('dossier validation bounds content, preserves private-setting provenance and rejects malformed rows', () => {
  assert.equal(validateDossier({ personal: [row('私设', { status: 'user' })] }).personal[0].status, 'user');
  assert.throws(() => validateDossier({ events: Array.from({ length: 33 }, () => row('事件')) }), /32/);
  assert.throws(() => validateDossier({ voice: [row('', {})] }), /标题/);
  assert.throws(() => validateDossier({ personal: [row('名', { sourceUrls: ['javascript:alert(1)'] })] }));
});
test('dossier dialogue context hides spoilers, retrieves relevant relationships and separates uncertainty', () => {
  const char = {
    dossier: {
      ...blank(),
      relationships: [row('甲'), row('乙'), row('丙'), row('丁'), row('苏醒者', { status: 'unverified' })],
      events: [row('结局', { spoiler: true })],
      voice: [row('称呼与句式')],
    },
    roleplay: { spoilerPolicy: 'avoid' },
  };
  const c = dossierContext(char, '苏醒者和你是什么关系？');
  assert.equal(c.relationships[0].title, '苏醒者');
  assert.equal(c.relationships[0].status, 'unverified');
  assert.deepEqual(c.events, []);
  char.roleplay.spoilerPolicy = 'allow';
  assert.equal(dossierContext(char).events.length, 1);
  assert.ok(personaContext(char, '苏醒者').dossier.voice.length);
  assert.match(PERSONA_RULES, /辨识度|通用温柔/);
});
test('memory context separates shared experiences, promises and user preferences without leaking other roles', () => {
  const memories = [
    { characterId: 'c', text: '我喜欢绿茶', kind: 'preference', origin: 'user-stated', sourceMessageId: 'u' },
    { characterId: 'c', text: '我们一起看过星星', kind: 'interaction', origin: 'interaction' },
    { characterId: 'c', text: '我们约好再看一次', kind: 'promise' },
    { characterId: 'c', text: '不要叫我老板', kind: 'boundary' },
    { characterId: 'other', text: '别的角色的记忆', pinned: true },
    { characterId: 'c', text: '已停用', excluded: true },
  ];
  const c = memoryContext(memories, 'c', '星星');
  assert.equal(c.sharedExperiences[0].text, '我们一起看过星星');
  assert.equal(c.preferences[0].sourceMessageId, 'u');
  assert.equal(c.promises.length, 1);
  assert.equal(c.boundaries.length, 1);
  assert.equal(JSON.stringify(c).includes('别的角色'), false);
  assert.equal(JSON.stringify(c).includes('已停用'), false);
});
for (const provider of presets.filter((p) => p.protocol === 'openai' && p.base))
  test(provider.label + ' uses its Chat Completions route and chosen JSON contract', async () => {
    let sent;
    const service = createServices(async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
    const config = {
      llmProvider: provider.id,
      llmProtocol: 'openai',
      llmBaseUrl: provider.base,
      llmModel: 'fixture-model',
      llmEndpointMode: 'base',
      llmOutputMode: provider.output,
    };
    assert.equal((await service.testConnection(config, { llmKey: 'fixture-key' })).ok, true);
    assert.equal(sent.url, provider.base + '/chat/completions');
    assert.equal(Boolean(sent.body.response_format), provider.output === 'json');
    assert.equal(sent.body.model, 'fixture-model');
  });
test('Qwen thinking switch is explicit and does not add provider parameters to unrelated services', () => {
  assert.equal(parameters({ llmProvider: 'qwen', llmThinking: 'off' }).enable_thinking, false);
  assert.equal(parameters({ llmProvider: 'deepseek', llmThinking: 'off' }).enable_thinking, undefined);
  assert.equal(requestUrl({ llmBaseUrl: 'https://host/v1', llmEndpointMode: 'exact' }), 'https://host/v1');
  assert.equal(
    requestUrl({ llmBaseUrl: 'https://host/v1', llmEndpointMode: 'base' }),
    'https://host/v1/chat/completions',
  );
});
test('old saved settings remain unchanged while new provider fields survive validation', () => {
  const base = {
    llmBaseUrl: 'https://example.org/v1',
    llmModel: 'fixture',
    imageBaseUrl: '',
    imageModel: '',
    demoMode: false,
    proactiveEnabled: true,
    motionEnabled: true,
    voiceEnabled: false,
  };
  const result = validateSettings({
    ...base,
    llmProvider: 'doubao',
    llmOutputMode: 'prompt',
    llmThinking: 'auto',
  });
  assert.equal(result.llmProvider, 'doubao');
  assert.equal(result.llmOutputMode, 'prompt');
  assert.equal(validateSettings(base).llmProvider, undefined);
});
test('prompt-only JSON also accepts a completed provider thinking prefix without exposing reasoning', async () => {
  const service = createServices(
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '<think>internal</think>\n{"ok":true}' } }] }),
      ),
  );
  assert.equal(
    (
      await service.testConnection(
        { llmBaseUrl: 'https://example.org/v1', llmModel: 'fixture', llmOutputMode: 'prompt' },
        { llmKey: 'fixture-key' },
      )
    ).ok,
    true,
  );
});
