# Continue her story — promotional film

The revised film lasts **112.7 seconds**, with no narration. Two H.264/AAC versions are published as GitHub Release assets: portrait 1080×1920 and landscape 1920×1080, both 30 fps. Only the latest large chibi Cyrene pet is demonstrated. The MP4s and full third-party source video are intentionally excluded from Git history and the application bundle.

- [Portrait video](https://github.com/BubbleNNN/Demiurge/releases/download/v0.1.6/demiurge-desktop-life-vertical.mp4)
- [Landscape video](https://github.com/BubbleNNN/Demiurge/releases/download/v0.1.6/demiurge-desktop-life-landscape.mp4)
- [Chinese text track](demiurge-desktop-life.zh-CN.srt) — on-screen text, not speech transcription
- [Full video/GIF decoding verification](validation.json)
- [Action coverage](action-coverage.json) and [music-only verification](audio-validation.json)
- [Single-source storyboard](../../scripts/media/storyboard.json)

## Story

The opening uses 7.5 seconds of footage from the official **《崩坏：星穹铁道》昔涟角色 PV「再度和你」**, published by 崩坏星穹铁道: [source](https://www.bilibili.com/video/BV1yZ1MB1Eej/). Three excerpts start at 32.5, 120.0 and 176.7 seconds and last 2.5 seconds each. The publicly available source used here is 854×362; the film preserves its complete aspect ratio and attribution. Exporting at 1080p does not make the source footage native 1080p. Source audio is not included.

The footage is followed by “今天，我想续写她的故事。” and a dedicated **德谬歌 / DEMIURGE** title reveal. Desktop companionship follows. The “不止昔涟” section introduces the system: learning character information and references, generating different visual styles through connected models, and giving the reviewed character its own desktop routine. The reference to the original story's intelligent agent is creative inspiration, not a claim that the application reproduces a fictional agent or is officially affiliated with the game.

Community sharing and a Star invitation come after the system introduction. The closing sentence **“和你喜欢的角色，明天见”** occupies its own seven-second page, without a URL, CTA, page counter or other copy. No page counters appear anywhere in the film or the refreshed GIFs.

## What is actually shown

Real approved animation frames use their authored durations, source rectangles, offsets and logical cells. The source pack contains 201 frames and 56 named clips; `neutral` and `sleepy` are aliases. Coverage records the distinct clips represented, rather than promising every source frame is held for individual inspection.

The desktop note window and the three creation-flow cards are editorial compositions. They are not recordings of a user's desktop or proof that a generation request was made during filming. Actual community panels use isolated data. Conversation lines are illustrative. Style chips describe available creation choices; only Q-version artwork is shown as generated output. Generation requires suitable model services, references and review; it does not guarantee every character is ready from a name alone. Window awareness is currently macOS-specific. The sharing catalog is early-stage.

## Soundtrack and rights

**No AI voice, voice clone, character speech or original PV audio is mixed.** The only audio source is **心忆 / Remembrance of the Heart — HOYO-MiX, 林一凡**, from *Honkai: Star Rail — Allegory of the Cave (Part 3)*. [Official artist upload](https://www.youtube.com/watch?v=xPIb5c62C9g). A public [Bilibili soundtrack upload](https://www.bilibili.com/video/BV19ACuBWE8J/) supplied the edit's music. The excerpt begins at 12 seconds, lasts exactly 112.7 seconds, and fades in/out. No narration ducking is used.

Character imagery, official footage and music are excluded from the software MIT license; rights remain with their owners. This is an unofficial fan project. Full source video/audio and prior voice-generation intermediates are not distributed in the repository or app.

## Reproduce locally on macOS

No desktop pet window needs to become visible. Use a disposable environment with `imageio-ffmpeg`, and supply the local official trailer and music files. Scripts do not inspect browser sessions or download source media.

```bash
node scripts/media/prepare-bundled-social.cjs
cp public/art/cyrene-chibi-v6-reference.png .local/promo-chibi/reference.png
pnpm build
MORI_QUIET=1 pnpm exec electron scripts/media/capture-community.cjs
python scripts/media/prepare-opening.py /path/to/official-cyrene-pv.mp4 .local/promo-chibi
python scripts/media/mix-social.py .local/promo-chibi /path/to/music.m4a
swiftc -O scripts/media/render-social.swift -o /tmp/demiurge-social
/tmp/demiurge-social "$PWD" "$PWD/.local/promo-chibi" preview
/tmp/demiurge-social "$PWD" "$PWD/.local/promo-chibi" video vertical
/tmp/demiurge-social "$PWD" "$PWD/.local/promo-chibi" video landscape
/tmp/demiurge-social "$PWD" "$PWD/.local/promo-chibi" gif
swift scripts/media/finalize-social.swift "$PWD" "$PWD/.local/promo-chibi"
```

The finalizer reads duration from the shared storyboard and verifies dimensions, 30 fps, one audio track, all 3,381 video frames per version and every GIF frame. Audio uses a bounded PCM buffer. Final encoded audio and scene keyframes are inspected separately. `prepare-social.cjs` remains an alternative export helper for a specifically selected, reviewed local skin, without chats, credentials or memories.
