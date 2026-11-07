# 昔涟七画风动画 v1

**历史版本。** v1 检查主要覆盖文件与播放行为，后来发现部分飞天小女警源帧有多余手臂，以及网格裁切和分辨率处理缺陷。当前已切换到 [v2 修复](CYRENE_MOTION_V2.md)；下文保留当时实现与验证记录，不代表视觉质量已经得到保证。

2026-10-04。只覆盖用户确认保留的原作画风、精绘、Q 版、飞天小女警、复古像素、8-bit 和低多边形 3D。原静态图与被移除画风的历史文件继续保留；没有为写实、毛绒、水彩或手办生成新内容。

## 使用

真实开发版的「外观动作」选择任一当前外观，直接试播招呼、点头、休息、表情和说话口型。切换外观后人物陪伴页与透明桌宠使用相同动画。人物头部点击可调用已有点头；聊天依据角色性格、语义与素材能力选择动作。普通待机自动眨眼；语音使用现有音量驱动口型，静音闭嘴。关闭动态效果或系统减少动态效果会保持静止帧。

精选角色包包含全部七套，导出内嵌 PNG、帧矩形、时序及调色板，离线导入不依赖本机路径。自定义图片或已有 `sprite` 始终优先，不会套上不匹配的内置动作帧。

## 素材与播放

每种画风以其已接受的角色图作为直接参考，独立调用一次内置 image_gen，共七次。没有调用配置的图像编辑 API。旧多格文件只解包中性格作为输入，旧静态文件没有被重绘覆盖。

每套有 16 个完整姿势：中性、半眨眼、闭眼、呼吸、两档口型、开心、思考、四个手臂姿势、两级低头和两张闭眼休息。关键姿势按制作时长播放，招呼与点头有恢复帧，休息循环。当前没有摇头、跳跃、难过与惊讶帧，所以相关控件保持不可用。低多边形 3D 是 PNG 动画，不是可旋转的 3D 网格或骨骼。

Electron 原生图像 codec 解包 4×4 输出，固定全套缩放比例，并以静止脚底进行平移注册；此步骤不绘制新人物、不做整图网格变形或面部贴片。普通画风保留 RGBA，复古像素运行时为 64×96 / 最多 32 色，8-bit 为 48×64 / 16 色，最近邻放大与硬透明边缘。

帧间服装细节、表情和姿势可能有生成差异。16 张姿势是首版关键帧素材，不等于连续手绘补间或完整骨骼系统；美感、角色还原与运动自然程度需要看实际视频审阅。

## 可检查文件

- 源输出：`artifacts/animation/cyrene-v1/sheets/{style}.png`。
- 直接参考：`artifacts/animation/cyrene-v1/masters/{style}.png` 与 `manifest.json`。
- 运行图集：`public/art/cyrene-{style}-motion-v1.png`。
- 共享播放与导出数据：`shared/cyrene-motion-pack.json`。
- 提示词、来源和字节哈希：`CYRENE_MOTION_V1_MANIFEST.json`、`art/cyrene-motion-v1-prompt.txt`。
- 实际播放器录制：`artifacts/animation/cyrene-v1/seven-styles-runtime.webm`。
- 待机 / 招手对照：`artifacts/animation/cyrene-v1/seven-styles-runtime.png`。

## 验证与重新打包

`tests/motion.test.cjs` 验证中性呼吸、眨眼、有限动作恢复、暂停和自定义素材优先；`tests/persona.test.cjs` 验证聊天能力与语义限制；`tests/companion.test.cjs` 验证七套图集与时序的自包含导出及旧素材保留。

`scripts/test-motion-desktop.cjs` 在隔离数据目录运行真实 Electron 界面，逐画风观察呼吸、闭眼、点头、口型、休息，检查像素边缘与色数，录制真实播放器；同时验证暂停、减少动态效果、首页头部点击和透明桌宠。禁止模型调用，检查结果写入 `runtime-verification.json`。它验证播放行为，不替代视觉评价。

```sh
node node_modules/electron/cli.js scripts/pack-cyrene-motion.cjs
pnpm build
node node_modules/electron/cli.js scripts/test-motion-desktop.cjs
```

重新打包只读已有 PNG，不发起绘图请求。构建和播放也不使用图像额度。
