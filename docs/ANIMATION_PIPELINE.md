# 动画制作与导入

Live2D从同一设计的分层原画开始：分离前后发、脸、眼睑、眼球、嘴部、衣服和四肢，并补画移动后会露出的被遮挡区域；再制作网格、变形器、参数、物理和动作曲线，检查极限姿势与动作衔接，导出moc3/model3和motion3/physics3等资源。[Live2D官方素材分离说明](https://docs.live2d.com/en/cubism-editor-manual/divide-the-material/)要求补画可动部位及移动后可见的部位。

Spine采用骨骼、附件、网格权重和时间线。关键帧与曲线需要在实际运行时检查混合效果。[Spine官方流程与功能](https://esotericsoftware.com/spine-in-depth)。这些原理不能由无分层完整图上的任意拉伸替代。

像素角色制作姿势原画帧，通过时间线、逐帧时长、帧标签和洋葱皮检查衔接，再导出图集。[Aseprite官方动画流程](https://www.aseprite.org/docs/animation/)。Demiurge内置8-bit走此路线：AI生成关键姿势素材，测量注册锚点，编排动作时序，实际预览检查；仍需人工审阅。

真正3D需要网格/拓扑、骨架/权重、面部形变目标、动作和物理。VRM导入后驱动真实骨骼与已有表情。[Blender官方蒙皮说明](https://docs.blender.org/manual/en/5.0/animation/armatures/skinning/introduction.html)与[动画/绑定手册](https://docs.blender.org/manual/en/5.2/animation/index.html)。3D风格PNG只是渲染图。

## Aseprite导入

多画风路线与现有项目研究见 [桌宠美术制作流程](PET_ART_WORKFLOWS.md)。画风和播放格式可以分开选择。

## 自动产生姿势帧

「外观工作台 → 自动制作多画风桌宠」使用图像编辑服务生成独立画风基准，然后每动作生成一张透明 2×2 姿势图。基准和原图始终共同参与动作编辑；本机裁分四帧、检查透明边界、以首个待机姿势统一注册，并整理有限动作和循环时序。所有帧保留整体动作中的相对位移，不对每一帧单独重新居中，也不靠整体 PNG 摇晃代替关节运动。

默认六组动作，也可选八组；全部生成共三十三个原画帧。技术检查和保存失败恢复已接入任务流程，但四帧不等于密集、高流畅度动画，不能自动保证身份或动作连续性。最终产物先作为候选保存，对照原图试播后再启用。完整请求数量、暂停/重试和真实服务验证边界见 [自动制作说明](AUTOMATIC_PET_PRODUCTION.md)。

## PNG 动作文件夹导入

在「外观工作台 → 画风与素材制作」选画风，然后导入包含动作子文件夹的角色目录。Krita、模型渲染或外部动画工具导出的 PNG 都可使用。

```text
角色素材/
  idle/001.png, 002.png
  wave/001.png, 002.png, 003.png
  blink/001.png, 002.png
  talk/001.png, 002.png
  happy/001.png
  pet.json（可选）
```

idle 必须存在，其他动作可选。还支持 nod、shake、bounce、sleep、neutral、thinking、sad、sleepy、surprised。按文件名数字顺序播放，默认每帧 100 毫秒。全部动作保留相同画布和脚底位置，关闭紧边界裁剪。最多 256 帧、总文件 32 MiB、单帧 2048×2048，解码像素总量限制为 16 百万，最终图集最多 8 MiB。

可选 pet.json 设置名称、统一时长和动作时长，durations 与对应动作帧数一致：

```json
{
  "name": "角色原作动画",
  "frameDuration": 100,
  "clips": { "wave": { "durations": [100, 200, 100], "loop": false } }
}
```

idle、sleep、talk 默认循环，其他动作默认有限播放。像素使用最近邻，其他画风平滑显示。导入仅合成图集，不调用生成 API 或重绘，先试播再保存。此格式不等于兼容 VPet / Shimeji 原包。

## Aseprite 导出步骤

1. 全部帧使用相同的画布、脚部锚点与比例，避免每帧重新居中或按紧边界裁剪。
2. 制作帧，设置duration，用idle、wave、nod、shake、bounce、sleep、blink、talk或情绪名称创建标签。
3. 导出PNG及JSON-array/JSON-hash，关闭trim/rotate。支持reverse、pingpong方向。
4. PNG与JSON放在一起，在「导入逐帧动画」中选JSON。
5. 检查锚点、恢复、帧间跳动与静音闭嘴。只有包里存在的动作才可点击。

idle、talk、sleep默认循环；wave等手势有限播放。动作优先于眨眼/说话，避免相互切换产生跳帧。暂停/系统减少动态效果停在稳定帧。音频采用音量开合；具有明确口型映射的动画按音量选择闭嘴、小口型、大口型，没有映射的旧素材继续使用振幅门控，不宣称音素级口型。

## Demiurge自定义格式

version=1的JSON，image为同目录/子目录PNG相对路径。animation定义逻辑画布、原图帧坐标、毫秒时长和动作序列：

```json
{
  "version": 1,
  "image": "pet.png",
  "animation": {
    "width": 64,
    "height": 96,
    "pixelated": true,
    "frames": [
      { "rect": [0, 0, 64, 96], "duration": 180 },
      { "rect": [64, 0, 64, 96], "duration": 140 }
    ],
    "clips": {
      "idle": { "frames": [0], "loop": true },
      "wave": { "frames": [0, 1, 0], "durations": [200, 400, 200] }
    }
  }
}
```

palette可选1–256个#RRGGBB颜色，不设时保留原画。offset为逻辑像素整体注册偏移，只用于制作测量的对齐。PNG最多8MiB、JSON最多512KiB、最多256原画帧、逻辑画布边长最多2048。拒绝目录逃逸、外部URL、帧越界、无效索引和时长。导入后图集自包含，随角色包导出。

`animation.mouthFrames` 可选，需要同时提供 `clips.talk`。例如完整动画的闭嘴、小口型和大口型分别位于索引 0、4、5 时，可添加 `"mouthFrames": { "closed": 0, "small": 4, "wide": 5 }`。这些索引必须指向实际存在的帧，口型映射会随 Demiurge 动画包与角色包保存；新自动制作结果也提供该映射。此字段属于动画结构验收，修改后需要重新核对。Aseprite 或 PNG 文件夹导入没有该映射时仍按原有 talk 时序播放。

API 图像编辑可以产生候选立绘、表情和姿势帧，本机流程再将它们整理为待核对逐帧动画包；不会输出已绑定 Live2D 或 VRM。自动语义拆层、遮挡补画、拓扑/权重和高流畅度动画仍需专门模型或编辑流程，视觉审查没有自动完成。
