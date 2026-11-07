# Mori v0.2 设计说明

2026-09-29：实际阅读以下公开资料后进行设计与实现。

- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)：有明确方向的字体、色彩、空间和视觉重心。
- [AIRI](https://github.com/moeru-ai/airi)：参考角色陪伴项目对 Live2D、VRM 和语音的能力组织；没有复制其源码或素材。
- [pixi-live2d-display](https://guansss.github.io/pixi-live2d-display/) 与 [完整指南](https://github.com/guansss/pixi-live2d-display/wiki/Complete-Guide)：模型载入、Ticker、表情和动作接口。
- [Cubism SDK for Web](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/)：Core 与 SDK 的关系。
- [three-vrm](https://github.com/pixiv/three-vrm)：VRM 载入、规范化骨骼和表情接口。

界面以角色为视觉主体：窄图标导航、角色列表、大幅舞台、独立聊天栏。昔涟采用粉白纸面、玫瑰粉强调色和淡紫辅助色；中文标题使用系统宋体，正文采用系统中文无衬线与本地 Manrope 可变字体。所有强调色、边框、底色和按钮来自角色主题变量。

主题可由角色档案自动决定（名字/外貌颜色与检索模型的主题建议），也可手动选择粉、紫、蓝、绿、琥珀或自定义强调色。自动配色不宣称已识别所有角色的官方代表色；陌生角色可调整。

内置昔涟图像由开发时的图像工具创作，是二次创作素材，不是官方图像、Live2D 或已核实的原作档案。现有精绘、Q 版、复古像素、8-bit、写实、低多边形、水彩、毛绒和手办九种方向。未绑定的静态图保持静止，动作来自完整姿势帧或模型实际绑定。整体晃动和猜测五官位置的形变不再作为默认动画。

2026-10-01 增加 [多画风素材流程](PET_ART_WORKFLOWS.md)：先确认画风基准，再制作动作与核对。工作台展示各画风造型、材质、画布与动作制作说明，无需生成 Key 导入 PNG 序列、图集、Live2D 或 VRM。程序像素绘图是可选入口。
