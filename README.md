# VS Code 行内代码讲解插件

在代码旁按步骤阅读讲解和真实 diff，不修改被讲解的源码。正文用简短中文说明代码中的对象、条件、调用和结果。

## 0.2.0

本轮按[讲解侧栏、JSON 文件与行内复制规格](.scratch/reading-experience/spec.md)实施。任务进展和实际证据见[任务列表](.scratch/reading-experience/issues/README.md)，最终安装包结果见[后台验收说明](docs/background-verification.md)。旧版本记录保留在[首版验收](docs/first-release-acceptance.md)，不作为本轮新功能已通过的依据。

- 左侧活动栏提供项目讲解、继续上次和最近打开入口；展开查看步骤，点击标题恢复或点击步骤直接跳转。
- 一份版本 2 JSON 保存标题、Markdown 正文及代码引用，默认放在项目的 `.code-explanations/`，可配置目录或手动选择其他位置。
- 普通代码和真实 diff 旁显示当前步骤。代码为真实文字，可拖选复制，也可整块复制；“查看正文”提供完整排版阅读页。
- 保存讲解后按稳定标识保持步骤；错误保存使用明确标注的上次成功内容。启动和列表更新不自动开始阅读。
- 代码对应检查使用编辑器当前内容和固定 Git 版本，包括未保存修改；JavaScript 仅放宽可以确认的符号间空格、Tab 和缩进变化。

新文件约定见 [JSON 格式](.scratch/reading-experience/explanation-format.md)及[完整示例](.scratch/reading-experience/explanation.example.json)。旧 Markdown 由外部 agent 一次性转换，原文件保留；插件不提供旧格式阅读、导入或 CodeTour 兼容。

## 构建与使用

需要 Node.js、Git 及 VS Code。执行 `npm.cmd install`、`npm.cmd test`、`npm.cmd run check`、`npm.cmd run package`，生成本地 VSIX。在你使用的 VS Code 中手动“从 VSIX 安装”并按提示重新加载；后台测试配置不会更新当前窗口。

打开代码所属项目，点击左侧“行内代码讲解”图标；也可执行“行内代码讲解：打开讲解”选择 JSON。安装、生成、复制、更新与独立演示方法见[使用说明](docs/first-release-usage.md)。插件不调用模型，讲解由 **Teach with Code Explanation** skill 或其他外部工具准备。

Windows 可执行 `npm.cmd run test:background`，对实际安装包做独立后台验收并保存截图。使用独立配置、扩展目录和案例工程；复制检查使用用户桌面以外的剪贴板。测试不切换或操作当前窗口，只清理本轮进程。结果、方法和限制见[后台验收说明](docs/background-verification.md)。

已确认选择来源见[首版范围](docs/plans/first-release-scope.md)及[讨论记录](docs/plans/initial-design/discussion-notes.md)。[工作区交接](docs/handoff/2026-10-21-project-workspace.md)保留迁移时的状态。项目规则见 [AGENTS.md](AGENTS.md)，任务记录约定见 [issue-tracker.md](docs/agents/issue-tracker.md)。Vonimir 仅是案例来源，插件不依赖 Unity 工程。

## 开源协议

采用 [MIT 协议](LICENSE)，版权署名 XGH。
