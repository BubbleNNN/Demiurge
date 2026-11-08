# 多画风桌宠制作流程研究

调研时间：2026-10-01。实际阅读下列项目文档、动作定义与官方教程；没有复制第三方角色素材。

| 项目 / 工具                                                                                                                                                                                | 阅读内容与对 Demiurge 的启发                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [VPet](https://github.com/LorisYounger/VPet) / [ModMaker](https://github.com/LorisYounger/VPet.ModMaker)                                                                                   | PNGAnimation、Picture、模组与分层显示；素材包和行为逻辑分离，画风不绑定播放器。原画和代码有不同授权。           |
| [Shimeji-Desktop](https://github.com/DalekCraft2/Shimeji-Desktop/blob/main/README.md) / [actions.xml](https://raw.githubusercontent.com/DalekCraft2/Shimeji-Desktop/main/conf/actions.xml) | 图片集、Pose、ImageAnchor、Duration、动作序列；保留具体姿势、锚点和时序。Demiurge 不执行其 XML，也未直接兼容原包。  |
| [Clover Shimeji](https://github.com/Stuocs/Clover_Shimeji)                                                                                                                                 | 原游戏像素素材、走路、坐下、跳舞、睡眠；像素识别度来自真实素材与角色动作。未复制游戏图片。                      |
| [Open-LLM-VTuber](https://docs.llmvtuber.com/en/docs/user-guide/live2d/)                                                                                                                   | idleMotionGroupName、emotionMap、tapMotions 匹配实际模型名称；对话只调用已有动作与表情。                        |
| [Aseprite](https://www.aseprite.org/docs/animation/) / [图集](https://www.aseprite.org/docs/sprite-sheet/)                                                                                 | 洋葱皮、帧标签、逐帧时长与图集导出；像素保持逻辑网格，播放器保留原画。                                          |
| [Krita 动画](https://docs.krita.org/en/user_manual/animation.html) / [PNG 序列导出](https://docs.krita.org/en/reference_manual/render_animation.html)                                      | 关键姿势、补帧、分镜；手绘、水彩和 Q 版也可以走逐帧路线。                                                       |
| [Live2D 流程](https://docs.live2d.com/en/cubism-editor-manual/workflow/) / [素材分离](https://docs.live2d.com/en/cubism-editor-manual/divide-the-material/)                                | 分层、补画遮挡、建模、参数、动画、导出；单张 PNG 不等于绑定模型。                                               |
| [VRoid 发型编辑](https://vroid.pixiv.help/hc/en-us/sections/900000861886-Hairstyle-Editor) / [YUI](https://github.com/yw0nam/YUI)                                                          | 模型几何和材质；VRM 与独立 VRMA 动作。三维渲染图片与真实模型不同，动作素材单独授权。                            |
| [Ludo Sprite Generator](https://ludo.ai/docs/sprite-generator) / [API & MCP](https://ludo.ai/docs/api-mcp)                                                                                 | 原图动画、首中尾关键帧、动作迁移、画风编辑与动作包对齐；适合后续多画风动画服务。网页功能和 API 字段须分别确认。 |
| [PixelLab 动画](https://www.pixellab.ai/docs/tools/animation) / [API](https://api.pixellab.ai/v2/docs)                                                                                     | 原图条件、重排修正帧、插值、像素角色与异步任务；适合专门像素路线。                                              |

桌宠项目消费已制作的素材；编辑器与生成服务制作素材。以上资料不能证明“角色名字自动变成多种忠实且动作完整的形象”。

## Demiurge 的制作规格

以下是本项目的设计选择，集中在 `shared/art-styles.json`，供界面和图像生成同时使用，不是上述工具强制的标准。

| 画风     | 区分因素                         | 动作路线                     |
| -------- | -------------------------------- | ---------------------------- |
| 精绘     | 精确线稿、赛璐璐明暗、原角色比例 | Live2D 分层或完整姿势 PNG    |
| Q 版     | 2.5–3 头身、短肢、大表情         | Krita 关键姿势与补帧         |
| 复古像素 | 64×96 网格、最多 32 色、像素簇   | Aseprite 帧标签与时序        |
| 8-bit    | 48×64 网格、最多 16 色、粗像素   | 清晰关键姿势、独立眨眼与口型 |
| 写实     | 成人真实比例、皮肤发丝、织物     | 姿势参考或关键帧动画后核对   |
| 低多边形 | 几何折面、块状头发、纯色材质     | 骨骼动画或固定模型渲染       |
| 水彩     | 透明层染、颜料沉积、内部纸纹     | 共同底稿纹理、逐帧活动部位   |
| 毛绒     | 填充轮廓、纤维、接缝、刺绣       | 同一玩偶关键姿势或模型渲染   |
| 手办     | 雕塑发束、微缩细节、树脂         | 关节姿态或模型渲染序列       |

角色原图决定发型、服装、色块与饰物；画风参考决定笔触、比例和材质。当前图像接口传角色原图与可选已确认基准；**独立画风参考图片上传与专用动画 API 尚未实现**。文字规格不能保证生成效果。

采用流程：确认该画风的透明底基准 → 同一基准制作起势、最大姿势和收势 → 补帧或制作模型曲线 → 核对脸、手、衣服、纹理及衔接 → 统一画布和脚底线 → 导入试播 → 保存并映射聊天。

## 本轮实现与边界

- 「画风与素材制作」入口当前有七种规格、教程与可复制的当前角色说明：原作画风、精绘、Q 版、飞天小女警、复古像素、8-bit 和低多边形 3D。上方材质对照表保留调研记录，写实、水彩、毛绒和手办已不作为可选画风。
- 无生成 Key 可导入 PNG 动作文件夹、Aseprite / Demiurge 图集、Live2D 或 VRM，先预览后选择保存或使用。
- PNG 自动合成图集，保留作者像素、透明度和时序，不猜动作或重绘。
- 像素最近邻、其他画风平滑显示；修复 Aseprite 导入把所有风格标成像素的问题。
- 图像生成使用同一份规格；旧素材不自动重生成，生成质量仍需核对。
- 缺少说话帧的图片禁用说话预览。

动作仍为六个通用动作，加眨眼、说话和六种表情。走路、爬墙、投喂、跳舞及完整 VPet / Shimeji 原包兼容未实现。程序像素绘图保留为可选路线，不能通用替代其他画风；两次实际聊天生成的候选仍待形象审阅。

本轮只调研 Ludo / PixelLab，未配置 Key、安装工具或调用其付费生成。后续 API 适配需要独立凭据、持久化任务 ID、明确重试、透明帧下载与逐动作核对。普通聊天服务不能被误认成动画生成服务。
