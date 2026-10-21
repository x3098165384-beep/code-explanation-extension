# VS Code 行内代码讲解插件

独立的小项目，用于在代码旁顺序阅读讲解，不修改被讲解的源码。

## 已确认的方向

- 在代码行旁显示独立保存的讲解。
- 按顺序浏览，能够阅读实际代码修改及 diff。
- 用自然的逐句翻译说明代码名称、条件和调用的实际含义。
- 独立开发，不以复刻 CodeTour 全部功能为目标。

## 当前状态

2026-10-21 已建立项目目录、迁入讨论记录、配置项目规则和本地 Markdown 任务记录，并在项目内初始化 Git。首版范围、讲解文件格式和具体显示方式尚未确定；尚未创建扩展代码或安装依赖。

先阅读[最终讨论记录](docs/plans/initial-design/discussion-notes.md)。已确认目标、保留建议、技术依据及未验证项均在其中，下一步可据此整理最小版本规格。

[工作区交接](docs/handoff/2026-10-21-project-workspace.md) 保留迁移时的状态和后续工作边界；当前会话已在本项目目录继续。项目规则见 [AGENTS.md](AGENTS.md)，任务记录约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。

讨论中的 Vonimir 代码仅为讲解案例和原始需求来源，插件不依赖该 Unity 工程。

## 开源协议

本项目采用 [MIT 协议](LICENSE)，版权署名为 XGH。
