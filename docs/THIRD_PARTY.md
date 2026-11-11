# Third-party code and artwork

Demiurge's source code is MIT licensed. Third-party runtimes, fonts, models and character artwork are not relicensed by Demiurge's LICENSE.

**Current release (0.1.6):** only the latest large chibi Cyrene pack and its own reference crop are bundled. Older artwork filenames and design references below record historical provenance; those older images are no longer distributed. The generic chibi style fallback now uses `cyrene-chibi-v6-reference.png`, without borrowing that example character's identity. Promotional music *心忆 / Remembrance of the Heart* (HOYO-MiX, 林一凡) retains its original rights and is excluded from MIT; see [media credits](media/README.md).

- Live2D Cubism Core: installed from Live2D's official SDK host by `pnpm setup:live2d`. Its original vendor notice is preserved. The downloaded file is Git-ignored. Consult [Live2D SDK licenses](https://www.live2d.com/en/sdk/license/) and the license URL in the vendor file before redistributing a binary that bundles it. A Vite production build copies locally installed public/vendor assets into dist.
- pixi-live2d-display and PixiJS retain their upstream licenses in the packages. The adapter uses the Cubism 3/4 model3 route; it does not promise support for every feature in newer Cubism models.
- Three.js and @pixiv/three-vrm retain their upstream licenses. VRM metadata and avatar permissions remain model-specific.
- @mozilla/readability (Apache-2.0) and linkedom (ISC): used to parse static public HTML and extract readable text. They do not execute webpage scripts. Their upstream license files remain in the dependency packages.
- Manrope font: bundled through @fontsource-variable/manrope; retain its SIL Open Font License when distributing fonts.
- `public/art/cyrene-*.png`: AI-generated fan artwork inspired by Cyrene from Honkai: Star Rail; not official assets. Character/IP rights remain with their respective owners. These images are excluded from the software's MIT grant. Use assets you have permission to distribute for a public release.
- `cyrene-reference-v3.png` was generated using four direct image references from the [HoYoWiki Cyrene entry](https://wiki.hoyolab.com/pc/hsr/entry/4003?lang=zh-cn). Original references remain under Git-ignored `.local/cyrene-reference` and in this machine's local character data. Source URLs, hashes and the generation prompt are documented in [CYRENE_REDESIGN.md](./CYRENE_REDESIGN.md); source reference images are not licensed or redistributed under Demiurge's MIT license.
- Imported models remain in the user's local workspace and are not included in exported JSON character bundles. Test samples under `.local/test-assets` are Git-ignored and are not part of the app distribution.
- Automatic image collection reads the [StarRailRes community catalog](https://github.com/Mar-7th/StarRailRes) and public source-page images into the user's local data. A repository's software license does not establish permission to redistribute the game's artwork. Name matching and file hash checks do not certify an official publisher or a particular character costume. Downloaded originals are not copied into the app's shipped `public/art` assets.
- Meshy is an optional external image-to-3D and rigging provider. It uses a separately configured key; generated model permissions and usage follow the user's provider terms and input rights. Installed GLB files and task records remain local and are excluded from exported character bundles.

Design references and implementation documentation: [DESIGN.md](./DESIGN.md).

The six `cyrene-*-v4.png` atlases derive from the user-reviewed v3 design and its original reference images. They share the same character-artwork rights limitations. See [style and motion provenance](./CYRENE_STYLES_AND_MOTION.md).

## Anime Codex pipeline adaptation (2026-11-06)

The cell-preserving padding and visible-frame checks in `electron/pet-frames.cjs` are adapted from the local Anime Codex project, `electron/pet-artifacts.cjs` (0.18.11, HEAD `de74b2ee2d468f129769618a198ed8b0ab8d244c`, with local changes present). Flat sticker art direction and selective alpha cleanup were informed by its character studio and style-study documentation. No character images, reference sheets, credentials, or user data were copied. Demiurge retains its own 2×2 / 4×2 contracts and explicit review and retry flow.

The following license applies to the adapted implementation:

```text
MIT License

Copyright (c) 2026 Anime Codex contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- `docs/images/workspace-*.png`: screenshots of an isolated Demiurge workspace containing the example fan artwork described above. They contain no user chat records or API keys. Character artwork shown within these screenshots is excluded from the MIT software grant.


## Anime Codex 动画与桌宠逻辑

方向动作、物理过渡、桌面几何感知和有界探索逻辑改编自 [Anime Codex](https://github.com/Lihhan/anime-codex)，Copyright (c) 2026 Anime Codex contributors，MIT 许可。完整许可见 [anime-codex-MIT.txt](licenses/anime-codex-MIT.txt)。本次未迁移其角色图片。

## 历史记录：Q版回退参考（2026-11-07，已在 0.1.6 移除）

`public/art/chibi-fallback-furina.png` 取自本机 Anime Codex 工作树 `public/characters/furina/sticker/atlas.png` 的第一格（待机帧），裁出单个人物并清除 alpha 低于 24 的残留后保存。该图是 Anime Codex 用内置图像工具按原神官方「派蒙的画作」第 28 弹表情包画风生成的二创素材，不是官方素材；芙宁娜及原神的角色权利归 HoYoverse 与相关权利人。Demiurge 仅在没有找到并核对通过的同角色 Q 版参考时，把它作为**画风参考**附在图像请求末尾，提示词明确禁止借用芙宁娜的外形、服饰与配色；它不会出现在用户的角色成品里，也不随角色包导出。该文件同样不在 Demiurge 的 MIT 软件许可范围内。

## 宣传片中的官方 PV 与音乐（不随应用分发）

2026-11-11 的纯音乐宣传片剪入《崩坏：星穹铁道》昔涟角色 PV「再度和你」的三个短片段，共 7.5 秒，来自[崩坏星穹铁道官方发布](https://www.bilibili.com/video/BV1yZ1MB1Eej/)。保留原始比例与来源标识，不混入 PV 原声。伴奏为《心忆 / Remembrance of the Heart》— HOYO-MiX、林一凡。视频、角色形象和音乐均不适用本项目的软件 MIT 许可；完整来源与剪辑范围见 [媒体说明](media/README.md)。完整原视频和音乐不进入 Git 历史或应用安装包。
