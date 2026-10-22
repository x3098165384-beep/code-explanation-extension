# 新讲解使用 JSON，步骤正文保留 Markdown

2026-10-22，请求者确认不需要脱离插件阅读讲解，选择新讲解在一个 JSON 文件中保存标题、步骤和代码定位，步骤正文继续使用 Markdown，由外部 agent 生成和更新。相较于现有 Markdown 文件中嵌入定位备注的方式，新格式将讲解结构直接写为 JSON 字段；代价是需要调整插件读取、正文回看以及外部 agent 的生成和检查工具。

请求者随后选择统一使用 JSON：已有 Markdown 讲解由 agent 一次性转换，插件不提供旧格式导入入口，后续阅读不再读取旧格式。默认目录为项目根目录下的 `.code-explanations/`，允许在项目设置中更换，并保留选择其他位置文件的入口；不因迁移删除原文件。

0.2.0 按本决定实现新格式；0.1.3 的文件约定保留作历史记录。代码图片无法拖选的问题另由真实文字显示解决，实施及验证见[本轮任务](../../.scratch/reading-experience/issues/README.md)，不能仅凭格式迁移声称复制通过。

完整行为见[后续规格](../../.scratch/reading-experience/spec.md)，具体字段见[JSON 格式约定](../../.scratch/reading-experience/explanation-format.md)。请求者已允许为行内阅读和文字复制适度简化代码框外观；本决定不再以保留矢量图外观作为新版本的前提。
