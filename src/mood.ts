// How she feels. Three feelings, 0 to 100: joy, loneliness and anger. Time moves them (she grows
// lonely when nobody has come to her for a while, anger cools down, joy settles back), and so does
// what happens between her and the user: being played with makes her happy, being woken up or
// flung off a window makes her cross until someone comforts her. Pure functions; the state is
// saved with her daily life (life.ts).
import type { Emotion } from './types';

export interface Mood {
  joy: number;
  lonely: number;
  anger: number;
  /** Last time the user did something with her (touch, chat, a game). */
  lastContact: number;
  updatedAt: number;
  /** What she is cross about, for her lines and the chat model; empty when she is not. */
  grudge: string;
}
export type MoodEvent =
  | 'touch'
  | 'headpat'
  | 'poke'
  | 'chat'
  | 'play'
  | 'greet'
  | 'woken'
  | 'interrupted'
  | 'flung'
  | 'ignored'
  | 'declined';
export type MoodName = 'angry' | 'lonely' | 'happy' | 'calm';

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const MINUTE = 60000;
export const ANGRY = 35;
export const LONELY = 60;
export const HAPPY = 72;

export function createMood(now = Date.now()): Mood {
  return { joy: 55, lonely: 15, anger: 0, lastContact: now, updatedAt: now, grudge: '' };
}
export function restoreMood(value: unknown, now = Date.now()): Mood {
  const fresh = createMood(now);
  if (!value || typeof value !== 'object') return fresh;
  const saved = value as Partial<Mood>;
  const number = (v: unknown, fallback: number) => (Number.isFinite(v) ? Number(v) : fallback);
  return {
    joy: clamp(number(saved.joy, fresh.joy)),
    lonely: clamp(number(saved.lonely, fresh.lonely)),
    anger: clamp(number(saved.anger, 0)),
    lastContact: Math.min(now, number(saved.lastContact, now)),
    updatedAt: Math.min(now, number(saved.updatedAt, now)),
    grudge: typeof saved.grudge === 'string' ? saved.grudge.slice(0, 40) : '',
  };
}

const GRUDGES: Partial<Record<MoodEvent, string>> = {
  woken: '睡得正香被吵醒',
  interrupted: '正在做的事被打断',
  flung: '被从窗口上甩了下来',
};

/** Something happened between her and the user. Changes and returns the mood. */
export function feel(m: Mood, event: MoodEvent, now = Date.now()): Mood {
  settle(m, now);
  const contact = (joy: number, lonely: number, anger: number) => {
    m.joy = clamp(m.joy + joy);
    m.lonely = clamp(m.lonely - lonely);
    m.anger = clamp(m.anger - anger);
    m.lastContact = now;
  };
  switch (event) {
    case 'touch':
      contact(6, 20, 4);
      break;
    case 'headpat':
      // A pat on the head is what comforts her most.
      contact(10, 25, 30);
      break;
    case 'poke':
      if (m.anger >= ANGRY) {
        m.anger = clamp(m.anger + 6);
        m.lonely = clamp(m.lonely - 10);
        m.lastContact = now;
      } else contact(2, 15, 0);
      break;
    case 'chat':
      contact(6, 35, 10);
      break;
    case 'play':
      contact(18, 45, 20);
      break;
    case 'greet':
      m.lonely = clamp(m.lonely - 5);
      break;
    case 'woken':
      m.anger = clamp(m.anger + 35);
      m.joy = clamp(m.joy - 6);
      break;
    case 'interrupted':
      m.anger = clamp(m.anger + 15);
      break;
    case 'flung':
      m.anger = clamp(m.anger + 40);
      m.joy = clamp(m.joy - 10);
      break;
    case 'ignored':
      m.lonely = clamp(m.lonely + 8);
      m.joy = clamp(m.joy - 4);
      break;
    case 'declined':
      m.lonely = clamp(m.lonely + 3);
      m.joy = clamp(m.joy - 3);
      break;
  }
  if (GRUDGES[event]) m.grudge = GRUDGES[event]!;
  if (m.anger < 10) m.grudge = '';
  return m;
}

/** Time passes. `present`: the user is at the computer (not away), so being left alone stings more. */
export function settle(m: Mood, now = Date.now(), present = true): Mood {
  const minutes = Math.min(120, Math.max(0, now - m.updatedAt) / MINUTE);
  m.updatedAt = now;
  if (!minutes) return m;
  const alone = (now - m.lastContact) / MINUTE;
  if (alone > 15) m.lonely = clamp(m.lonely + (present ? 0.9 : 0.5) * minutes);
  m.anger = clamp(m.anger - 1.2 * minutes);
  m.joy = clamp(
    m.joy + (55 - m.joy) * Math.min(1, 0.03 * minutes) - (m.lonely >= LONELY ? 0.3 * minutes : 0),
  );
  if (m.anger < 10) m.grudge = '';
  return m;
}

export function moodName(m: Mood): MoodName {
  if (m.anger >= ANGRY) return 'angry';
  if (m.lonely >= LONELY) return 'lonely';
  if (m.joy >= HAPPY) return 'happy';
  return 'calm';
}

/** Her face when nothing else is showing. Packs have no angry face: a frown with the mark. */
export const moodFace = (name: MoodName): Emotion =>
  name === 'angry' || name === 'lonely' ? 'sad' : name === 'happy' ? 'happy' : 'neutral';

/** The little mark above her head (manga style). */
export const moodMark = (name: MoodName) =>
  name === 'angry' ? '💢' : name === 'lonely' ? '…' : name === 'happy' ? '♪' : '';

/** For the chat model, so her replies match how she feels. */
export function moodWords(m: Mood): string {
  const name = moodName(m);
  if (name === 'angry') return m.grudge ? `有点生气（${m.grudge}），想被哄一哄` : '有点生气，想被哄一哄';
  if (name === 'lonely') return '有点寂寞，很久没人陪了';
  if (name === 'happy') return '心情很好';
  return '';
}

const pick = <T>(items: T[], random: () => number) =>
  items[Math.floor(random() * items.length) % items.length];

/** What she says when something happens, given how she feels now; null for nothing special. */
export function moodLine(
  event: MoodEvent | 'comforted' | 'refuse' | 'sulk',
  m: Mood,
  random = Math.random,
): string | null {
  switch (event) {
    case 'woken':
      return pick(['呜……正睡得香呢，被吵醒了。哼。', '……干嘛啦，人家刚睡着。'], random);
    case 'interrupted':
      return pick(['诶，我还没做完呢……', '正做到一半呢，突然被打断了。'], random);
    case 'flung':
      return pick(['呜哇——！差点摔坏了……', '哇啊！窗口一下子跑掉了！'], random);
    case 'sulk':
      return pick(['哼，刚才好过分。摸摸头我才原谅你。', '……不理你了。除非你哄哄我。'], random);
    case 'comforted':
      return pick(['……好啦好啦，原谅你了。', '哼，这次就算了。下次要轻一点哦。'], random);
    case 'refuse':
      return pick(['哼，现在不想玩。先摸摸头哄哄我嘛。', '我还在生气呢……你先哄哄我。'], random);
    case 'poke':
      return m.anger >= ANGRY ? pick(['别戳我啦，我还在生气。', '再戳就真的不理你了！'], random) : null;
    case 'greet':
      return m.lonely >= LONELY
        ? pick(['你终于来了……我等了好久。', '回来啦……刚才一个人有点寂寞。'], random)
        : null;
    case 'play':
      return m.joy >= HAPPY ? pick(['好开心！下次还要一起玩！', '和你一起玩最开心了♪'], random) : null;
    default:
      return null;
  }
}
