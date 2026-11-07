# 昔涟动作修复 v2

此页保留 v2 修复记录。原版、8-bit、低多边形与飞天小女警的当前素材已更新为 [v3](CYRENE_MOTION_V3.md)，其余三种仍使用下述 v2 素材。

2026-10-05。用户报告飞天小女警动作中出现三只手，以及非像素画风放大后模糊。确认多余手臂已存在于 v1 源图中；播放器每次清空并绘制完整帧，没有叠加旧手臂。

本轮修复了通用验收、完整人物裁切、原始纹理保存与分辨率报告，见 [动画质量约定](ANIMATION_QUALITY.md)。原始静态立绘、v1 源图、v1 图集与旧播放记录均保留。

## 当前素材

- 七种保留画风仍各有 16 张姿势帧；动作能力与既有时序保持一致。
- 飞天小女警使用 `artifacts/animation/cyrene-v1/sheets/powerpuff-corrected-v2.png`。重新依据已确认静态立绘绘制，常态双臂放下，招手时只移动一条手臂，避免残留旧的脸旁手臂。静态立绘本身没有覆盖。
- 其余六种画风复用已保存源像素，不重新调用绘图。所有画风改用透明轮廓找到完整人物后打包，避免直接等分网格导致头饰/脚被切入下一格。
- 当前文件为 `public/art/cyrene-{style}-motion-v2.png`，统一注册表仍为 `shared/cyrene-motion-pack.json`。
- v2 源清单快照为 `artifacts/animation/cyrene-v2/source-manifest.json`；逐帧验收记录和失败候选说明为 `docs/CYRENE_MOTION_V2_REVIEW.json`。记录来自 Codex 对源帧与打包结果的视觉检查，不是用户对新增动画的最终美术认可，也不是自动解剖检测模型的结论。

本轮共使用三次内置 image_gen。第一张八帧候选改变了头身比例，第二张旧图编辑仍残留多余手臂，均未发布；第三张从正确立绘出发重新明确双臂姿势，完成后再次检查全部帧。失败输出保留供比较；没有调用用户配置的图像 API。

最终提示词保存在 `docs/art/cyrene-powerpuff-motion-v2-prompt.txt`。产品生成提示词以参考角色的实际肢体结构为准；上述绘图任务中“两条手臂”的要求只描述这张参考立绘，通用代码不假定所有角色都只有两条手臂。

## 分辨率的实际边界

目前这些拼图源帧的人物高度约 290–380 像素，并不是全尺寸高清动画。修复保留的是现有细节，不能恢复模型在拼图中未生成的细节。播放不再把非像素高清导入帧压到逻辑尺寸，也不把打包放大的尺寸当成源清晰度。真正的大尺寸高清动画仍需足够分辨率的独立姿势源图。

帧间脸部、服装和动作自然程度仍可以继续视觉调试。关键姿势播放器不等于连续手绘补间、骨骼动画或可旋转的 3D 模型。

## 验证与预览

- 173 项单元测试及 TypeScript 检查。
- 构建成功；现有 Three.js 模块体积提示不影响构建。
- 原生质量检查：`artifacts/animation/quality-v2/native-verification.json` 与 `frame-review.png`。
- 七画风真实播放：`artifacts/animation/cyrene-v2/runtime-verification.json`、`seven-styles-runtime.png` 与 `seven-styles-runtime.webm`。

```sh
node node_modules/electron/cli.js scripts/pack-cyrene-motion.cjs --inspect
node node_modules/electron/cli.js scripts/pack-cyrene-motion.cjs
pnpm build
node node_modules/electron/cli.js scripts/test-animation-quality-desktop.cjs
node node_modules/electron/cli.js scripts/test-motion-desktop.cjs
```

打包、构建与测试只使用本机文件，不生成新图片。
