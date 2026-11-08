# Demiurge 社区 · Community

大家分享的桌宠和插件放在这里。Demiurge 里点侧栏的「社区」按钮就能浏览、下载并直接使用，不用重新制作。
Pets and plugins shared by everyone live here. In Demiurge, open **Community** from the sidebar to browse, download and use them, with nothing to remake.

## 分享桌宠 · Sharing a pet

1. 在 Demiurge 里打开「社区 → 分享我的桌宠」，导出角色包（`.json`，包含档案、外观和动作）。
   In Demiurge, open **Community → Share my pet** to export the character pack (`.json`: profile, looks and motions).
2. 在打开的 GitHub 页面里附上这个文件，写明名字、作品和授权方式；或者直接提交 Pull Request：
   Attach the file on the GitHub page that opens, with its name, work and license, or open a pull request:
   - `community/pets/<id>/pack.json`：角色包 · the pack
   - `community/pets/<id>/meta.json`：`{ "name", "work", "author", "description", "license" }`
   - `community/pets/<id>/preview.png`（可选，≤ 512 KB）：预览图 · optional preview
   - 运行 `node scripts/community-index.cjs` 更新目录 · run it to update the index
3. 维护者核对后合并，大家就能在应用里下载。CI 会检查每个文件。
   After review it is merged and everyone can download it. CI checks every file.

**授权 · Rights.** 只分享原创角色，或你有权分享的角色与素材，并在 `license` 里写清楚。不要上传官方游戏、动画的原始美术资源。
Share only original characters, or characters and art you have the right to share, and say how in `license`. Do not upload official artwork from games or anime.

## 插件 · Plugins

插件只包含数据，不运行代码：给某个角色（`target` 为角色编号）或所有角色（`"all"`）设置桌面上的生活方式和台词。
Plugins are data, never code: they set how a character (`target` is its id) or every character (`"all"`) lives on the desktop, and what it says.

```json
{
  "version": 1,
  "id": "my-plugin",
  "name": "名字 · Name",
  "author": "you",
  "description": "做什么 · What it does",
  "kind": "behavior",
  "target": "all",
  "profile": {
    "hobbies": ["read", "music"],
    "habits": ["sit", "lie", "lookAround", "stretch", "hum"],
    "travel": "walk | run | hop | fly",
    "manner": { "shy": 0.2, "teasing": 0.6, "playful": 0.5, "calm": 0.4 },
    "lines": { "arrive": [], "seek": [], "headpat": [], "poke": [], "hum": [], "peek": [] }
  }
}
```

活动 · Activities: `read`, `gaming`, `snack`, `music`, `diary`, `office`. 每一项都可省略 · Every part is optional.
把文件放在 `community/plugins/<id>.json`，再运行 `node scripts/community-index.cjs`。
Put the file at `community/plugins/<id>.json`, then run `node scripts/community-index.cjs`.
