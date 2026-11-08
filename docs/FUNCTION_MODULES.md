# Demiurge 功能模块与逐块调试

左侧入口按主要功能分成七块。所有页面使用同一个角色选择与本地工作区；切换页面只改变当前视图，不保存配置、不请求模型。主页保留人物下方的简洁输入；完整聊天有自己的页面。

## 模块边界

| 模块         | 左侧入口 | 负责的内容                                                                      | 主要代码与依赖                                                                                                                             |
| ------------ | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `companion`  | 人物陪伴 | 人物比例与舞台布局、当前回复气泡、直接触摸、折叠人物设置                        | `src/features/companion/CompanionScene.tsx`、`src/companion.ts`、`AvatarStage.tsx`                                                         |
| `chat`       | 对话语音 | 输入、完整记录、复制/搜索/导出、角色语气、取消/重试、朗读与口型                 | `src/features/conversation/ConversationPanel.tsx`、`src/conversation.ts`、`electron/persona.cjs`、`electron/services.cjs`                  |
| `characters` | 角色资料 | 新增角色、档案、出处、台词、参考原图、资料补充与语气编辑                        | `src/characterCreation.ts`、`CharacterSetup.tsx`、`ReferencePanel.tsx`、`PersonaEditor.tsx`、`PersonaPreview.tsx`、`electron/research.cjs` |
| `appearance` | 外观动作 | 外观选择、原图生成候选、审核、动画/Live2D/VRM导入、动作预览、3D制作、角色包素材 | `GenerationStudio.tsx`、`ArtWorkflow.tsx`、`ModelStudio.tsx`、`CharacterPacks.tsx`、`src/animation/`、`src/artwork.ts`                     |
| `memories`   | 相处记忆 | 搜索、新增、编辑、置顶、排除、删除、对话上下文中的记忆选择                      | `src/App.tsx` 的记忆页面、`electron/persona.cjs`、`electron/store.cjs`                                                                     |
| `desktop`    | 桌宠窗口 | 透明置顶窗口的打开/收起、拖拽、穿透、桌宠聊天、主窗口同步                       | `src/features/desktop/DesktopPage.tsx`、`src/App.tsx` 的桌宠视图、`electron/main.cjs`、`electron/preload.cjs`                              |
| `settings`   | 连接设置 | 对话/搜索/图像/3D/TTS连接、密钥、播放与主动陪伴偏好                             | `SettingsPanel.tsx`、`electron/services.cjs`、`electron/store.cjs`                                                                         |

表中的组件文件除 `src/features/` 外都位于 `src/components/`。这是页面和组件的功能分区：`App.tsx` 仍协调共享角色、动作、对话请求与保存状态。此次没有为每页建立重复数据仓库，也没有完成所有业务状态的物理拆分。导航和启动器共同使用 `shared/features.json`。

## 单模块开发入口

```sh
pnpm desktop --module companion
pnpm desktop --module chat
pnpm desktop --module characters
pnpm desktop --module appearance
pnpm desktop --module memories
pnpm desktop --module desktop
pnpm desktop --module settings
```

命令启动真实 Electron 开发版并直接进入指定页面；其他入口仍能使用，便于复查共享行为。每次运行一个开发实例。默认 `pnpm desktop` 打开人物陪伴；桌宠页不会自动打开透明窗口，需要点击「打开桌宠」。启动参数不写入工作区，下次普通启动仍进入人物陪伴。

默认复用 `.local/development-v2`。回归脚本使用各自的隔离目录。需要手动隔离时可用 `MORI_DATA_DIR=/absolute/path pnpm desktop --module chat`。

## 当前调试顺序

当前集中调试 **外观动作 → 自动 2D 桌宠制作**：原图、多画风角色图、姿势帧、动画图集、核对与桌宠播放。人物陪伴布局已完成前一轮调整；此轮只验证自动产物在陪伴页和透明窗口中的运行，不同时改动聊天、记忆与资料工作流。

每轮记录：模块、复现步骤、期望行为、实际行为、修改范围、验收结果。涉及共享接口时写明被影响的相邻模块，并只补对应回归。

| 模块     | 核心验收项                                                                                                      | 相关验证                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 人物陪伴 | 900/1100/1400px可读；无快捷互动工具条；头部/身体直接点击、冷却、休息/唤醒；气泡不遮住输入；默认折叠             | `scripts/test-companion-layout-desktop.cjs`、`scripts/test-companion-desktop.cjs`                                       |
| 对话语音 | 主页/完整页草稿连续；输入法与发送；角色语气和素材动作限制；取消/新话题；失败只重试保存；查找导出；TTS错误与停止 | `scripts/test-chat-desktop.cjs`、`tests/persona.test.cjs`、`tests/services.test.cjs`；真实模型语气和TTS须另外明确测试   |
| 角色资料 | 名字/作品匹配；来源与私设分开；参考图核对；保存失败留草稿；刷新资料保留语气与主题                               | `scripts/test-character-creation-desktop.cjs`、`scripts/test-research-desktop.cjs`、相关 `tests/`                       |
| 外观动作 | 不同画风的比例/材质；不冒充不存在的动作；导入/暂停/减少动态；原图到候选到审核                                   | `scripts/test-motion-desktop.cjs`、`scripts/test-model-motion-desktop.cjs`、`scripts/test-generation-batch-desktop.cjs` |
| 相处记忆 | 角色隔离；搜索/编辑/置顶/排除；与模型上下文一致；并发编辑与删除恢复                                             | `scripts/test-chat-desktop.cjs`、`tests/persona.test.cjs`                                                               |
| 桌宠窗口 | 打开/收起；拖拽/穿透；主窗口状态同步；另一窗口等待时不重复提交                                                  | `scripts/test-companion-layout-desktop.cjs`、`scripts/test-chat-desktop.cjs`                                            |
| 连接设置 | 默认收起；折叠留草稿；保存/协议/完整URL；错误脱敏；测试按钮只测试对应服务                                       | `tests/services.test.cjs`、`tests/store.test.cjs`                                                                       |

通用检查：`pnpm check` 与 `pnpm build`。原生脚本通过 `env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/<脚本名>.cjs` 运行，需要桌面环境；部分模型验证需要已准备的本地样例。模拟运输与界面回归不能证明真实服务的画质、语气或音质。

## 本轮变更

本轮外观模块新增 `src/features/appearance/PetProductionStudio.tsx`、`electron/pet-pipeline.cjs`、`electron/pet-frames.cjs` 与 `shared/pet-motions.json`，接入真实图像编辑桥和现有桌宠播放。针对阶段恢复、透明素材、人工核对、导出和实际窗口运行，新增 `tests/pet-pipeline.test.cjs` 与 `scripts/test-pet-production-desktop.cjs`。详细验收边界见 [自动制作 2D 桌宠](AUTOMATIC_PET_PRODUCTION.md)。

前一轮人物陪伴和模块划分：

- 删除人物下方「摸摸头／戳一戳／陪我专心／休息」工具条；保留人物本身的头部/身体点击。
- 休息/唤醒归入默认折叠的人物设置。
- 增加七个有文字的功能入口、独立完整对话页和桌宠窗口页。
- 人物舞台、对话呈现和功能导航拆成独立组件；紧凑输入、完整对话和桌宠聊天复用同一对话组件。
- 模块切换复用原有草稿与本地数据；没有额外模型请求，也没有重新制作角色素材。
