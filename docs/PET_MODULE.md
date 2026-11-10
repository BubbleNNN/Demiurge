# The pet module · 桌宠模块

A Demiurge pet is four pieces that travel together and can be reused on their own: **who she is**
(persona), **what she looks like** (a sprite pack), **how she lives** (a behaviour profile) and
**where she lives** (the desktop-life engine fed by the desktop helper). A character bundle carries
the first three; the engine is the same for every character.

一个桌宠由四部分组成：人设（她是谁）、图集（她的样子）、行为档案（她怎么生活）、桌面生活引擎（她住在哪里）。角色包携带前三者，引擎对所有角色通用。

```
character bundle (.json, version 1)
├── character            persona, lines, temperament, optional desktopProfile
└── skins[]              images per emotion + an optional sprite animation (atlas, clips, review)

desktop life (renderer)  useDesktopLife + life.ts + mood.ts + userContext.ts + characterBehavior.ts
desktop helper (macOS)   electron/native/desktop-bounds  →  electron/desktop-surfaces.cjs
pet window               electron/pet-layout.cjs + shared/pet-window.json
```

## 1. Persona · 人设

`Character` in [`src/types.ts`](../src/types.ts): name, work, summary, personality, speaking style,
roleplay rules, quotes with sources, and `behavior` (energy, affection, curiosity, 0–100).
`companion` holds written lines for chatting without a model
([CHARACTER_PACKS.md](CHARACTER_PACKS.md)). Validation lives in `validateCharacter`
([`electron/store.cjs`](../electron/store.cjs)).

## 2. Sprite pack · 图集

A `Skin` holds one still image per emotion and, for a moving pet, a `SpriteAnimation`:

- `frames`: rectangles in the atlas (or extra `pages`), each with a duration, optional trimmed
  `cell` and `offset`.
- `clips`: named sequences such as `idle`, `walk_left`, `sit`, `lie`, `fly`, `read`, `blink`,
  `talk`, with `enter_*` / `exit_*` transitions. Only `idle` is required; the pet uses what exists.
- `mouthFrames` for lip sync, `pixelated` for pixel art.

Packs are made by the production pipeline ([AUTOMATIC_PET_PRODUCTION.md](AUTOMATIC_PET_PRODUCTION.md)):
motion recipes in [`shared/pet-motions.json`](../shared/pet-motions.json) and
[`shared/pet-motion-stages.json`](../shared/pet-motion-stages.json), sheet checks in
`electron/pet-frames.cjs`, review in `electron/pet-pipeline.cjs`. A finished pack can gain new
motions later (补充新动作) without regenerating the old ones.

**Custom motions** (自定义新动作): the user describes a motion in words and the chat model, shown
her look, writes it as a recipe of the same shape as the built-in ones
(`planCustomMotion` in `electron/services.cjs`, checked by `electron/custom-motion.cjs`): a
`gesture` (4 and 8 poses, played once) or a `pose` (12 stages of entrance, loop and exit, plus 8
poses for older tasks). Her rest poses at the ends are always the built-in wording. The recipe
travels with the task (`customMotions`), so `motionRecipe` draws and packs it like any other
motion; clips are named `custom_<word>` (and `enter_`/`exit_` for a pose), and the finished look
lists them by name (`skin.customMotions`) for the pet toolbar, her idle habits and the chat model,
which may pick them as an action.

**Which motions to make** is decided per character by `motionPlan` in
[`src/characterBehavior.ts`](../src/characterBehavior.ts), from her own behaviour profile (section
3): every pet gets the motions the desktop needs (blink, talk, expressions, wave, nod, shake, a
small jump, sleep, listen, being carried, walking four ways, sitting on a window); beyond that
only her hobbies' activities, lying down if it is one of her habits, and flying if that is how she
gets about. Each motion carries a short reason; the production page selects the fitting ones and
folds the rest away. Plugins do not change the plan, since motions stay after a plugin is removed.

