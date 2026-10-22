# 06：调整外部生成检查并一次性转换旧讲解

Status: ready-for-agent

执行情况：未开始。

## 要完成的行为

外部 agent 使用 Teach with Code Explanation skill 生成符合版本 2 约定的 JSON，经同一正式读取和代码对应规则检查后可在插件阅读。将本项目维护的讲解示例及既有 Vonimir 案例一次性转换为新格式，保留原文件和真实引用，不增加插件导入入口。

Blocked by: 02（用 JSON 打开并更新行内讲解）

## 验收要求

- [ ] skill、配套说明、生成或引用工具、检查工具及本次新示例统一使用 JSON 版本 2：标题、简介、稳定标识、代码引用及步骤字段与正式读取端一致。
- [ ] skill 英文标题 Teach with Code Explanation、仅手动调用的既有要求及简短直接的代码翻译标准保留；不恢复 CodeTour 协同或旧 Markdown 生成流程。
- [ ] 默认输出到代码项目约定的讲解目录，使用项目已经设置的其他目录时记录实际位置；不混淆讲解文件位置与源码相对根目录，不额外复制源码。
- [ ] 通过正式 JSON 结构入口及实际代码引用检查验证生成结果，不复制维护第二套解析或摘要规则。外部 agent 只读到磁盘时明确限制，不声称检查了用户未保存内容。
- [ ] 转换前读取实际旧文件并确认结构，写入前检查冲突；保留讲解和步骤标识、顺序、标题、简介、解码后的正文、代码引用名、路径、固定提交及摘要。
- [ ] 对旧、新结果逐项比较，正文只做 JSON 字符串必要转义，不顺手改讲解文风、代码、范围或摘要。旧引用已失效时如实报告，不重算摘要来制造通过。
- [ ] 旧文件保留；不覆盖已存在的不同讲解，不删除首版历史规格与历史验收案例，不为日常阅读保留旧解析能力或增加导入入口。
- [ ] 记录转换前后文件位置、结构检查及逐步代码对应结果；文件位置改变不承诺自动继承旧进度，新 JSON 主动打开后的进度按新流程记录。
- [ ] 实际使用新插件打开转换后的普通步骤与已有 diff 示例，确认正文、目标和复制可用，保存截图及结果；转换后有失效引用的步骤应作为真实失败单列，不扩大成全部通过。
- [ ] 完成适用的 skill 检查及相关已有工具检查。新检查仅比较真实转换数据和正式读取结果，不为旧格式建立长期生产转换服务。

## 具体范围与边界

维护对象为现有 Teach with Code Explanation skill、其生成及检查资源、本项目提供给后续版本的新格式示例，以及既有 12 步 EnemyPreSpawnPresentation 案例。下方源文件链接是一次性转换的输入，不能据此扫描或批量转换其他项目内容。

只处理讲解及工具协同，不改游戏业务源码、`.meta`、Unity 工程配置，不操作 Unity 或用户窗口。不提供插件内转换按钮或导入器；必要的一次性 agent 转换不保留为正常阅读功能。

## 依据与输入

- [父规格：操作 20–22，及外部生成与转换要求](../spec.md)
- [JSON 格式及转换检查清单](../explanation-format.md)
- [Teach with Code Explanation skill](C:/Users/Administrator/codex/mattpocock-skills/skills/productivity/teach-with-code-explanation/SKILL.md)
- [既有 Vonimir 讲解](F:/Sync/svnVO/trunk/Vonimir/docs/explanations/enemy-pre-spawn-presentation.md)
- [共同要求及依赖顺序](README.md)

## Comments

目前仅发布任务；未修改 skill、执行转换或读取原项目的未保存文档。
