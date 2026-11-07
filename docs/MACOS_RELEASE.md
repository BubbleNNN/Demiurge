# Mori macOS 本地应用包

Mori 可以打包成独立的 `Mori.app` 和 ZIP。使用者打开应用不需要 Node.js、pnpm 或开发服务器。当前脚本按构建机器和已安装 Electron 的原生架构生成 arm64 或 x64 包；本轮验收目标是 Apple Silicon。

## 构建与检查

在项目根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm setup:live2d
pnpm package:mac
pnpm test:package
```

已经装好的依赖和 Live2D Core 可以直接使用，打包过程本身不联网、不调用图像或聊天 API、不上传文件。`package:mac` 会先完成 TypeScript 检查和 Vite 生产构建。`node scripts/package-desktop.cjs --skip-build` 可复用刚验证过的生产构建；仅在确认构建与源码一致时使用。`--no-zip` 只生成应用目录。

产物位于：

```text
release/Mori-0.3.6-macOS-arm64/
  Mori.app
  package-manifest.json
  RELEASE_GUIDE.md
release/Mori-0.3.6-macOS-arm64.zip
release/Mori-0.3.6-macOS-arm64.zip.sha256
```

可双击应用或拖入自己的「应用程序」文件夹。应用默认使用 `~/Library/Application Support/Mori` 保存角色、聊天、记忆和设置；开发版的 `.local/development-v2` 是另一份工作区。更新应用时保留用户数据目录即可。密钥按应用已有的系统安全存储策略保存，旧开发环境中的密钥不会随应用包迁移。迁移开发版的完整进度时，先在开发版「连接设置 → 工作区与备份」导出工作区 ZIP，再在打包应用中恢复；恢复成功后应用会重新启动。完整备份包含角色、聊天、记忆、模型和制作任务，不包含 API 密钥，恢复后需重新填写密钥。角色包导出和导入仍可用于单独分享角色与 2D 外观，它不携带完整工作区历史。

`pnpm test:package` 启动真正的打包可执行文件，工作目录设在系统临时目录，使用新建的 `MORI_DATA_DIR`，不会读取或修改正式用户数据。检查首启、沙箱与 IPC、内置素材、无密钥本地陪伴、透明桌宠窗口、Live2D Core 的实际加载、页面重载后的持久化，并验证主进程全部业务模块可以从包内解析依赖。测试仅临时启用绑定到 `127.0.0.1` 的随机调试端口；普通启动不启用端口。报告和截图在 `artifacts/macos-release-arm64/`。该检查没有验证真实模型生成画质，也没有加载具体 Live2D/VRM 模型。

## 入包范围与第三方资源

手工封装采用 [Electron 官方应用分发文档](https://www.electronjs.org/docs/latest/tutorial/application-distribution) 的预编译应用结构。打包脚本只复制主进程模块、共享 JSON、Vite 生产构建、供角色包导出使用的内置图片，以及运行所需的依赖。它按真实包路径解析 pnpm 依赖链，复制为应用内部独立的依赖树；内部复用链接不能指向应用外。

项目根目录下的其他研究项目、`.local`、备份、环境文件、日志、测试、开发脚本、原始用户模型与缓存不会进入包。审计以白名单和文件哈希记录应用载荷；ZIP 另附 SHA-256。清单便于比较重复构建，ZIP 的文件时间和压缩元数据可能不同，不宣称跨机器逐字节一致。

`Contents/Resources/app/licenses/` 保存生产依赖许可、Manrope 字体 OFL、Electron/Chromium 许可和第三方说明。Live2D Core 原文件及其授权头保留在 `dist/vendor/`，没有改成 MIT。`public/art` 与 `dist/art` 的字节相同，分别支持角色导出和页面渲染。详情参见项目中的 `docs/THIRD_PARTY.md`，或应用包内的 `licenses/THIRD_PARTY.md`。

## 本地验收与公开发布的区别

本轮生成的是本地验收包，没有 Apple Developer ID 签名、公证、自动更新或上传。macOS 最低版本取自所用 Electron 发行包，本轮为 macOS 12；没有在其他 macOS 版本或 Intel 机器上验收。换机器下载的未签名应用可能被 Gatekeeper 阻止，当前不能作为已公证的公开安装包宣传。

Live2D Core 使用其专有许可。Mori 允许导入用户模型，公开发布时应针对这种可扩展应用用途确认 [Live2D SDK 许可](https://www.live2d.com/en/sdk/license/) 和 [专有软件许可协议](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 的适用条件。当前未替用户申请任何授权。内置昔涟图片是带角色 IP 限制的 AI 同人素材，也不属于 Mori 源码的 MIT 授权；公开发布前应换成有分发权限的默认角色素材或取得相应授权。上述资源保留在本地验收包中，避免把缺少运行资源的包误称为完整版本。

公开发布还需在目标系统上复验、完成签名和公证、确认素材分发许可，并制定更新渠道。本轮只落地本地应用封装与自动验收，不执行这些外部发布动作。
