# Latest chibi Cyrene promotional media

Version 0.1.6 uses only the latest large chibi Cyrene artwork. Four GIFs show desktop movement, work, leisure and rest. Two 67.2-second H.264/AAC videos are published as GitHub Release assets, in portrait 1080×1920 and landscape 1920×1080 at 30 fps. The rendered MP4s are intentionally not added to Git history.

- [Portrait video](https://github.com/BubbleNNN/Demiurge/releases/download/v0.1.6/demiurge-desktop-life-vertical.mp4)
- [Landscape video](https://github.com/BubbleNNN/Demiurge/releases/download/v0.1.6/demiurge-desktop-life-landscape.mp4)
- [Chinese narration subtitles](demiurge-desktop-life.zh-CN.srt)
- [Full video and GIF decoding verification](validation.json)
- [Action coverage](action-coverage.json) and [audio timing verification](audio-validation.json)

## What is shown

Real approved animation frames are rendered with their authored durations, source rectangles, offsets and logical cells. All distinct action clips are represented, including entries/exits; `neutral` and `sleepy` are aliases rather than additional actions. The source pack contains 201 frames and 56 named clips. Coverage records 54 distinct named clips used by the film, not a promise that every frame is held long enough to inspect individually.

The desktop note window is a clean editorial composition, not a recording of the user's screen. Community panels are captured from the real application using isolated data and blocked external requests. Conversation lines are illustrative. The shared-pet catalog is still in its early stage; the film does not invent downloaded pets or an established user count. Window-aware features shown in the composition are currently macOS-specific.

The film introduces Cyrene, explicitly says “不止昔涟”, introduces creating/importing other characters and community sharing, then invites Stars and contributions. A character's generated animation quality still depends on its references, model and review.

## Voice and music

Narration: generic Microsoft `zh-CN-XiaoxiaoNeural` AI voice, generated with edge-tts, without imitating the character's voice actor. Ten separately timed segments finish before their scene boundaries.

Music: **心忆 / Remembrance of the Heart**, **HOYO-MiX, 林一凡**, from *Honkai: Star Rail — Allegory of the Cave (Part 3)*. [Official artist upload](https://www.youtube.com/watch?v=xPIb5c62C9g). The edit uses an excerpt starting 12 seconds into the track, with fades and narration ducking. A public [Bilibili soundtrack upload](https://www.bilibili.com/video/BV19ACuBWE8J/) supplied the edit's audio. The full source audio is not redistributed in this repository.

Music and character artwork are excluded from the software MIT license. Rights remain with their respective owners. This is an unofficial fan project. For a different distribution requiring different audio rights, the mixer also exports a narration-only WAV so the music can be replaced without regenerating the video.

## Reproduce locally on macOS

No desktop pet window needs to become visible. Use a disposable environment for media dependencies (`edge-tts`, `imageio-ffmpeg`). Supply your own authorized music file; scripts do not download it or inspect a browser session.

```bash
node scripts/media/prepare-bundled-social.cjs
pnpm build
MORI_QUIET=1 pnpm exec electron scripts/media/capture-community.cjs
python scripts/media/narrate-social.py .local/promo-chibi
python scripts/media/mix-social.py .local/promo-chibi /path/to/music.m4a
swiftc -O scripts/media/render-social.swift -o /tmp/demiurge-social
/tmp/demiurge-social "$PWD" "$PWD/.local/promo-chibi" video vertical
/tmp/demiurge-social "$PWD" "$PWD/.local/promo-chibi" video landscape
/tmp/demiurge-social "$PWD" "$PWD/.local/promo-chibi" gif
swift scripts/media/finalize-social.swift "$PWD" "$PWD/.local/promo-chibi"
```

`prepare-social.cjs` is an alternative explicit export helper for a user-selected, reviewed local skin. It exports only approved media and animation metadata, not chats, credentials or character memories.

The finalizer verifies dimensions, 30 fps, duration, an audio track, and decodes all 2,016 video frames per version and every GIF frame. Audio is mixed into a fixed-size PCM buffer; segment boundaries and peak level are recorded separately. Visual checks include all source-frame contact sheets, scene keyframes and the community screen.
