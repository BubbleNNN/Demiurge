# 对话供应商与角色资料（0.1.5）

在「连接与设置」选择阿里云、DeepSeek、豆包、MiniMax、GLM、Anthropic 或本机 Codex。填写对应账号的 Key 与已开通模型 ID。切换供应商不会自动更换已有 Key 或模型，请同时核对。豆包可填写控制台提供的模型或 Endpoint ID。

服务地址支持两种方式：Base URL 由应用追加接口路径；完整请求地址原样使用。页面显示最终请求地址。地区、工作空间和 Coding Plan 可能使用不同地址，以账号控制台为准。MiniMax 预设为国际站，中国站需修改地址与 Key。JSON 模式不受支持时可选择提示词约束 JSON；不会自动额外重试计费请求。关闭思考的扩展参数只发送给千问，避免影响其他兼容服务。

## 角色资料与记忆

重新收集资料后，资料册支持个人信息、人物关系、经历事件、性格表现及说话特点。每条带来源、待核对或手工设定标记，以及剧透标记。模型只能引用本轮实际取得的来源链接；有来源不代表事实已经核验。缺失资料保留空白，原有角色不会自动虚构补齐。更新时保留手工修改的资料项。

对话按话题选择资料，默认排除剧透，并区分原作关系与用户。记忆分为偏好、共同经历、约定及相处边界；只使用当前角色的记忆。自动摘录保留用户原话，并排除敏感信息；共同完成的小游戏和活动可在本机记录，设置中可关闭。记忆可编辑和删除。提示词约束能够改善一致性，不能保证模型绝不偏离角色。

## 修复与验证

“请求内容无效或过大”的根因之一是聊天将角色候选参考图一并传入进程间请求，触发 2 MB 限制，并非模型拒绝。聊天现在只传角色与消息编号，由后台读取已保存资料，图片不进入对话请求。

验证包括 473 项自动测试、类型检查、构建，以及不可见窗口中的聊天取消、重试、写盘失败恢复和多窗口回归。含约 5.4 MB 参考图的角色，发送的模型请求约 8.5 KB。阿里云当前配置已真实返回 HTTP 200；DeepSeek、豆包、MiniMax、GLM 已验证请求构造与预设，尚未使用各家真实 Key 联测。

## 官方接口文档

- [DeepSeek](https://api-docs.deepseek.com/en/)
- [豆包 / 火山方舟](https://docs.volcengine.com/docs/ark/chat-api?lang=zh)
- [MiniMax](https://platform.minimax.io/docs/api-reference/text-openai-api)
- [GLM / 智谱](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)
- [千问](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)
