# 0.2.0 完成、后台验收与实际安装交接

记录时间：2026-10-22 17:32，Asia/Shanghai。项目：`F:/Sync/MyProjects/code-explanation-extension`。

## 当前结果与下一步

本轮 01–07 任务全部完成，正式 0.2.0 安装包已通过独立后台验收。侧栏、最近记录、JSON 阅读、文字复制、正文页、讲解 skill 和旧文件转换的具体要求及证据见下方索引。无需继续执行旧任务，也无需为了接手续跑已通过的整套验收。

最后一次用户反馈为“可以了”，确认补装到 VibeCoding 配置后，当前 VS Code 窗口已能看到侧栏。此前只更新了默认配置，VibeCoding 仍是 0.1.3，故第一次重载没有新侧栏；此安装问题已经解决。用户随后只要求保存本交接文档，没有提出新的功能任务。下一位代理先了解现状，再响应新的请求；当前没有待发布或待推送的授权。

代码分支为 `main`，本轮实施起始提交 `e9f7fac44bc612a83e3eeebf1c15f428640fa8b1`；交接前最后两次提交为 `86e1d47`（最终验收及复用已有代码页）和 `37b5f77`（完成记录）。最终安装包版本、SHA-256、实际检查数量及失败修复过程以验收总表为准。

## 资源索引：按需要顺序阅读

下列项目内路径均相对本项目根目录。

| 顺序 | 资源 | 用途与定位提示 |
| --- | --- | --- |
| 1 | `AGENTS.md`；`docs/agents/issue-tracker.md`、`triage-labels.md`、`domain.md` | 项目规则和本地任务记录约定。普通任务的 `ready-for-agent` 是分诊状态，实际完成看任务中的执行记录和验收框。 |
| 2 | `.scratch/reading-experience/spec.md`、`explanation-format.md` | 0.2.0 的现行要求和 JSON v2 格式。与旧首版冲突的文件格式、打开入口、正文及图片代码框要求已在此替换。 |
| 3 | `.scratch/reading-experience/issues/README.md`及同目录 01–07 任务 | 已完成范围、依赖和逐项结果。07 是最终安装包验收，不要把早期分阶段包的通过记录混入最终结果。 |
| 4 | `.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/acceptance.md` | 全部 22 项操作、实际环境限制、原失败与续跑经过。该目录的 `results.json`、`suite.json`、`copy-results.json`、`isolation.json`、`source-baseline.json` 是核对入口，PNG 是真实后台截图。 |
| 5 | `docs/first-release-usage.md`、`docs/background-verification.md` | 当前使用方法和隔离验证入口。后者保留旧版本记录，注意版本及包摘要。 |
| 6 | `GLOSSARY.md`、`docs/adr/0001-json-explanation-files.md` | 已确认名称和 JSON 决定。需要追溯选择时再读 `docs/plans/initial-design/discussion-notes.md` 的 2026-10-22 部分。 |
| 7 | `.scratch/first-release/spec.md`、`explanation-format.md` | 本轮仍须保持的源码检查、Git、diff、未保存内容及取消规则；旧 Markdown 不再是生产阅读格式。 |
| 8 | `.scratch/reading-experience/evidence/06-generation-and-conversion-2026-10-22/README.md` | skill、示例及实际旧讲解转换的比较、提交和限制。原价格示例缺失 Git 对象的事实仍保留。 |
| 9 | `src/reader.ts`、`sidebar.ts`、`presentation.ts`、`body-view.ts` | 需要修改实现时再读：阅读流程管理活动讲解；侧栏管理列表和文件订阅；显示与正文页跟随阅读流程。先追实际调用和资源释放，不复制一套当前步骤状态。 |
| 10 | `tools/verify-background.ps1`、`test/integration/` | 后续改动涉及界面或复制时复用现有验证。默认不依赖 Vonimir；实际外部案例通过明确参数加入。运行目录及完整日志位于被忽略的 `.scratch/first-release/runtime/background/`。 |

安装包为 `F:/Sync/MyProjects/code-explanation-extension/code-explanation-extension-0.2.0.vsix`，未提交到 Git。不要因包被忽略而重新构建；先按验收总表核对摘要。改了打包内容后则应重新打包并复验受影响项目，不能继续沿用旧摘要。

## 实际安装与环境

VS Code 命令入口为 `C:/Users/Administrator/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd`。默认配置和 **VibeCoding** 已确认安装 `xgh.code-explanation-extension@0.2.0`；用户已手动重载并确认正常。

Vonimir 项目关联的配置 ID 是 `-4c952f2`，名称 VibeCoding。配置映射在 `%APPDATA%/Code/User/globalStorage/storage.json`，扩展记录在 `%APPDATA%/Code/User/profiles/-4c952f2/extensions.json`。后续用户报告“安装成功但仍是旧版”时，先核对项目实际配置，再用 VS Code CLI 的 `--profile VibeCoding --list-extensions --show-versions` 检查。只有默认配置的列表不足以证明当前窗口更新成功。

