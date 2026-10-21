# 项目规则

本项目独立开发 VS Code 行内代码讲解插件，目标是在不修改源码的前提下，按顺序阅读代码旁的讲解及实际 diff。

确认产品范围或准备实现前，阅读 `docs/plans/initial-design/discussion-notes.md`，区分已确认的决定、建议和未验证事项。Vonimir 仅是案例来源，不是本项目的依赖。

面向请求者的说明和新增文案使用清楚、直接的语言，说明实际对象、动作、原因和结果。

## Agent skills

### Issue tracker

规格和任务保存在本项目的 `.scratch/` 中；创建、读取或更新任务前，阅读 `docs/agents/issue-tracker.md`。

### Triage labels

任务使用五个默认状态；评估任务或更新其状态前，阅读 `docs/agents/triage-labels.md`。

### Domain docs

术语表使用根目录 `GLOSSARY.md`，架构决定使用 `docs/adr/`；探索代码或提出设计前，阅读 `docs/agents/domain.md`。
