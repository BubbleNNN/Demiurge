<p align="center">
  <img src="public/favicon.svg" width="112" alt="Demiurge" />
</p>

<h1 align="center">Demiurge</h1>

<p align="center">
  <b>Give your characters a life on your desktop.</b><br/>
  A local-first character companion: research a character, give them a voice, make them a desktop pet,<br/>
  and let them live beside you: sitting on the window you type in, writing their diary, asking you to play.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="docs/DEMIURGE_USER_GUIDE.md">User guide (中文)</a> ·
  <a href="community/README.md">Community pets &amp; plugins</a> ·
  <a href="docs/PET_MODULE.md">The pet module</a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.3.32-8c72d6" />
  <img alt="platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows-5a3f8f" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-c0668d" />
  <img alt="local first" src="https://img.shields.io/badge/local--first-no%20account%20needed-3a2d63" />
</p>

<p align="center">
  <img src="docs/media/banner.svg" alt="A little cube spirit sitting on top of a code editor window, saying it keeps you company" width="100%" />
</p>

> Formerly **Mori**. Your data folder, saved keys and macOS permissions carry over untouched.

## Why Demiurge

Most desktop pets play a loop. Demiurge's characters **live**: they notice what you are doing, have
their own routine and moods, and each one behaves like _themselves_.

|                                         |                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🪟 **Keeps you company where you work** | Start typing in an editor and she runs over, sits or lies on top of that window, does her own thing and steals glances at your screen. Stay away too long and she comes to ask for attention.                                                                                |
| 🎭 **Each character is themselves**     | Hobbies, small habits, how they get around (walk, run, hop or fly) and their manner (shy, teasing, playful, calm) come from the character's own profile. A diarist writes, a gamer plays, a shy one blushes when patted.                                                     |
| 💗 **Moods that matter**                | Happy when played with, lonely when ignored, cross when woken up or flung off a window. She sulks until you pat her head, and the chat model knows how she feels.                                                                                                            |
| 🖱️ **Feels physical**                   | Drag her and she swings; drag a window she sits on and she runs to keep her place; yank it away and she falls. Stroke her head with the pointer to pat her. She follows you across Spaces and full-screen apps.                                                              |
| 💬 **Talk without opening the app**     | A message box under her feet; replies appear above her head. Works with your own chat model, or with written lines and no account at all.                                                                                                                                    |
| 🎨 **Make your own pet**                | From a few reference images, Demiurge drafts a character image in several styles, then every motion (blink, talk, wave, sit, lie, fly, read, write, play…), checks each sheet and packs a reviewed sprite atlas. Corrections go through a chat model and a web search first. |
| 🌐 **Share and download**               | A community catalogue of pets and data-only plugins, installed with one click, every file checked against its digest.                                                                                                                                                        |
| 🔒 **Private by design**                | She sees window positions, the front app and seconds since your last key press, never titles, contents or keystrokes. Keys live in the system keychain. Everything runs on your computer.                                                                                    |

## Quick start

**Build.** There are no published downloads yet; builds are made locally and are unsigned (see [macOS packaging](docs/MACOS_RELEASE.md)):

```bash
pnpm install
pnpm setup:live2d        # optional: Live2D runtime
pnpm desktop             # run from source with hot reload
node scripts/package-desktop.cjs   # macOS app in release/
node scripts/package-windows.cjs   # Windows x64 zip in release/ (untested on Windows)
```

On macOS you can also double-click **Start Demiurge Dev.command**. Requires Node.js 22.12+.

**First steps.** The interface is in Chinese for now.

1. Open the app: the example character is ready to talk to without any API.
2. Click **放到桌面** (put on desktop). She runs in, waves and gets on with her day.
3. Hover below her feet for the toolbar: chat, activities, games, size.
4. Add your own character in **角色工作室** (character studio), or download one from **社区** (community) in the sidebar.

## How it works

```
 character profile ──► persona & lines ──► chat (your model, or written lines)
        │
        ├──► behaviour profile ── hobbies · habits · travel · manner
        │
 reference images ──► character image ──► motion sheets ──► checked, reviewed sprite pack
                                                          │
 desktop helper (macOS) ── windows · front app · typing ──┴──► desktop life: routine, moods,
                                                               perching, physics, invitations
```

- **Electron + React + TypeScript**, with plain CommonJS in the main process and ~400 unit tests.
- A small Swift helper streams window geometry, the front app, Space order and input timing
  (timestamps only) four times a second.
- The pet is a reusable module: persona, a sprite pack with clips and a frame review, and a
  behaviour profile. See [docs/PET_MODULE.md](docs/PET_MODULE.md).

## Community

Share a pet you made, or download one and use it right away. Plugins add habits, preferences and
lines to one character or to all of them; they are data, never code.
Read [community/README.md](community/README.md) to contribute.

## Documentation

- [User guide (中文)](docs/DEMIURGE_USER_GUIDE.md): everything the app does
- [Automatic pet production](docs/AUTOMATIC_PET_PRODUCTION.md): from reference images to a pack
- [Development notes (中文)](docs/DEVELOPMENT.zh-CN.md): running from source, services, debugging
- [Changelog (中文)](docs/CHANGELOG.zh-CN.md)
- [Third-party notices](docs/THIRD_PARTY.md) and [artwork notes](public/art/README.md)

## Contributing

Issues and pull requests are welcome, and so are pets and plugins for the catalogue.
`npx tsc -b && node --test tests/*.test.cjs` runs the checks. See [CONTRIBUTING.md](CONTRIBUTING.md).

If Demiurge made your desktop a little warmer, a ⭐ helps others find it.

## License

Source code: [MIT](LICENSE). Character artwork, fonts and third-party runtimes keep their own
rights; see [THIRD_PARTY.md](docs/THIRD_PARTY.md). Parts of the motion and desktop behaviour are adapted
from [Anime Codex](https://github.com/Lihhan/anime-codex) (MIT).
