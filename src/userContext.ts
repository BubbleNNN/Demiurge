// What the user is doing, from what the desktop helper reports (front app, its window, seconds
// since the last key press and pointer movement), and what that means for the desktop character:
// whether to keep the user company beside their window, what to do there, and when to stay quiet.
// Pure functions; no window titles or contents are ever involved.
import type { Activity, DesktopRect, UserActivity } from './types';
export type { UserActivity };

export type AppKind =
  | 'code'
  | 'write'
  | 'design'
  | 'read'
  | 'chat'
  | 'video'
  | 'music'
  | 'meeting'
  | 'game'
  | 'other';

/** typing: keys within seconds; active: input within a minute; idle: up to five; away beyond. */
export type UserMode = 'typing' | 'active' | 'idle' | 'away';

export interface UserContext {
  mode: UserMode;
  kind: AppKind;
  /** The front app's bundle identifier or name, to notice a switch. */
  app: string;
  focus?: DesktopRect & { id: string };
  /** What she does beside the user's window, when her pack has it. */
  companion: Activity | null;
  /** She keeps company beside the user's window. */
  company: boolean;
  /** No remarks or invitations: the user is typing or in a meeting. */
  quiet: boolean;
  /** Minutes without any input. */
  idleMinutes: number;
}

// Checked in order: the first match wins. Bundle identifiers first, app names as a fallback.
const KINDS: [AppKind, RegExp][] = [
  ['meeting', /zoom\.us|us\.zoom|tencent\.meeting|wemeet|teams|webex|facetime|skype|voov/i],
  [
    'code',
    /vscode|vscodium|cursor|todesktop|xcode|jetbrains|intellij|pycharm|webstorm|goland|clion|rider|android\.?studio|sublimetext|terminal|iterm|warp|alacritty|kitty|wezterm|ghostty|zed|panic\.nova|bbedit|neovim|vim|emacs|openai\.codex|github|tower|fork|sourcetree|postman|docker|tableplus|dbeaver|sequel|insomnia|hyper/i,
  ],
  ['design', /figma|sketch|adobe|photoshop|illustrator|affinity|procreate|pixelmator|blender|canva|krita/i],
  [
    'write',
    /iwork\.pages|microsoft\.word|textedit|notion|obsidian|bear|ulysses|typora|scrivener|craft|logseq|evernote|onenote|wps|apple\.notes|ia\.writer|marktext|drafts|yuque|mubu|keynote|powerpoint|excel|numbers/i,
  ],
  ['music', /music|spotify|163music|qqmusic|kugou|kuwo|tidal|deezer|podcasts/i],
  [
    'video',
    /bilibili|iqiyi|youku|tenvideo|qqlive|netflix|youtube|vlc|iina|quicktime|infuse|movist|potplayer|douyin|tiktok|mpv|apple\.tv/i,
  ],
  ['game', /steam|epicgames|battle\.net|minecraft|mihoyo|hoyoverse|genshin|riot|blizzard|openemu|games?\b/i],
  [
    'chat',
    /wechat|xinwechat|tencent\.qq|\bqq\b|slack|discord|telegram|whatsapp|line|messages|dingtalk|feishu|lark|signal|mail|outlook|spark|airmail|claude|openai\.chat|chatgpt/i,
  ],
  [
    'read',
    /safari|chrome|firefox|edge|thebrowser|arc|brave|opera|vivaldi|orion|preview|pdf|books|kindle|reader|zotero|readwise|bitbrowser|news/i,
  ],
];

export function appKind(app: UserActivity['app']): AppKind {
  if (!app) return 'other';
  const text = `${app.bundle} ${app.name}`;
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] || 'other';
}

// What she does beside the user, to go with what they are doing.
const COMPANIONS: Partial<Record<AppKind, Activity>> = {
  code: 'office',
  write: 'diary',
  design: 'diary',
  read: 'read',
  music: 'music',
  game: 'gaming',
};