**Approved packs are immutable.** Playback may adjust what it draws (a rest pose swap in
`src/animation/rest.ts`, head-size correction in `src/animation/heads.ts`), but saved clips are
never rewritten on load.

## 3. Behaviour profile · 行为档案

`DesktopProfile` in [`src/characterBehavior.ts`](../src/characterBehavior.ts):

| Field     | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `hobbies` | Up to 6 activities she likes most, favourite first: `office`, `read`, `gaming`, `snack`, `music`, `diary` |
| `habits`  | Small things between activities: `sit`, `lie`, `lookAround`, `stretch`, `hum`                             |
| `travel`  | `walk`, `run`, `hop` or `fly` (flying needs a `fly` clip, else she runs)                                  |
| `manner`  | `shy`, `teasing`, `playful`, `calm`, each 0–1; picks touch marks and default lines                        |
| `lines`   | Up to 8 lines each for `arrive`, `seek`, `headpat`, `poke`, `hum`, `peek`                                 |

The profile is derived from the persona (named traits, hobbies and the temperament sliders), then
the pack's own `character.desktopProfile` is laid over it, then any installed plugin. Every field is
optional in the overrides. Validation: `validateDesktopProfile` in `electron/store.cjs`.

## 4. Desktop life · 桌面生活

- [`src/life.ts`](../src/life.ts): the routine (what she does next, from time of day, hobbies,
  mood and what you are doing) and invitations (chat, pat, games).
- [`src/mood.ts`](../src/mood.ts): joy, loneliness and anger, which rise and settle over time.
  `moodConduct` turns the mood into behaviour that both the routine and the desktop engine read:
  pace, walking instead of running, which habits fill the gaps, how long she stays sitting or lying
  down, whether she busies herself or sits with you, whether she keeps you company at all, and
  which activities she leans towards.
- [`src/userContext.ts`](../src/userContext.ts): what kind of app you are in, and where she can sit
  beside or on top of the window you are using.
- [`src/features/desktop/useDesktopLife.ts`](../src/features/desktop/useDesktopLife.ts): the
  engine: walking, running, hopping and flying; perching on a window and riding it; chasing a slow
  window, falling off a fast one, sulking; entering from the side you swiped to. Movement keeps
  pace with the clip on screen: setting off, she stays put while a pack's turn into the walk
  (`enter_walk_*`), getting up (`exit_*`) or takeoff (`enter_fly`) plays, and only moves once the
  loop shows (`readyToMove` in `src/animation/activities.ts`), then speeds up over a third of a
  second. Out of sight (running in from off screen) she starts already moving, and a jump or fall
  shows at once, cutting short any turn still playing.
- The pet window keeps her feet on screen while her head may pass the top edge
  ([`shared/pet-window.json`](../shared/pet-window.json), `electron/pet-layout.cjs`).

The desktop helper (`electron/native/desktop-bounds.swift`, macOS) streams window rectangles, the
front app, the order of Spaces and seconds since the last key press or pointer move. It never reads
titles, contents or keystrokes. Without it (Windows, or permission not given) the pet still lives on
the desktop, just without window awareness.

## 5. Sharing · 分享

- **Pets** are character bundles listed in [`community/index.json`](../community/index.json) with
  their size and SHA-256; the app checks both and validates the bundle like a local import.
- **Plugins** are data, never code: `{version: 1, id, name, kind: "behavior", target, profile}`,
  where `target` is `"all"` or a character id and `profile` is a partial `DesktopProfile`. See
  [`community/plugins/cozy-corner.json`](../community/plugins/cozy-corner.json).

How to contribute: [community/README.md](../community/README.md).
`node scripts/community-index.cjs` rewrites the index after adding a file; `--check` verifies it.

## Reusing the module elsewhere

The pure parts have no Electron dependency and are covered by unit tests: `characterBehavior.ts`,
`life.ts`, `mood.ts`, `userContext.ts`, `src/animation/*`. A host needs to supply a window it can
move (`stepPet`), a scene of rectangles (`DesktopScene` in `src/types.ts`) and a canvas to draw
frames with `drawSpriteFrame`.
