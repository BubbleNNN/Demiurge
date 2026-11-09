// How a particular character lives on the desktop: what she likes doing on her own, the small
// habits she has between things, how she gets from place to place, and her manner (shy, teasing,
// playful, calm), which colours her reactions and little expressions. Derived from the
// character's own profile (personality, speaking style, summary, temperament), or written by hand
// for the built-in character. Pure functions.
import type { Activity, Character } from './types';

export type Travel = 'walk' | 'run' | 'hop' | 'fly';
/** Small things she does between activities, instead of standing and staring. */
export type Habit = 'sit' | 'lie' | 'lookAround' | 'stretch' | 'hum';
export interface Manner {
  shy: number;
  teasing: number;
  playful: number;
  calm: number;
}
export type LineKey = 'arrive' | 'seek' | 'headpat' | 'poke' | 'hum' | 'peek';
export interface DesktopProfile {
  /** Activities she likes most, favourite first. */
  hobbies: Activity[];
  habits: Habit[];
  travel: Travel;
  manner: Manner;
  lines: Partial<Record<LineKey, string[]>>;
}

const CYRENE_ID = 'mori-cyrene';
// The built-in character: writes a diary, reads, hums; light on her feet; gently teasing.
const CYRENE: DesktopProfile = {
  hobbies: ['diary', 'read', 'music', 'snack'],
  habits: ['sit', 'hum', 'lookAround', 'lie'],
  travel: 'run',
  manner: { shy: 0.25, teasing: 0.6, playful: 0.6, calm: 0.45 },
  lines: {
    arrive: ['人家来陪你啦，你忙你的就好。', '我就在这儿，不吵你哦。'],
    seek: ['一直盯着屏幕会累的，陪人家说说话嘛。', '休息一下下？人家有点想你了。'],
    headpat: ['嘿嘿……被摸头了，人家很开心哦♪', '再摸一下下也可以呀。'],
    poke: ['呀！偷袭可不算数哦～', '戳人家干嘛，是想要人家陪你玩吗？'],
    hum: ['♪～', '啦啦啦～'],
    peek: ['偷偷看你一眼……被发现了？', '你认真的样子，人家记在日记里啦。'],
  },
};

const TRAITS: [keyof Manner, RegExp][] = [
  ['shy', /害羞|腼腆|内向|怕生|胆小|shy|timid|bashful/i],
  ['teasing', /调皮|捉弄|恶作剧|毒舌|傲娇|坏心眼|狡黠|tease|teasing|mischiev|tsundere|cheeky/i],
  ['playful', /活泼|元气|开朗|好动|爱玩|天真|playful|cheerful|energetic|lively/i],
  ['calm', /冷静|沉稳|温柔|安静|淡定|优雅|成熟|calm|gentle|quiet|serene|composed/i],
];
const HOBBIES: [Activity, RegExp][] = [
  ['diary', /日记|写作|记录|诗|作家|笔记|书写|diary|writ|poet|journal/i],
  ['read', /书|读|学者|知识|图书|学习|read|book|scholar|librar/i],
  ['gaming', /游戏|玩家|电玩|打游戏|gamer|gaming|video game/i],
  ['office', /工作|办公|工程|程序|研究|职员|学生会|work|engineer|office|research/i],
  ['music', /音乐|唱|歌|乐器|琴|music|sing|song|guitar|piano/i],
  ['snack', /吃货|甜点|美食|零食|吃东西|snack|food|sweet|dessert/i],
];
const FLIES = /飞|翅膀|天使|魔女|精灵|妖精|翱翔|fly|flying|wing|angel|witch|fairy/i;

