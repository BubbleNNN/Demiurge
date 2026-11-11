import type { AppState, Character, Skin } from './types';
const createdAt = '2026-09-29T12:00:00.000Z';
export const cyrene: Character = {
  id: 'mori-cyrene',
  name: '昔涟',
  work: '崩坏：星穹铁道',
  theme: 'rose',
  summary:
    '来自翁法罗斯、与哀丽秘榭相关的角色。她的问候和爱好语音呈现亲近、轻快的表达，常以共同相处、星星和秋千展开邀请。此陪伴版本默认避开剧情转折。',
  personality: ['亲近', '轻快', '浪漫'],
  speakingStyle:
    '依据问候、秋千与星星语音提炼：温柔且俏皮，主动邀请一起做小事；可自然使用“人家”，偶尔用♪，避免每句话都堆叠抒情比喻。新回复是二次创作，不冒充原作台词。',
  roleplay: {
    timeline: '日常陪伴，默认不主动展开主线剧情转折',
    relationship: '刚开始相处的朋友，由聊天逐渐熟悉；不自动设定为恋人或原作中的任何人物',
    voiceRules: [
      '亲近且有一点俏皮，以轻柔邀约表达关心',
      '具体回应眼前的小事，偶尔自然用“人家”或♪',
      '不把每次聊天都写成长诗，不反复复制同一句问候',
    ],
    avoid: [
      '不把昔涟与爱莉希雅或其他相似角色的原作身份混为一谈',
      '不擅自称用户为原作人物或恋人',
      '没有来源的剧情经历与未公开信息保留未知',
    ],
    customFacts: [],
    spoilerPolicy: 'avoid',
  },
  appearance:
    '以原图为准：粉色长发、粉紫色眼睛，蓝紫色晶体与花形发饰；白与淡紫的贴身上装、紫色胸前纹样，短前裙与蓝紫渐变的分片长后摆。文字仅辅助识别，不能代替原图。',
  quotes: [
    {
      text: '嗨，好久不见！接下来…想如何度过美妙的双人时间呢？',
      sourceUrl: 'https://wiki.hoyolab.com/pc/hsr/entry/4003?lang=zh-cn',
    },
  ],
  sources: [
    {
      title: 'HoYoWiki：昔涟角色资料、语音与画廊',
      url: 'https://wiki.hoyolab.com/pc/hsr/entry/4003?lang=zh-cn',
      snippet:
        '角色信息列出阵营翁法罗斯、所属哀丽秘榭。问候语音语气亲近，邀请一起度过时间；爱好语音提到荡秋千、看星星和流星，表达轻快浪漫。资料中的不同解锁阶段存在内容差异，不能混成同一剧情阶段。画廊图像用于外观参考。',
    },
  ],
  unknowns: [
    '初始语气为依据 HoYoWiki 问候及爱好语音作出的创作提炼，完整剧情与解锁阶段尚未整理；内置图像和新对话是二次创作。',
  ],
  behavior: { energy: 45, affection: 80, curiosity: 65 },
  companion: {
    version: 1,
    replies: {
      greet: ['你来啦。今天想先做点什么？人家陪你。', '嗨，给今天留一点轻松的时间吧♪'],
      touch: ['嗯？人家在这里呢。', '被你发现啦。要一起歇一小会儿吗？'],
      headpat: ['嗯……这样也很舒服呢。人家再陪你待一会儿♪', '收到你的关心啦。也记得照顾好自己哦。'],
      poke: ['哎呀，被你找到啦。想和人家说什么？', '嗯？轻一点嘛。人家正在听呢♪'],
      drag: ['换个位置也好。这里能看见你忙什么吗？'],
      rest: ['那就先休息一会儿吧。醒来再接着说。'],
      wake: ['休息好了。接下来，想和人家做什么？'],
      comfort: [
        '今天有点难熬吗？先别急着要求自己做得很好，休息一下也可以。',
        '先把眼前的事情分成小小的一步吧。人家陪你慢慢来。',
      ],
      thanks: ['能帮上一点忙，人家也很开心♪', '不用客气。我们可以一起把下一件小事做好。'],
      focus: ['好，那就先专心做眼前的事。人家在这里陪你。'],
      farewell: ['下次见。记得给自己留一点休息的时间。'],
      unknown: ['这句还没有对应的本地台词。想和人家打个招呼、休息一下，还是要一点鼓励？'],
    },
  },
  createdAt,
};
export const builtinSkins: Skin[] = [
  {
    id: 'cyrene-chibi-v6',
    characterId: cyrene.id,
    name: '大昔涟 · Q版 · 完整互动动画',
    style: 'chibi-pet',
    builtin: 'cyrene-chibi-v6',
    kind: 'image',
    images: {},
    generated: true,
    createdAt: '2026-11-10T17:18:05.916Z',
  },
];
export function initialState(): AppState {
  return {
    settings: {
      welcomeDismissed: false,
      chatMode: 'local',
      llmBaseUrl: 'https://api.openai.com/v1',
      llmModel: '',
      imageBaseUrl: 'https://api.openai.com/v1',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: true,
      motionEnabled: true,
      trackingEnabled: true,
      ttsBaseUrl: 'https://api.openai.com/v1',
      ttsModel: '',
      ttsVoice: 'alloy',
      voiceEnabled: false,
      voiceRate: 1,
    },
    characters: [structuredClone(cyrene)],
    skins: structuredClone(builtinSkins),
    activeCharacterId: cyrene.id,
    activeSkinId: builtinSkins[0].id,
    messages: { [cyrene.id]: [] },
    memories: [],
  };
}
export function migrateState(value: AppState | null): AppState {
  if (!value || !value.characters.length) return initialState();
  const retiredBuiltins = value.skins.filter(
    (s) => s.builtin && s.builtin !== 'cyrene-chibi-v6' && !Object.values(s.images).some(Boolean),
  );
  if (retiredBuiltins.length) {
    const ids = new Set(retiredBuiltins.map((s) => s.id));
    const kept = value.skins.filter((s) => !ids.has(s.id));
    const hasStarter = value.characters.some((c) => c.id === cyrene.id);
    if (
      hasStarter &&
      !value.settings.removedBuiltins?.includes(builtinSkins[0].id) &&
      !kept.some((s) => s.id === builtinSkins[0].id)
    )
      kept.push(structuredClone(builtinSkins[0]));
    value = {
      ...value,
      skins: kept,
      activeSkinId: ids.has(value.activeSkinId)
        ? kept.find((s) => s.characterId === value!.activeCharacterId)?.id || ''
        : value.activeSkinId,
    };
  }
  if (value.settings.demoMode) {
    const hasCyrene = value.characters.some((c) => c.id === cyrene.id);
    return {
      ...value,
      settings: { ...initialState().settings, ...value.settings, demoMode: false },
      characters: hasCyrene ? value.characters : [...value.characters, structuredClone(cyrene)],
      skins: hasCyrene ? value.skins : [...value.skins, ...structuredClone(builtinSkins)],
      activeCharacterId: cyrene.id,
      activeSkinId: builtinSkins[0].id,
    };
  }
  const missing = value.characters.some((c) => c.id === cyrene.id)
    ? builtinSkins.filter(
        (s) => !value.skins.some((v) => v.id === s.id) && !value.settings.removedBuiltins?.includes(s.id),
      )
    : [];
  const characters = value.characters.map((c) => {
    if (c.id !== cyrene.id || c.roleplay) return c;
    const isStarter =
      c.summary ===
      '以昔涟为起点，建立属于你的角色陪伴空间。先核对角色档案，再让她用熟悉的语气回应你的日常。';
    return {
      ...c,
      roleplay: structuredClone(cyrene.roleplay),
      ...(isStarter
        ? {
            summary: cyrene.summary,
            personality: cyrene.personality,
            speakingStyle: cyrene.speakingStyle,
            quotes: c.quotes.length ? c.quotes : cyrene.quotes,
            sources: [
              ...c.sources.filter((s) => s.url !== cyrene.sources[0].url),
              ...structuredClone(cyrene.sources),
            ],
            unknowns: cyrene.unknowns,
          }
        : {}),
    };
  });
  const retired = ['realistic', 'watercolor', 'plush', 'figurine'];
  const selected = value.skins.find((skin) => skin.id === value.activeSkinId);
  const replacesRetired = selected && retired.includes(selected.style);
  if (!missing.length && !replacesRetired && characters.every((c, i) => c === value.characters[i]))
    return value;
  return {
    ...value,
    characters,
    skins: [...structuredClone(missing), ...value.skins],
    activeSkinId: replacesRetired
      ? [...missing, ...value.skins].find(
          (skin) => skin.characterId === value.activeCharacterId && !retired.includes(skin.style),
        )?.id || ''
      : value.activeSkinId,
  };
}
