# Anime Codex → Mori 本机适配记录

检查日期：2026-11-06。源项目：`$ANIME_CODEX_ROOT`；package 版本 0.18.11，HEAD `de74b2ee2d468f129769618a198ed8b0ab8d244c`。源项目存在未提交改动，因此本记录依据当时磁盘上的文件，不能把 HEAD 单独视作完整复现标识。没有修改源项目。

| 本机来源 | 观察 | Mori 中的处理 |
| --- | --- | --- |
| `electron/character-studio.cjs` | 角色资料 → 档案 → 基准图 → 动作组；基准保持发型、服装与配色；源文件明确写有 Mori-inspired | 保留 Mori 已有的身份原图与画风参考分离、候选审核、修图和断点恢复；将新贴纸规范贯通基准、修图、动作请求，不重复迁移已有机制 |
| `assets/style-studies/furina-official/README.md`、`docs/CHIBI_PETS.md`、`public/characters/furina/sticker/atlas.png` | 已实际查看图集；大块发束、深色线条、平涂与单层阴影，小尺寸轮廓明显；源图存在低 alpha 背景残留 | 新增通用于不同角色的 `sticker` 画风；不复制芙宁娜身份、服装、贴图或官方参考素材。仅贴纸成品清理 alpha < 24 的残留 |
| `electron/pet-artifacts.cjs::packSheet` | 按等分单元补透明边，保存原始文件，避免为尺寸偏差重新生成 | 改写为 Mori 的 2×2 / 4×2 合同；逐像素保留，增加 20% 比例容错边界，先验裁切后补边；最终图集仍保留各组源采样密度 |
| `electron/pet-artifacts.cjs::validateSheet` | 依据可见像素而非只有哈希差异检查动作变化 | 增加预乘 alpha 比较，排除透明 RGB、细微噪点和单像素变化；八帧检查至少六帧有可见差异 |
| `shared/pet-production.cjs`、`docs/AUTOMATIC_PET_PRODUCTION.md` | 日常、娱乐、四向行走、进入/退出活动与社交过渡，共七组 4×4 图集 | 本版未迁移。Mori 当前动作与播放器合同不同，不能只复制动作名称就声称支持这些活动 |
| `electron/character-research.cjs` | 检索证据约束来源，区分原作、自定义设定和未知信息 | 用于对照现有角色研究链路；没有把其依赖 Codex 工具事件的来源校验复制进 Mori 的 HTTP 检索实现 |

## 具体实现

- `shared/art-styles.json`：贴纸画风的形状、材质、画布与动作规范。
- `src/theme.ts`、`src/types.ts`、`electron/store.cjs`、`electron/services.cjs`：选择入口、类型、持久化和真实图像请求。
- `src/animation/framing.ts`：贴纸静态图采用 Q 版的构图参数。
- `src/features/appearance/PetProductionStudio.tsx`、`src/components/ArtWorkflow.tsx`：制作说明、素材工作流，不显示空教程链接。
- `electron/pet-frames.cjs`：尺寸整理、动作可见性检查与贴纸 alpha 清理；源响应的保存机制沿用 `pet-pipeline.cjs`。

没有导入源项目的账号配置、历史、密钥、角色库或运行依赖。适配算法的 MIT 版权与许可全文位于 `docs/THIRD_PARTY.md`，打包脚本将其放入应用的 `licenses/THIRD_PARTY.md`。

## 验证边界

单元/集成测试使用合成 PNG，并检查真实 services 请求结构和 pipeline 的持久化路径；原生测试使用真实 Electron、预加载桥、IPC、PNG codec 和 React UI。它们验证功能，不证明图像模型输出更美观。需要使用用户选定的角色原图进行真实生成和逐帧审核，才能判断画风贴合、身份与动作质量。

## 后续适配：0.3.6

已从生活动作与过渡思路中落地读书和掌机的完整单活动流程。采用 Mori 自己的八帧请求，生成进入、循环、退出三段，支持预览、审核、导出、桌宠播放与停止；没有复制 112 帧合同或源角色素材。参见 [0.3.6 说明](MORI_0_3_6_RELEASE.md)。