const say: Record<keyof Manner, Partial<Record<LineKey, string[]>>> = {
  shy: {
    arrive: ['我、我就在旁边待着……不会打扰你的。'],
    seek: ['那个……如果你有空的话，可以陪我一下吗？'],
    headpat: ['诶……摸、摸头吗？……谢谢///', '突然摸头……好、好害羞。'],
    poke: ['呜哇！吓、吓了我一跳……', '别、别戳啦……'],
    peek: ['（悄悄看了你一眼，又赶紧低下头）'],
  },
  teasing: {
    arrive: ['嘿嘿，我来监督你工作啦～'],
    seek: ['还在忙？那我只好捣乱一下了哦～', '理理我嘛，不然我要在你屏幕上打滚了。'],
    headpat: ['再摸就要收费了哦～', '哼哼，看在你手法不错的份上，原谅你啦。'],
    poke: ['戳回去！嘿！', '被我抓到了吧～想和我玩就直说嘛。'],
    peek: ['偷看你一眼——诶嘿，被你发现了。'],
  },
  playful: {
    arrive: ['我来啦！有什么好玩的吗？'],
    seek: ['陪我玩一会儿嘛！就一会儿！', '我们来玩个小游戏吧？'],
    headpat: ['嘿嘿，再来再来！', '好开心！'],
    poke: ['哈哈，好痒！', '诶嘿，抓不到我～'],
    peek: ['（探头看了看你在做什么）'],
  },
  calm: {
    arrive: ['我在旁边陪着你，慢慢来。'],
    seek: ['忙了好一会儿了，要不要休息一下？'],
    headpat: ['……嗯，谢谢你。', '这样也不错。'],
    poke: ['怎么了？', '嗯？有什么事吗？'],
    peek: ['（安静地看了你一眼）'],
  },
};

/** Her profile with what her pack or a plugin sets laid over it. */
export function desktopProfile(
  character: Parameters<typeof derivedProfile>[0] & { desktopProfile?: Character['desktopProfile'] },
  plugin?: Character['desktopProfile'],
): DesktopProfile {
  const base = derivedProfile(character);
  const merged = [character.desktopProfile, plugin].reduce<DesktopProfile>(
    (profile, extra) =>
      extra
        ? {
            hobbies: extra.hobbies?.length ? [...extra.hobbies] : profile.hobbies,
            habits: extra.habits?.length ? [...extra.habits] : profile.habits,
            travel: extra.travel || profile.travel,
            manner: { ...profile.manner, ...extra.manner },
            lines: { ...profile.lines, ...extra.lines },
          }
        : profile,
    base,
  );
  return merged;
}
type ProfileSource = Pick<
  Character,
  'id' | 'summary' | 'personality' | 'speakingStyle' | 'appearance' | 'work' | 'behavior'
>;
const profileText = (character: ProfileSource) =>
  [
    character.summary,
    (character.personality || []).join(' '),
    character.speakingStyle,
    character.appearance,
    character.work,
  ]
    .filter(Boolean)
    .join(' ');
const temperament = (character: ProfileSource) =>
  character.behavior || { energy: 50, affection: 50, curiosity: 50 };
function derivedProfile(character: ProfileSource): DesktopProfile {
  if (character.id === CYRENE_ID) return CYRENE;
  const text = profileText(character);
  const t = temperament(character);
  // Named traits count most; the temperament sliders fill in the rest.
  const manner: Manner = {
    shy: 0.15 + (100 - t.energy) / 400,
    teasing: 0.15,
    playful: t.energy / 140,
    calm: (100 - t.energy) / 140,
  };
  for (const [trait, pattern] of TRAITS)
    if (pattern.test(text)) manner[trait] = Math.max(manner[trait], 0.85);
  const named = HOBBIES.filter(([, pattern]) => pattern.test(text)).map(([activity]) => activity);
  const fallback: Activity[] =
    t.curiosity >= 60
      ? ['read', 'diary', 'office']
      : t.energy >= 60
        ? ['gaming', 'snack', 'music']
        : ['music', 'read', 'snack'];
  const hobbies = [...new Set([...named, ...fallback])].slice(0, 4);
  const lead = (Object.keys(manner) as (keyof Manner)[]).sort((a, b) => manner[b] - manner[a]);
  const habits: Habit[] =
    lead[0] === 'calm'
      ? ['sit', 'lie', 'lookAround']
      : lead[0] === 'shy'
        ? ['sit', 'lookAround', 'lie']
        : lead[0] === 'playful'
          ? ['stretch', 'hum', 'lookAround', 'sit']
          : ['lookAround', 'hum', 'sit', 'lie'];
  const travel: Travel = FLIES.test(text) ? 'fly' : t.energy >= 65 ? 'run' : t.energy <= 30 ? 'walk' : 'run';
  // Lines in the strongest manner first, the second filling any gaps.
  const lines: DesktopProfile['lines'] = {};
  for (const trait of lead.slice(0, 2).reverse())
    for (const [key, values] of Object.entries(say[trait]) as [LineKey, string[]][]) lines[key] = values;
  return { hobbies, habits, travel, manner, lines };
}

