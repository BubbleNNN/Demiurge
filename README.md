<p align="center"><img src="public/favicon.svg" width="88" alt="Demiurge" /></p>
<h1 align="center">Demiurge</h1>
<p align="center"><b>Bring your favorite characters to life on your desktop.</b><br/>Work, read, play, and do nothing together. A little company for an ordinary day.</p>
<p align="center"><a href="README.zh-CN.md">简体中文 · 新手教程</a> · <a href="https://github.com/BubbleNNN/Demiurge/releases/latest">Download for Windows</a> · <a href="community/README.md">Community</a></p>
<p align="center"><img alt="version" src="https://img.shields.io/badge/version-0.1.6-b85a8b" /> <img alt="platforms" src="https://img.shields.io/badge/macOS%20%7C%20Windows-desktop-8671ba" /> <img alt="license" src="https://img.shields.io/badge/code-MIT-699c85" /></p>

![Cyrene walking, sitting and keeping you company](docs/media/cyrene-chibi-desktop.gif)

**Not just Cyrene.** Demiurge lets you create, import, animate, and share other characters. Version **0.1.6** includes only the latest **large chibi Cyrene** starter pet. Other characters need their own profiles and artwork; entering a name alone does not guarantee a complete animated pet.

## Today, I want to continue her story

[![Watch the music-only story film](docs/media/demiurge-landscape-cover.png)](https://github.com/BubbleNNN/Demiurge/releases/download/v0.1.6/demiurge-desktop-life-landscape.mp4)

[Landscape · 1920×1080](https://github.com/BubbleNNN/Demiurge/releases/download/v0.1.6/demiurge-desktop-life-landscape.mp4) · [Portrait · 1080×1920](https://github.com/BubbleNNN/Demiurge/releases/download/v0.1.6/demiurge-desktop-life-vertical.mp4)

Music-only, with Chinese on-screen copy and no AI narration. Music: *Remembrance of the Heart / 心忆* by HOYO-MiX and 林一凡. The 112.7-second story edit opens with brief excerpts from the official Cyrene trailer and introduces automatic character creation and desktop life. Actual animation assets and community UI are used in an editorial desktop composition. Dialogue is illustrative; this is not an uninterrupted live recording. [Media credits and reproduction](docs/media/README.md).

<table><tr><th>Busy together</th><th>Her own little routine</th></tr><tr><td><img src="docs/media/cyrene-chibi-work.gif" alt="Working, reading and journaling" width="460" /></td><td><img src="docs/media/cyrene-chibi-life.gif" alt="Music, games and snacks" width="460" /></td></tr></table>

## What it does

- **Desktop company:** walking, sitting, lying down, sleeping, reading, office work, journaling, music, snacks, and games, played from actual authored poses.
- **Continuous routines:** character preferences, needs and a current task guide behavior. Focused activities last minutes; brief interactions pause the activity clock instead of constantly switching poses.
- **Touch and conversation:** click, stroke her head, or drag her somewhere comfortable. Replies appear in bubbles; expand conversation history when needed.
- **Character-grounded dialogue:** personal facts, relationships, events, traits and voice rules with source, uncertainty and spoiler labels. Inspect, edit, or delete memories of your interactions.
- **A workshop and sharing directory:** create looks and actions from references, review frames, import/export character packs, and share pets or data-only life plugins.

Window perching and foreground-window awareness currently require the **macOS helper**. Windows supports desktop pets and chat without window awareness. Mood and daily life are simulated behavior; model replies are not guaranteed to remain perfectly in character.

## Install on Windows — no programming required

For **Windows 10 / 11 x64**. You do not need Node.js, Python, or Git.

1. Open [release v0.1.6](https://github.com/BubbleNNN/Demiurge/releases/tag/v0.1.6) and download **Demiurge-0.1.6-windows-x64.zip**. The separate “Source code” links are for developers.
2. Right-click the ZIP → **Extract All** into a permanent folder. Keep the entire extracted folder; do not run inside the ZIP or move only the exe.
3. Double-click **Demiurge.exe** and follow the first-use steps below.
4. This build is unsigned. If SmartScreen reports an unknown publisher, verify the download came from this release and check its checksum before deciding whether to proceed.
5. Create a shortcut if desired. To update, fully quit the app, extract the new version, then remove the old application folder. Keep **`%APPDATA%\Mori`**, which contains your characters, settings, and chats.

Optional checksum verification in PowerShell:

```powershell
Get-FileHash .\Demiurge-0.1.6-windows-x64.zip -Algorithm SHA256
```

Compare with the accompanying `.sha256` file. The cross-built package and file integrity have been checked; **it has not been run on a physical Windows machine**. [Report Windows issues](https://github.com/BubbleNNN/Demiurge/issues) with your OS version and reproduction steps.

The public package excludes the separately licensed Live2D Cubism Core. The bundled chibi sprite pet works without it. The exe file still has Electron's default icon; the window and taskbar use Demiurge's icon.

## First-use tutorial

The current interface is primarily Chinese; the labels below match the app.

### 1. Try companionship without an API key

Open the app, then choose **体验桌面陪伴** in the welcome guide or **放到桌面** at the top right. The latest chibi Cyrene is ready to use.

Click her for a response, move the pointer back and forth over her head to stroke it, or drag her to move. Hover nearby for the pet toolbar, activities, chat and size controls. Reading and other focused activities last several minutes. **连接与设置** controls size, automatic life and sound; pause automatic life or close the pet when you want quiet.

The default **本地台词** mode uses authored local lines. It needs no service or paid API calls, but it is not unrestricted AI conversation.

![First launch: dismissible guide and the bundled chibi Cyrene](docs/media/first-start.png)

### 2. Connect a model for free-form conversation

1. Open **连接与设置** and find the conversation provider.
2. Select your provider: OpenAI-compatible, Alibaba Qwen, DeepSeek, Doubao, MiniMax, GLM, Anthropic, or local Codex.
3. Enter that provider's **API key, model / endpoint ID, and service URL**. Changing providers does not replace your existing key or model automatically.
4. If your provider gives a full request URL, use the full-address option and check the displayed final URL for duplicate path suffixes.
5. Save and test, select **模型对话** in the conversation panel, and send a greeting.

Chat uses a text model. **Generating new artwork and animation requires a compatible reference-image generation service as well**; a chat-only key does not imply image support. Playing existing pets needs no image service. Subscription and API billing depend on your actual provider account. [Provider details and troubleshooting](docs/CHAT_PROVIDERS_AND_MEMORY.md).

### 3. Shape a character's voice and memory

Go to **角色工作室 → 角色档案**, then **补充资料** to collect or reorganize information. Wiki, source links and saved-source text are available; Tavily is optional. If a site fails, supply official source links or reorganize previously saved material.

Review relationships, event timelines, traits, voice rules and spoiler settings. Keep unverified claims marked as such. Separate your creative additions from canon. Inspect the memory page and correct or delete inaccurate interaction memories.

### 4. Add another character

- **Import an existing pack:** use the character or community entry, select the character and appearance, then place it on your desktop.
- **Make a new pet:** add a character name and work → collect its profile → add consistent reference images → generate and approve a base → create actions → inspect the frames before activation.
- **Bring your own artwork:** import compatible sprite sheets or character packs to avoid regenerating available assets.

Quality varies by character, style and model. Check anatomy, identity and continuity; unsuccessful candidates do not replace an approved pet automatically. [Production guide](docs/AUTOMATIC_PET_PRODUCTION.md).

### 5. Share and build together

Open **社区桌宠与插件** to browse the directory, install life plugins, or prepare a pet sharing pack. The directory is young: contributions are welcome. Submission to the public catalog goes through a pull request; preparing a sharing pack does not automatically publish your private chats or API keys. [Contribution instructions](community/README.md).

Give the project a **Star** if you like the idea. Help with character packs, routines, animation, Windows testing, or interface design — let's bring more characters to life together.

## macOS and development

Run from source on Apple silicon macOS with **Node.js 22.12+** and **pnpm 11.25**:

```bash
git clone https://github.com/BubbleNNN/Demiurge.git
cd Demiurge
pnpm install
pnpm desktop
```

Optional Live2D setup: `pnpm setup:live2d`, subject to its third-party license.

```bash
pnpm check
pnpm build
node scripts/package-windows.cjs --public  # cross-build Windows x64 on macOS
pnpm setup:live2d
node scripts/package-desktop.cjs          # build a native macOS package
```

Formerly Mori; the existing data directory remains `~/Library/Application Support/Mori` on macOS and `%APPDATA%\Mori` on Windows. Updates preserve user-created pets. The macOS helper reads window geometry, foreground application and input timing, not screen text or keystroke content. Model/search requests send relevant material to the configured providers; not all processing happens offline.

## A note from the creator

<!-- AUTHOR: Add your motivation, personal story, and the kind of companionship you hope to create. -->
> Reserved for the creator: why this project exists.

## What comes next

<!-- AUTHOR: Add your confirmed roadmap, community links, or contribution priorities. -->
> Reserved for the creator: future direction and community invitation.

## Documentation and licensing

[Full user guide (中文)](docs/DEMIURGE_USER_GUIDE.md) · [Changelog](docs/CHANGELOG.zh-CN.md) · [Pet module](docs/PET_MODULE.md) · [Contributing](CONTRIBUTING.md) · [Third-party notices](docs/THIRD_PARTY.md)

**Code: [MIT](LICENSE)**. Character assets, music, fonts and third-party runtimes retain their separate rights. The bundled Cyrene is AI-generated fan artwork, not an official product. Video music *Remembrance of the Heart* is not included in the software's MIT grant. [Artwork notice](public/art/README.md). Parts of the desktop behavior are adapted from [Anime Codex](https://github.com/Lihhan/anime-codex) (MIT).
