# Demiurge README media

The showcase uses the existing Cyrene fan-art sprite atlases under `public/art/`, with clip indices and timing from `shared/cyrene-motion-pack.json`. No new character image or motion was generated. It contains no private workspace data, screenshots of the user's desktop, credentials, voice cloning or third-party music.

- `cyrene-styles.gif`: four looks, original / 8-bit / low-poly look / cartoon, 960 × 470.
- `cyrene-original.gif`, `cyrene-8bit.gif`, `cyrene-cartoon.gif`: wave, blink, nod, mouth states and rest, 480 × 560; 96 frames each, looping.
- `demiurge-intro.mp4`: 32 seconds, 1280 × 720, 24 fps, H.264, no audio. A motion and feature introduction, rather than a live UI recording.
- `demiurge-intro-poster.png`: the video opening frame.

The low-poly look is a PNG sprite style. The talking segment plays authored mouth frames and is not a phoneme lip-sync demonstration. Reading and gaming assets are not part of these bundled examples.

## Reproduce on macOS

Uses Apple's ImageIO, CoreGraphics, AppKit and AVFoundation offscreen, with no application windows. Requires the Swift command-line toolchain; no model keys or external media packages.

```sh
swift -module-cache-path /tmp/demiurge-media-cache scripts/media/render-showcase.swift "$PWD"
```

The script reads only the public bundled atlas catalogue and writes the media above. It preserves a common logical canvas for each character sequence and uses nearest-neighbour sampling for pixel art. Generated clips were checked for frame count, distinct frame content and video duration, and sampled video frames were visually inspected.

## Rights

These derivatives carry the same fan-art limitations as their source assets. They are excluded from the project's MIT software license. Rights to Cyrene and Honkai: Star Rail remain with their respective owners. See [example artwork](../../public/art/README.md) and [third-party notices](../THIRD_PARTY.md). The renderer source is part of the MIT-licensed project code.
