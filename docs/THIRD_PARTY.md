# Third-party code and artwork

Mori's source code is MIT licensed. Third-party runtimes, fonts, models and character artwork are not relicensed by Mori's LICENSE.

- Live2D Cubism Core: installed from Live2D's official SDK host by `pnpm setup:live2d`. Its original vendor notice is preserved. The downloaded file is Git-ignored. Consult [Live2D SDK licenses](https://www.live2d.com/en/sdk/license/) and the license URL in the vendor file before redistributing a binary that bundles it. A Vite production build copies locally installed public/vendor assets into dist.
- pixi-live2d-display and PixiJS retain their upstream licenses in the packages. The adapter uses the Cubism 3/4 model3 route; it does not promise support for every feature in newer Cubism models.
- Three.js and @pixiv/three-vrm retain their upstream licenses. VRM metadata and avatar permissions remain model-specific.
- @mozilla/readability (Apache-2.0) and linkedom (ISC): used to parse static public HTML and extract readable text. They do not execute webpage scripts. Their upstream license files remain in the dependency packages.
- Manrope font: bundled through @fontsource-variable/manrope; retain its SIL Open Font License when distributing fonts.
- `public/art/cyrene-*.png`: AI-generated fan artwork inspired by Cyrene from Honkai: Star Rail; not official assets. Character/IP rights remain with their respective owners. These images are excluded from the software's MIT grant. Use assets you have permission to distribute for a public release.
- `cyrene-reference-v3.png` was generated using four direct image references from the [HoYoWiki Cyrene entry](https://wiki.hoyolab.com/pc/hsr/entry/4003?lang=zh-cn). Original references remain under Git-ignored `.local/cyrene-reference` and in this machine's local character data. Source URLs, hashes and the generation prompt are documented in [CYRENE_REDESIGN.md](./CYRENE_REDESIGN.md); source reference images are not licensed or redistributed under Mori's MIT license.
- Imported models remain in the user's local workspace and are not included in exported JSON character bundles. Test samples under `.local/test-assets` are Git-ignored and are not part of the app distribution.
- Automatic image collection reads the [StarRailRes community catalog](https://github.com/Mar-7th/StarRailRes) and public source-page images into the user's local data. A repository's software license does not establish permission to redistribute the game's artwork. Name matching and file hash checks do not certify an official publisher or a particular character costume. Downloaded originals are not copied into the app's shipped `public/art` assets.
- Meshy is an optional external image-to-3D and rigging provider. It uses a separately configured key; generated model permissions and usage follow the user's provider terms and input rights. Installed GLB files and task records remain local and are excluded from exported character bundles.

Design references and implementation documentation: [DESIGN.md](./DESIGN.md).

The six `cyrene-*-v4.png` atlases derive from the user-reviewed v3 design and its original reference images. They share the same character-artwork rights limitations. See [style and motion provenance](./CYRENE_STYLES_AND_MOTION.md).

## Anime Codex pipeline adaptation (2026-11-06)

The cell-preserving padding and visible-frame checks in `electron/pet-frames.cjs` are adapted from the local Anime Codex project, `electron/pet-artifacts.cjs` (0.18.11, HEAD `de74b2ee2d468f129769618a198ed8b0ab8d244c`, with local changes present). Flat sticker art direction and selective alpha cleanup were informed by its character studio and style-study documentation. No character images, reference sheets, credentials, or user data were copied. Mori retains its own 2×2 / 4×2 contracts and explicit review and retry flow.

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
