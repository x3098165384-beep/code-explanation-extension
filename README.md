# VS Code 行内代码讲解插件

独立的小项目，用于在代码旁顺序阅读讲解，不修改被讲解的源码。

## 已确认的方向

- 在代码行旁显示独立保存的讲解。
- 按顺序浏览，能够阅读实际代码修改及 diff。
- 用自然的逐句翻译说明代码名称、条件和调用的实际含义。
- 独立开发，不以复刻 CodeTour 全部功能为目标。

## 当前状态

2026-10-21 已接通讲解读取、真实 Git diff、代码对应检查、导航、自动更新及进度恢复。JavaScript 支持可确认的空格、Tab 和缩进变化；其他语言与固定 Git 继续严格核对。0.1.2 修复了旧源码变化通知取消新讲解打开的问题。34 项自动检查及真实 VS Code 后台流程已通过，包含未保存内容、格式变化、更新、失效清理、停止和重启恢复。实际范围及截图见[首版验收记录](docs/first-release-acceptance.md)，不扩大为任意系统、主题和语言都已验证。

当前工作依据见[首版规格](.scratch/first-release/spec.md)，文件约定见[Markdown 讲解文件格式](.scratch/first-release/explanation-format.md)，可阅读[完整讲解示例](.scratch/first-release/explanation.example.md)。规格和[8 项首版任务](.scratch/first-release/issues)保存在本地 Markdown 任务记录中。任务 02 至 07 已实现；任务 08 已记录实际安装包的后台流程结果，未单独运行的变体仍明确列出。

## 构建与使用

需要 Node.js、Git 及 VS Code。执行 `npm.cmd install`、`npm.cmd run check`、`npm.cmd run build`；按 F5 可启动扩展开发窗口。执行 `npm.cmd run package` 可生成本地 VSIX，通过 VS Code 的“从 VSIX 安装”手动安装。扩展不会在启动时自动打开讲解。

准备真实演示工程可执行 `node tools/prepare-acceptance.cjs`；已有目录使用 `--reuse` 保留现有修改。打开演示项目后，执行“行内代码讲解：打开讲解”并选择生成的 `.md`。具体操作、外部 agent 生成要求、未保存内容和错误提示见[首版使用说明](docs/first-release-usage.md)，当前人工结果见[26 项验收记录](docs/first-release-acceptance.md)。

Windows 可执行 `npm.cmd run test:background`，在独立窗口环境中验证实际安装包并保存截图，不切换到测试窗口、不操作当前桌面。测试使用独立配置、共享数据和演示工程，结束后只清理本轮进程。运行方法与限制见[后台验收说明](docs/background-verification.md)。

已确认选择的来源见[首版范围确认](docs/plans/first-release-scope.md)。原始目标、技术调查和此前建议见[最终讨论记录](docs/plans/initial-design/discussion-notes.md)。

[工作区交接](docs/handoff/2026-10-21-project-workspace.md) 保留迁移时的状态和后续工作边界；当前会话已在本项目目录继续。项目规则见 [AGENTS.md](AGENTS.md)，任务记录约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。

讨论中的 Vonimir 代码仅为讲解案例和原始需求来源，插件不依赖该 Unity 工程。

## 开源协议

本项目采用 [MIT 协议](LICENSE)，版权署名为 XGH。