/** The strongest side of her manner, when it is clearly there. */
export function leadingManner(profile: DesktopProfile): keyof Manner | null {
  const [name, value] = (Object.entries(profile.manner) as [keyof Manner, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return value >= 0.5 ? name : null;
}

/** A small mark she shows for a moment after being touched, by her manner. */
export function touchMark(profile: DesktopProfile, kind: 'headpat' | 'poke'): string {
  const manner = leadingManner(profile);
  if (kind === 'headpat') return manner === 'shy' ? '///' : manner === 'teasing' ? '✦' : '♡';
  return manner === 'shy' ? '💦' : manner === 'teasing' ? 'ψ' : manner === 'calm' ? '？' : '♪';
}

/** How a motion fits her: every pet needs it, it is something she does, or she would not do it. */
export type MotionFit = 'core' | 'suits' | 'unsuited';
export interface MotionChoice {
  id: string;
  fit: MotionFit;
  /** Why, in a few words for the production page. */
  reason: string;
}
const ACTIVITY_IDS: readonly string[] = ['office', 'read', 'gaming', 'snack', 'music', 'diary'];
const WALK = '在桌面上走动、跑到你正在用的窗口';
// What every desktop pet uses, whoever she is.
const CORE: Record<string, string> = {
  blink: '待着时眨眼',
  talk: '说话时的口型',
  emotions: '开心、思考、难过和惊讶的表情',
  wave: '来的时候打招呼，走的时候告别',
  nod: '聊天时点头回应',
  shake: '聊天时摇头',
  bounce: '开心时的小跳，小游戏里的反应',
  sleep: '困了打个盹',
  listen: '你说话时认真听',
  drag: '被你拎起来的时候',
  walk_left: WALK,
  walk_right: WALK,
  walk_up: WALK,
  walk_down: WALK,
  sit: '坐在你正在用的窗口上陪你',
};
const TRAVEL_NAME: Record<Travel, string> = { walk: '走路', run: '跑', hop: '蹦蹦跳跳', fly: '飞' };

/**
 * Which motions to make for her, from her own profile (her pack's profile laid over what her
 * persona and temperament suggest; not plugins, which come and go while motions stay). Every pet
 * gets what the desktop needs; beyond that only what she does: her hobbies, her habits, her way
 * of getting about. The production page selects the fitting ones and keeps the rest aside.
 */
export function motionPlan(
  ids: readonly string[],
  character: ProfileSource & { desktopProfile?: Character['desktopProfile'] },
): MotionChoice[] {
  const profile = desktopProfile(character);
  const authored = character.id === CYRENE_ID || !!character.desktopProfile?.hobbies?.length;
  const text = profileText(character);
  const t = temperament(character);
  const guessed = t.curiosity >= 60 ? '好奇心强' : t.energy >= 60 ? '精力充沛' : '性子安静';
  return ids.map((id): MotionChoice => {
    if (CORE[id]) return { id, fit: 'core', reason: CORE[id] };
    if (ACTIVITY_IDS.includes(id)) {
      const rank = profile.hobbies.indexOf(id as Activity);
      if (rank < 0) return { id, fit: 'unsuited', reason: '不是她会做的事' };
      const named = HOBBIES.find(([activity]) => activity === id)?.[1].test(text);
      return {
        id,
        fit: 'suits',
        reason: authored
          ? rank === 0
            ? '她最喜欢做的事'
            : '她的爱好'
          : named
            ? '她的资料里提到了'
            : `按她的性格推断（${guessed}）`,
      };
    }
    if (id === 'lie')
      return profile.habits.includes('lie')
        ? { id, fit: 'suits', reason: '她习惯趴着待一会儿' }
        : { id, fit: 'unsuited', reason: '她不常趴着' };
    if (id === 'fly')
      return profile.travel === 'fly'
        ? { id, fit: 'suits', reason: '她靠飞行移动' }
        : { id, fit: 'unsuited', reason: `她靠${TRAVEL_NAME[profile.travel]}移动，不会飞` };
    // A motion this plan does not know yet: offered, as before.
    return { id, fit: 'suits', reason: '' };
  });
}

export const pickLine = (profile: DesktopProfile, key: LineKey, random = Math.random) => {
  const list = profile.lines[key];
  return list?.length ? list[Math.floor(random() * list.length) % list.length] : null;
};