本次补装使用 CLI 的 `--profile VibeCoding --install-extension <上述 VSIX> --force`，没有操作或切换窗口。VibeOffice 是另一个独立配置，本轮没有补装；除非后续请求涉及它，不要顺带更改。

## 其他仓库与已生成文件

- skill 源码仓库：`C:/Users/Administrator/codex/mattpocock-skills`，本轮提交 `ad52e07`。当前技能为 `skills/productivity/teach-with-code-explanation/SKILL.md`，英文标题 **Teach with Code Explanation**；新的生成与检查使用 JSON v2。旧 CodeTour 名称曾用于发起任务，不应把旧插件协同重新加回去。
- 已转换实际讲解：`F:/Sync/svnVO/trunk/Vonimir/.code-explanations/enemy-pre-spawn-presentation.json`；原文件 `docs/explanations/enemy-pre-spawn-presentation.md` 保留。转换提交为 `30ac5390e`，详细比较见任务 06，不重新计算旧摘要来掩盖代码变化。
- Vonimir 是案例来源而非插件依赖。外部仓库已有后续用户提交，本次读取到 HEAD 为 `7dc7d0037`；不要把该仓库退回转换提交，也不要处理用户的业务脚本改动。

## 后续执行时必须保留的限制与经验

**已验证的做法：**后台验证使用非交互 Windows 窗口站、每轮独立桌面、配置、扩展目录和案例。仅独立桌面不能隔离剪贴板。当前使用的 `Service-0x0-54064$` 是系统提供的共享非交互窗口站，不能称为本轮独占；涉及 GUI 和剪贴板的组须串行。所有本轮后台实例已退出。

用户明确要求不抢电脑控制权、不切换窗口；需要操作用户窗口时先申请。安装授权不等于鼠标、键盘或重载窗口授权。后续验证继续使用隔离实例，不访问用户 `WinSta0` 剪贴板，不读取原项目窗口中的未保存缓冲区。

**保存与恢复验证：**进度跨进程要使用普通 VS Code 实例及真实磁盘记录。扩展测试模式会使用内存存储；关闭遥测时 `vscode.env.sessionId` 也可能固定。使用实际进程、独立桌面及同一配置的记录证明重启，见最近记录组证据。

**显示与复制证据：**截图不证明复制；必须实际拖选、Ctrl+C、读取隔离剪贴板并逐字比较，整块复制另行检查。最后布局补验确认了 1000 像素宽窗口中实际左右并排；初始图受 VS Code 自动转单列设置影响，不能拿旧图证明双列。复制前等待正文和布局稳定，并确认实际选区，避免把未选中文字误判为产品复制失败。详细失败和修复已在 07 记录，不重复制造验证工具。

**代码与文案：**讲解采用短代码块后接清楚、直接的中文翻译，按对象、条件、动作和结果说明，不逐字解释语法，也不先用长例子替代代码说明。实现细节和例子以现行 skill、格式及案例为准。有效步骤继续在真实代码或 diff 旁显示，正文页是辅助入口。

**仍有边界：**验收只证明所记录的 VS Code 版本、主题、尺寸和操作；外部链接启动浏览器、Windows 原生文件对话框外观没有单独验证。遗留价格例子的第 2–5 步缺少原 Git 对象，不能改记通过；其他新案例的真实 diff 通过不替代它。

## 工作区未提交内容

创建本文前，仅有既存的 `.scratch/first-release/verification/evidence/latest.json` 修改及同目录 10 份 `179256…` 事件 JSON 未跟踪；它们未混入本轮提交。后续执行 `git status` 核对现状，保留这些无关记录。本交接文档是本次新增文件。

## 建议使用的技能（suggested skills）

按新的请求选用并读取相应 Skill 工具或 `SKILL.md`，不要为接手而启动全部流程：

- `mattpocock-skills:diagnosing-bugs`：用户报告显示、安装、复制或恢复异常时，先核对用户实际配置与失败证据。
- `mattpocock-skills:implement`：已有明确规格或任务、且用户授权继续实现时使用。
- `mattpocock-skills:grill-with-docs`：需要确认新的产品行为时使用；先沿用现有讨论，不重复询问已确认选择。
- `mattpocock-skills:to-spec`、`mattpocock-skills:to-tickets`：将新确认内容整理成规格或任务时使用。
- `mattpocock-skills:teach-with-code-explanation`：生成新的项目代码讲解时，读取上述 skill 源码仓库的当前技能；不要沿用旧 CodeTour 文件格式。
- `mattpocock-skills:writing-for-agents`：确需调整 skill 或代理规则时使用。