export function userContext(activity: UserActivity | undefined | null): UserContext | null {
  if (!activity) return null;
  const kind = appKind(activity.app);
  const idle = Math.min(activity.keyIdle, activity.pointerIdle);
  // Watching a video or sitting in a meeting needs no input: the user is still there.
  const present = kind === 'video' || kind === 'meeting' ? idle < 1800 : false;
  const mode: UserMode =
    activity.keyIdle < 6 && !activity.self
      ? 'typing'
      : idle < 60 || present
        ? 'active'
        : idle < 300
          ? 'idle'
          : 'away';
  const working = mode === 'typing' || mode === 'active';
  return {
    mode,
    kind,
    app: activity.app?.bundle || activity.app?.name || '',
    ...(activity.focus ? { focus: activity.focus } : {}),
    companion: working ? COMPANIONS[kind] || null : null,
    // Keep the user company beside the window they are working in, but not in a meeting (she
    // only steps out of the way there) or while they are with Mori itself.
    company: Boolean(activity.focus) && !activity.self && working && kind !== 'game',
    quiet: mode === 'typing' || kind === 'meeting',
    idleMinutes: idle / 60,
  };
}

export interface Spot {
  /** Where her feet go. */
  to: { x: number; y: number };
  /** On the window's top edge (sitting or lying there), rather than beside it. */
  perch?: boolean;
  /** The side of the user's window she stands on; she looks the other way, toward it. */
  side: 'left' | 'right';
  /** No room beside the window: she stands at its lower corner, over its edge. */
  over: boolean;
}

/**
 * Where to keep the user company: just beside their window, her side touching its edge, feet
 * level with its bottom (or on the floor when it reaches down there). The side nearer to her
 * wins. With no room on either side (a maximized window) she takes its lower corner.
 */
export function companySpot(
  area: DesktopRect,
  body: { width: number; height: number },
  focus: DesktopRect,
  feet: { x: number; y: number },
): Spot {
  const half = body.width / 2;
  const ground = Math.round(
    Math.min(area.y + area.height - 2, Math.max(area.y + body.height + 4, focus.y + focus.height)),
  );
  const sides = (
    [
      ['left', Math.round(focus.x - half * 0.85)],
      ['right', Math.round(focus.x + focus.width + half * 0.85)],
    ] as const
  ).filter(([, x]) => x - half >= area.x && x + half <= area.x + area.width);
  if (sides.length) {
    const [side, x] = [...sides].sort((a, b) => Math.abs(a[1] - feet.x) - Math.abs(b[1] - feet.x))[0];
    return { to: { x, y: ground }, side, over: false };
  }
  const right = feet.x >= focus.x + focus.width / 2;
  const x = right
    ? Math.min(area.x + area.width, focus.x + focus.width) - half - 6
    : Math.max(area.x, focus.x) + half + 6;
  return { to: { x: Math.round(x), y: ground }, side: right ? 'right' : 'left', over: true };
}

/**
 * A place on the top edge of the user's window to sit or lie on and watch them: near the end of
 * the edge closer to her, her whole body on the edge. None when the window reaches so high that
 * her head would leave the screen (a maximized window), or the edge is too short for her.
 */
export function perchSpot(
  area: DesktopRect,
  body: { width: number; height: number },
  focus: DesktopRect,
  feet: { x: number; y: number },
): Spot | null {
  // She lands standing before she sits or lies down: her whole height must fit above the edge.
  if (focus.y - body.height * 1.02 < area.y || focus.y > area.y + area.height - 60) return null;
  const left = Math.max(area.x, focus.x),
    right = Math.min(area.x + area.width, focus.x + focus.width);
  if (right - left < body.width * 1.2) return null;
  const inset = Math.min((right - left) / 2, body.width * 0.8);
  const ends = [
    ['left', Math.round(left + inset)],
    ['right', Math.round(right - inset)],
  ] as const;
  const [side, x] = [...ends].sort((a, b) => Math.abs(a[1] - feet.x) - Math.abs(b[1] - feet.x))[0];
  return { to: { x, y: Math.round(focus.y) }, side, over: false, perch: true };
}

/** Share of her body (feet to head, her width) that covers the user's window. */
export function coverage(
  feet: { x: number; y: number },
  body: { width: number; height: number },
  focus: DesktopRect,
) {
  const left = Math.max(feet.x - body.width / 2, focus.x),
    right = Math.min(feet.x + body.width / 2, focus.x + focus.width),
    top = Math.max(feet.y - body.height, focus.y),
    bottom = Math.min(feet.y, focus.y + focus.height);
  if (right <= left || bottom <= top) return 0;
  return ((right - left) * (bottom - top)) / Math.max(1, body.width * body.height);
}
