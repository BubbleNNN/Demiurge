// Daily life: a small clock of needs decides what the character does on her own, why, and when she
// would like company. Adapted from Anime Codex's routine (MIT). Pure logic; the app supplies time.
import type { Activity } from './types';
import type { Mood } from './mood';

export type MomentId = 'snack' | 'guess' | 'stars' | 'read';
/** What she can ask the user for: a game or moment together, a chat, or a pat on the head. */
export type Offer = MomentId | 'chat' | 'pat';
export type LifeActivity = Activity | 'idle' | 'sleep';
export interface Moment {
  id: MomentId;
  outcome: string;
  at: number;
}
export interface LifeState {
  version: 1;
  updatedAt: number;
  activity: LifeActivity;
  until: number;
  reason: string;
  energy: number;
  hunger: number;
  social: number;
  focus: number;
  chapter: number;
  resume: Activity | null;
  nextSpeech: number;
  nextInvite: number;
  missed: number;
  pending: { offer: Offer; expires: number } | null;
  lastOffer?: Offer;
  moments: Moment[];
  desktopEvents?: { at: number; text: string }[];
  /** The app the user was working in when she last chose something to do alongside them. */
  contextKey?: string;
  /** A chosen task survives its short breaks; a segment is not a new random task. */
  task?: { activity: Activity; remaining: number };
  /** How she feels (mood.ts); restored and checked by the app. */
  mood?: Mood;
}
/** What the user is doing (see userContext.ts), as far as her routine needs to know. */
export interface LifeContext {
  mode: 'typing' | 'active' | 'idle' | 'away';
  /** The front app, to notice when the user turns to something else. */
  key: string;
  /** What she can do beside the user to go with their work (her pack has it), if anything. */
  companion: Activity | null;
  /** Minutes without any input. */
  idleMinutes: number;
}
export interface Temperament {
  energy: number;
  affection: number;
  curiosity: number;
}
export interface LifeStep {
  activity: LifeActivity;
  changed: boolean;
  speech: string | null;
  invite: Offer | null;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const pick = <T>(items: T[], random: () => number) =>
  items[Math.floor(random() * items.length) % items.length];
const quiet = (hour: number) => hour >= 23 || hour < 7;

export function createLife(now = Date.now()): LifeState {
  return {
    version: 1,
    updatedAt: now,
    activity: 'idle',
    until: now + 20000,
    reason: '',
    energy: 80,
    hunger: 25,
    social: 40,
    focus: 0,
    chapter: 0,
    resume: null,
    nextSpeech: now + 45000,
    nextInvite: now + 8 * 60000,
    missed: 0,
    pending: null,
    moments: [],
  };
}

export function restoreLife(value: unknown, now = Date.now()): LifeState {
  const fresh = createLife(now);
  if (!value || typeof value !== 'object' || (value as LifeState).version !== 1) return fresh;
  const saved = value as LifeState;
  const number = (v: unknown, fallback: number) => (Number.isFinite(v) ? Number(v) : fallback);
  const needs = {
    energy: clamp(number(saved.energy, fresh.energy)),
    hunger: clamp(number(saved.hunger, fresh.hunger)),
    social: clamp(number(saved.social, fresh.social)),
    focus: clamp(number(saved.focus, 0)),
    missed: Math.min(4, Math.max(0, number(saved.missed, 0))),
    moments: Array.isArray(saved.moments) ? saved.moments.slice(-12) : [],
    lastOffer: saved.lastOffer,
    desktopEvents: Array.isArray(saved.desktopEvents) ? saved.desktopEvents.slice(-12) : [],
    // Feelings outlast the half-hour cut below: she is still lonely after a long absence.
    ...(saved.mood && typeof saved.mood === 'object' ? { mood: saved.mood } : {}),
  };
  // Within half an hour she simply continues what she was doing; after that she starts fresh.
  if (now - number(saved.updatedAt, 0) < 30 * 60000)
    return {
      ...fresh,
      ...needs,
      activity: saved.activity || 'idle',
      ...(saved.task &&
      ['office', 'read', 'gaming', 'snack', 'music', 'diary'].includes(saved.task.activity) &&
      Number.isFinite(saved.task.remaining)
        ? {
            task: {
              activity: saved.task.activity,
              remaining: Math.max(0, Math.min(1200000, saved.task.remaining)),
            },
          }
        : {}),
      until: number(saved.until, fresh.until),
      reason: typeof saved.reason === 'string' ? saved.reason : '',
      chapter: number(saved.chapter, 0),
      resume: saved.resume || null,
      nextSpeech: number(saved.nextSpeech, fresh.nextSpeech),
      nextInvite: number(saved.nextInvite, fresh.nextInvite),
      pending: saved.pending && number(saved.pending.expires, 0) > now ? saved.pending : null,
      updatedAt: number(saved.updatedAt, now),
    };
  return { ...fresh, ...needs };
}

// Weighted by personality and the hour: energetic characters play more, curious ones read and write.
function chooseActivity(
  previous: LifeActivity,
  available: Activity[],
  temperament: Temperament,
  hour: number,
  random: () => number,
  // With the user away she plays more; quiet work is for keeping them company.
  away = false,
  // Her favourite things (characterBehavior.ts), favourite first.
  hobbies: Activity[] = [],
  // How her mood leans her (mood.ts moodConduct): cross, she writes in her diary rather than play.
  leanings: Partial<Record<Activity, number>> = {},
): Activity {
  const fun = away ? 2 : 1;
  const weights: Record<Activity, number> = {
    office: (1 + temperament.curiosity / 70) / fun,
    read: 2 + temperament.curiosity / 40 + (hour >= 20 ? 1 : 0),
    gaming: (1 + temperament.energy / 35) * fun,
    snack: ([10, 15, 16, 21].includes(hour) ? 2 : 0.6) * (away ? 1.5 : 1),
    music: (1.2 + temperament.affection / 80) * (away ? 1.5 : 1),
    diary: 1 + temperament.curiosity / 60 + (hour >= 21 ? 1.5 : 0),
  };
  // Her favourites lead whatever the hour and her temperament would otherwise suggest.
  const strongest = Math.max(...Object.values(weights));
  hobbies.forEach(
    (activity, rank) =>
      (weights[activity] = Math.max(weights[activity], strongest) * ([2, 1.4, 1.1][rank] || 1)),
  );
  for (const [activity, factor] of Object.entries(leanings) as [Activity, number][])
    weights[activity] *= factor;
  const pool = available.filter((activity) => activity !== previous);
  const choices = pool.length ? pool : available;
  if (!choices.length) return 'read';
  const total = choices.reduce((sum, activity) => sum + weights[activity], 0);
  let roll = random() * total;
  for (const activity of choices) {
    roll -= weights[activity];
    if (roll <= 0) return activity;
  }
  return choices[choices.length - 1];
}

const REASONS: Record<string, string[]> = {
  sleep: ['夜深了，我先眯一会儿……有事叫我就好。', '有点困了，先休息一下下。'],
  hungry: ['肚子有点饿了，先吃点东西，待会儿接着做。', '嘴有点馋了，吃块点心再继续。'],
  resume: ['休息好了，接着刚才那一段。', '回来啦，继续刚刚没做完的事。'],
  continue_read: ['接着看这一章，读完再休息。'],
  continue_diary: ['刚才的事还没记完，再写几行。'],
  continue_office: ['手头还有一点，做完这一段再休息。'],
  continue_gaming: ['这一局还没结束，接着玩完。'],
  continue_music: ['这首还没听完，继续安静听一会儿。'],
  stretch: ['专心太久啦，起来活动一下。', '眼睛有点累了，先放松一会儿。'],
  company: ['你在忙，我就在旁边陪你一起做点事。', '我也找点事情做，陪着你。'],
  alone: ['你不在，我先自己玩一会儿。', '等你回来之前，做点自己喜欢的事。'],
  read: ['接着看下一段。', '这本书正看到有意思的地方。', '找到一本想读的书，读一会儿。'],
  gaming: ['玩一小局放松一下。', '这一关我一定能过！'],
  snack: ['来块小点心，心情会变好。', '甜甜的东西最适合现在了。'],
  music: ['听首喜欢的歌，安静一会儿。', '这首歌的旋律好温柔。'],
  office: ['先把手头这点事情做完。', '还有一点没做完，再专心一会儿。'],
  diary: ['把今天的小事记下来吧。', '写几行日记，留住这一刻。'],
  idle: ['就这样待一会儿也很好。', '发一小会儿呆。'],
};
const reasonFor = (key: string, random: () => number) => pick(REASONS[key] || REASONS.idle, random);

export const momentOffers: Record<MomentId, { title: string; invite: string }> = {
  snack: { title: '一起吃点心', invite: '我有点饿了……要不要一起吃点心？' },
  guess: { title: '猜猜藏哪只手', invite: '我把一颗星星藏起来了，来猜猜在哪只手里？' },
  stars: { title: '接星星', invite: '天上在掉星星哦，要不要一起接？' },
  read: { title: '一起读一段', invite: '我找到一段很好的文字，想念给你听，好吗？' },
};

/** Asking for a chat or a pat rather than a game. */
export const requestOffers: Record<'chat' | 'pat', { title: string; invite: string }> = {
  chat: { title: '陪我聊聊', invite: '我有点想和你说说话……现在有空吗？' },
  pat: { title: '摸摸头', invite: '可以摸摸我的头吗？就一下下。' },
};
export const offerText = (offer: Offer) =>
  offer === 'chat' || offer === 'pat' ? requestOffers[offer] : momentOffers[offer];
export const isMoment = (offer: Offer): offer is MomentId => offer !== 'chat' && offer !== 'pat';
/** How she feels, as far as her routine needs to know (see mood.ts). */
export interface Feelings {
  lonely: boolean;
  angry: boolean;
}

function offerFor(s: LifeState, random: () => number, feelings?: Feelings): Offer {
  // Cross with the user: she only wants to be comforted. Lonely: she asks for company first.
  if (feelings?.angry) return 'pat';
  if (feelings?.lonely && random() < 0.6) return random() < 0.55 ? 'chat' : 'pat';
  if (s.hunger > 55) return 'snack';
  const choices = (Object.keys(momentOffers) as MomentId[]).filter((id) => id !== s.lastOffer);
  return pick(choices, random);
}

export function settleInvite(s: LifeState, decision: 'accept' | 'decline' | 'ignored', now = Date.now()) {
  s.pending = null;
  if (decision === 'accept') {
    s.missed = 0;
    s.nextInvite = now + 10 * 60000;
  } else {
    // Back off further each time the user is busy; never nag.
    s.missed = Math.min(4, s.missed + 1);
    s.nextInvite = now + Math.min(40, 5 * 2 ** s.missed) * 60000;
    s.reason = decision === 'decline' ? '你在忙，我先自己找点事做。' : '';
  }
  s.nextSpeech = now + 120000;
  return s;
}

export function recordMoment(s: LifeState, id: MomentId, outcome: string, now = Date.now()) {
  s.moments = [...s.moments, { id, outcome: outcome.slice(0, 120), at: now }].slice(-12);
  s.social = Math.max(0, s.social - 40);
  if (id === 'snack') s.hunger = Math.max(0, s.hunger - 40);
  s.lastOffer = id;
  s.nextInvite = Math.max(s.nextInvite, now + 10 * 60000);
  s.nextSpeech = now + 150000;
  return s;
}

export function advanceLife(
  s: LifeState,
  {
    now = Date.now(),
    hour = new Date(now).getHours(),
    available = [] as Activity[],
    temperament = { energy: 50, affection: 50, curiosity: 50 } as Temperament,
    proactive = true,
    blocked = false,
    random = Math.random,
    // The attention budget (see attention.ts): whether she may invite or remark right now.
    canInvite = true,
    canRemark = true,
    // What the user is doing, when the desktop pet can see it (macOS).
    context = undefined as LifeContext | undefined,
    // How she feels: lonely, she asks for company sooner; cross, only to be comforted.
    feelings = undefined as Feelings | undefined,
    // What she likes doing most (characterBehavior.ts).
    hobbies = [] as Activity[],
    // What her mood makes her more or less inclined to (mood.ts moodConduct).
    leanings = {} as Partial<Record<Activity, number>>,
  } = {},
): LifeStep | null {
  const elapsed = Math.max(0, now - s.updatedAt);
  s.updatedAt = now;
  if (s.pending && blocked) s.pending.expires += elapsed;
  if (s.pending && now >= s.pending.expires) settleInvite(s, 'ignored', now);
  // While the user is talking or touching her, the fictional clock pauses; no catch-up bursts.
  if (blocked) {
    s.until += elapsed;
    return null;
  }
  const minutes = Math.min(60, elapsed / 1000) / 60;
  if (s.task && s.activity === s.task.activity)
    s.task.remaining = Math.max(0, s.task.remaining - minutes * 60000);
  s.hunger = clamp(s.hunger + (s.activity === 'snack' ? -25 : 2.2) * minutes);
  s.energy = clamp(
    s.energy + (s.activity === 'sleep' ? 14 : s.activity === 'gaming' ? -1.6 : -0.8) * minutes,
  );
  // Affectionate characters want company sooner.
  s.social = clamp(s.social + (1.5 + temperament.affection / 40) * minutes);
  s.focus = clamp(s.focus + (['read', 'diary', 'office', 'gaming'].includes(s.activity) ? 4 : -15) * minutes);

  // A new foreground app can guide the next task, after the current project or break ends.
  const working = context && (context.mode === 'typing' || context.mode === 'active');
  const away = context?.mode === 'away';
  if (working && context.companion && context.key !== s.contextKey) {
    s.contextKey = context.key;
    // A changed foreground app is a suggestion for the next task, not an interruption.
    if (s.activity === 'idle' && !s.resume) s.until = Math.min(s.until, now);
  }
  let changed = false;
  let announce = false;
  if (now >= s.until) {
    const previous = s.activity;
    const resumable = (a: LifeActivity) =>
      ['read', 'diary', 'office', 'gaming'].includes(a) ? (a as Activity) : null;
    let key: string;
    if (s.energy < 25 && quiet(hour)) {
      s.activity = 'sleep';
      key = 'sleep';
    } else if (s.hunger > 62 && available.includes('snack')) {
      s.resume = resumable(previous) || s.resume;
      s.activity = 'snack';
      key = 'hungry';
    } else if (s.resume && available.includes(s.resume) && (s.activity !== 'idle' || s.focus < 18)) {
      s.activity = s.resume;
      s.resume = null;
      key = 'resume';
    } else if (s.focus >= 40 || (s.activity === 'idle' && s.resume && s.focus >= 18)) {
      s.resume = resumable(previous) || s.resume;
      s.activity = 'idle';
      key = 'stretch';
    } else if (
      (!s.task || s.task.remaining <= 0 || !available.includes(s.task.activity)) &&
      working &&
      context.companion &&
      available.includes(context.companion) &&
      random() < 0.8
    ) {
      s.activity = context.companion;
      key = 'company';
    } else if (away && context.idleMinutes >= 20 && (s.energy < 70 || quiet(hour))) {
      // A long while alone: she naps until the user comes back.
      s.activity = 'sleep';
      key = 'sleep';
    } else if (s.task && s.task.remaining > 0 && available.includes(s.task.activity)) {
      s.activity = s.task.activity;
      key = previous === s.activity ? `continue_${s.activity}` : 'resume';
    } else {
      s.activity = available.length
        ? chooseActivity(previous, available, temperament, hour, random, away, hobbies, leanings)
        : 'idle';
      key = away && random() < 0.5 ? 'alone' : s.activity;
    }
    if (
      available.includes(s.activity as Activity) &&
      s.activity !== 'snack' &&
      (!s.task ||
        s.task.remaining <= 0 ||
        !available.includes(s.task.activity) ||
        (key === 'company' && s.task.activity !== s.activity))
    ) {
      s.task = {
        activity: s.activity as Activity,
        remaining: (8 + (100 - temperament.energy) / 20 + random() * 4) * 60000,
      };
    }
    s.reason = reasonFor(key, random);
    s.chapter++;
    // Calmer characters linger longer on each thing.
    const pace = 1.4 - temperament.energy / 200;
    const ranges: Record<LifeActivity, [number, number]> = {
      read: [300000, 480000],
      office: [300000, 480000],
      diary: [240000, 360000],
      gaming: [240000, 360000],
      music: [180000, 300000],
      snack: [100000, 150000],
      idle: [45000, 75000],
      sleep: [480000, 720000],
    };
    const [minimum, maximum] = ranges[s.activity];
    const duration = (minimum + random() * (maximum - minimum)) * pace;
    s.until = now + duration;
    changed = previous !== s.activity;
    announce = changed && proactive && s.activity !== 'sleep' ? random() < 0.4 : false;
  }

  let speech: string | null = null;
  let invite: Offer | null = null;
  if (proactive && !s.pending && s.activity !== 'sleep' && !quiet(hour)) {
    if (now >= s.nextInvite && (s.social >= 50 || feelings?.lonely || feelings?.angry) && canInvite) {
      invite = offerFor(s, random, feelings);
      s.pending = { offer: invite, expires: now + 60000 };
      s.lastOffer = invite;
      s.nextSpeech = now + 180000;
    } else if ((announce || now >= s.nextSpeech) && canRemark && !feelings?.angry) {
      speech = s.reason || null;
      s.nextSpeech = now + 360000 + random() * 360000;
    }
  }
  return { activity: s.activity, changed, speech, invite };
}

const timeOfDay = (hour: number) =>
  hour < 5
    ? '深夜'
    : hour < 9
      ? '早上'
      : hour < 12
        ? '上午'
        : hour < 14
          ? '中午'
          : hour < 18
            ? '下午'
            : hour < 23
              ? '晚上'
              : '深夜';

const momentWords: Record<MomentId, string> = {
  snack: '一起吃了点心',
  guess: '玩了猜手游戏',
  stars: '一起接了星星',
  read: '一起读了一段文字',
};

// A short, factual description of the moment for the chat model; never presented as canon.
export function lifeSituation(
  s: LifeState,
  doing: Record<string, string>,
  now = Date.now(),
  // How she feels, in words (mood.ts), for the chat model.
  mood = '',
) {
  const hour = new Date(now).getHours();
  const needs = [
    s.energy < 30 ? '有点困' : '',
    s.hunger > 60 ? '有点饿' : '',
    s.social > 70 ? '想有人陪' : '',
    mood,
  ].filter(Boolean);
  return {
    timeOfDay: timeOfDay(hour),
    doing: s.activity === 'sleep' ? '在休息' : doing[s.activity] || '',
    reason: s.reason,
    feeling: needs,
    desktopMoments: (s.desktopEvents || [])
      .filter((e) => now - e.at < 6 * 3600000)
      .slice(-3)
      .map((e) => e.text),
    recentMoments: s.moments
      .filter((moment) => now - moment.at < 6 * 3600000)
      .slice(-3)
      .map(
        (moment) =>
          `${Math.max(1, Math.round((now - moment.at) / 60000))} 分钟前${momentWords[moment.id]}：${moment.outcome}`,
      ),
  };
}
