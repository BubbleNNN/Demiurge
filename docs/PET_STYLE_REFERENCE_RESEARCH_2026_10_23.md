# Mori 画风参考与候选差异调研

调研日期：2026-10-23。先复查项目已有的角色制作调研，再读取下列上游文档与源码。结论是分别声明参考图用途、在母图阶段探索设计、选定母图后保持动作外观一致。以下为实现依据与边界，不代表真实生成画质已经通过验收。

## 三个上游实现

| 上游与一手链接 | 已核实的实现 | Mori 可借鉴的方式与授权 |
| --- | --- | --- |
| Diffusers：[IP-Adapter 文档源码](https://github.com/huggingface/diffusers/blob/main/docs/source/en/using-diffusers/ip_adapter.md) | 多 adapter 示例分别输入人物脸图与画风图；InstantStyle 示例只在选定层注入画风，减少对参考图内容与构图的过度跟随。 | 分开身份与画风用途。代码及文档为 [Apache-2.0](https://github.com/huggingface/diffusers/blob/main/LICENSE)，模型权重与示例图片的授权需分别核对。Mori 不因此具备 adapter 控制能力。 |
| ComfyUI IPAdapter Plus：[`IPAdapterStyleComposition`](https://github.com/cubiq/ComfyUI_IPAdapter_plus/blob/main/IPAdapterPlus.py#L802) | 节点分别接收 `image_style`、`image_composition` 与各自权重。 | 借鉴具名参考用途和明确参数边界；构图参考不等同角色身份。仓库为 [GPL-3.0](https://github.com/cubiq/ComfyUI_IPAdapter_plus/blob/main/LICENSE)，此次未复制代码。 |
| sprite-gen：[idle-anchor ownership](https://github.com/aldegad/sprite-gen/blob/main/docs/architecture.md#5-idle-anchor-architecture-identity-ownership) | 原始角色与宽泛风格参考用于建立母图；接受 anchor 后，后续动作使用被接受的实例，避免反复重做角色设计。 | 借鉴“先选定外观，再制作动作”。仓库为 [Apache-2.0](https://github.com/aldegad/sprite-gen/blob/main/LICENSE)。Mori 的动作输入保留原始身份参考，与其完全移除原始参考的策略不同。 |

## Mori 的输入与实现边界

- **必须提供原始角色身份参考图。**画风图或文字描述不能替代角色图。身份图负责脸、发型或花纹、服装与标志性配件；可选画风图补充线条、上色、材质和细节密度，并明确不迁移其人物、服装与背景。
- 当前实现路线是**多图请求与提示词中的参考角色声明**。不是 IP-Adapter 权重控制、注意力层注入或身份与风格的硬分离；不能把提示词约束宣传为模型效果保证，也不应提供后端实际不支持的权重滑块。
- 画风图仅附加到候选母图生成及母图修正请求。动作制作使用选定并修正后的母图，加原始角色身份参考，不再附加画风图。选定母图承载已经融合好的美术外观。
- 任务需保存各类参考的用途、冻结文件及指纹、候选说明和最终母图版本。恢复任务应使用保存时的输入；界面上接受的母图必须与动作请求实际发送的母图一致。

## 有意义的候选差异

Mori 0.3.4 已将候选设计方向落实为共享配置中的三个方案：**均衡表现**（平衡小尺寸清晰度与服装细节）、**鲜明轮廓**（通过站姿、四肢间隙及清楚的大色块提高辨识度）、**柔和神态**（通过放松的眉眼和自然站姿体现温和感）。这些方向保持相同身份特征与所选画风，只调整允许变化的少量维度。画风参考不能被候选方向悄悄覆盖，标志性特征也不能作为随机变量。

`candidateVariation` 区分沿用旧行为的 `subtle` 与探索方向的 `explore`。新版界面的多候选请求默认探索不同方向，单候选与直接使用原始参考的路径保守处理。选择原画媒介时，方向使用专门的保守提示词，保持原有画法、比例、线条、配色及细节密度，通过轻微表情和自然站姿变化体现区别。

该候选系统是 Mori 基于调研独立实现的功能，不是上游已有相同系统的声明。请求中的方向与提示词差异可以被自动测试；**不保证实际结果具有足够多样性或更高画质**。生成结果是否真正多样、身份是否稳定、桌面缩小后是否清楚，仍需实际看图判断。

验收至少覆盖：两类图片真实进入正确请求；缺少身份图仍拒绝制作；无画风图兼容旧流程；候选说明确实不同；重启恢复沿用冻结参考；动作使用修正后母图与身份图且不携带画风图。此次调研未复制上游代码、美术资源或模型权重，未调用付费生成服务。
