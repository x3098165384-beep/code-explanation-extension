# 0.2.0 完整后台验收

2026-10-22，VS Code 1.142.0。全部 22 项操作已在独立后台实例完成。本轮有 111 项不同检查通过，包含重启及续跑的 126 次通过记录；另有 41 次真实剪贴板比较通过。类型检查、构建及 46 项已有检查通过。

安装包：`code-explanation-extension-0.2.0.vsix`，SHA-256：`0C304332AA3B9A71403A913412A2E59FC3CF8D7B979E5FB0E273690A83E45AFA`。全部正式通过组都来自此包，未混入先前安装包的运行结果。实施起点为 `d2c465faaddae235028642d0bf24fdec707aa9da`。

## 22 项操作

| 编号 | 实际结果 | 主要结果文件与截图 |
| --- | --- | --- |
| 1 | 通过：图标打开侧栏，启动不阅读源码 | sidebar-results.json；sidebar-expanded.png |
| 2 | 通过：子目录与同名标题分别列出位置 | sidebar-results.json；sidebar-expanded.png |
| 3 | 通过：目录设置及新增、修改、删除自动刷新 | sidebar-results.json |
| 4 | 通过：不存在目录、无效 JSON、无法作为目录读取的位置给出具体原因 | sidebar-results.json；sidebar-directory-unreadable.png |
| 5 | 通过：展开只列步骤，点击步骤才阅读 | sidebar-results.json |
| 6 | 通过：侧栏、上下步、实际定位及唯一正文一致 | sidebar-results.json；core-results.json |
| 7 | 通过：标题、继续、最近记录恢复正确步骤 | recent-results.json；recent-restored.png |
| 8 | 通过：同一配置的五个普通进程真实恢复，启动不自动阅读 | recent-processes.json；recent-results.json |
| 9 | 通过：目录外文件与多项目分别保存历史 | recent-results.json；recent-multiple-projects.png |
| 10 | 通过：取消、坏文件、缺失目标保留有效阅读和记录 | recent-results.json |
| 11 | 通过：其他文件只刷新列表，当前正文更新并按步骤标识保持 | sidebar-results.json；json-results.json；core-results.json |
| 12 | 通过：半份、重复字段和未知版本保留成功内容，修复恢复，继续检查源码 | core-results.json；json-results.json；body-stale.png |
| 13 | 通过：普通代码部分字符与跨行拖选后 Ctrl+C，原文一致 | json-copy-results.json；layout-copy-results.json；json-selected.png |
| 14 | 通过：删除行、新增行、双侧目标位于正确 diff 侧且复制正确 | json-copy-results.json；conversion-results.json；json-diff.png |
| 15 | 通过：Tab、空行、中文、引号、反斜杠和长行整块保真 | json-copy-results.json；body-copy-results.json |
| 16 | 通过：深色、浅色及窄 diff 是可选择文字，边线区分代码和翻译 | layout-copy-results.json；layout-dark.png；layout-light.png；layout-narrow-diff.png |
| 17 | 通过：完整排版正文定位当前步骤，普通复制及整块复制有效 | body-results.json；body-copy-results.json；body-overview.png |
| 18 | 通过：目标失效清除行内位置，文件不可读明确标记上次成功内容 | core-results.json；body-results.json；body-stale.png；body-invalid-source.png |
| 19 | 通过：切步、更新、替换、关闭及停止不恢复旧显示或旧复制；迟到顺序由已有可控检查补足 | body-results.json；json-results.json；46 项已有检查 |
| 20 | 通过：真实转换后的 12 步逐标识定位，旧文件保留，原引用输入未改写 | conversion-results.json；conversion-begin-step.png |
| 21 | 通过：旧 Markdown 明确拒绝，不进入旧格式流程 | json-results.json |
| 22 | 通过：独立配置、案例、桌面及剪贴板；源码磁盘、索引及原输入对照 | isolation.json；source-baseline.json；conversion-results.json |

目录读取失败使用“设置指向普通文件”实际触发；没有声称测试了所有 Windows ACL 或网络目录故障。窄布局为 1000×900，主题为 Default Dark Modern 与 Default Light Modern，不能据此宣称所有主题和屏幕均通过。

## 结果和边界

- `results.json` 是总表，`suite.json` 明确列出每组实际运行目录和同一包摘要。各 `*-results.json` 保留完整实际检查。
- `copy-results.json` 保留选择文字、期望原文、扩展读回值及原生 CF_UNICODETEXT。普通复制来自真实鼠标拖选和 Ctrl+C；整块复制来自点击正式显示的入口。没有用脚本选中文字或直接把预期代码写入剪贴板代替复制。截图只证明显示。
- `isolation.json` 记录实际进程、独立桌面及前后输入桌面。剪贴板属于 `Service-0x0-54064$` Window Station；该站是系统生成的共享非交互站，不能称为本轮随机独占。每轮桌面、配置、扩展与案例独立；各组串行，没有向用户桌面发送输入、切换或激活用户窗口，也没有访问用户 WinSta0 剪贴板。
- `source-baseline.json` 再次比较各组源码磁盘摘要及 Git 索引。核心组为检查失效而在隔离案例中主动创建一个空提交；最近记录组主动生成自己的讲解文件。这些是验证准备，不是插件保存源码或切换用户 Git 状态。其他项目的空文件和重命名也仅发生在独立案例中。
- `conversion-results.json` 记录真实 JSON 与其引用的 C# 磁盘文件前后摘要。只将已保存输入复制到独立工程，不读取游戏窗口中的未保存内容。原 Markdown 保留；转换比较的原始记录仍见任务 06。
- 旧价格样例的固定 Git 对象在实际来源项目中缺失，未伪造提交或重新计算引用来声称恢复；真实 diff 使用本轮工具创建的真实提交。本轮真实 12 步游戏案例都是普通文件步骤，已另外完成新增行、删除行及双侧 diff 验证。

## 失败与续跑

`failures/` 原样保留此前三次失败：旧包中源码失效后恢复时，正文所在列又打开同一个 diff；新包中一个旧断言仍依赖 activeTextEditor；侧栏检查结束时 Windows 删除测试目录返回 ENOTEMPTY。窄布局补验时，另有一次正文尚在刷新导致实际拖选未保留的失败，保存为 `layout-before-stable-selection`；等待正文和滚动位置稳定后，实际选择文字、普通复制与原生读回均重新通过。

第一项修复为按 VS Code 已有文件/diff 资源查找其所在列，复用代码页，不另存阅读位置或列副本。第二项改查实际 Webview。第三项对本轮创建且确认位于隔离目录内的清理使用 Node 原生短重试。后两项仅修改测试，未改变正式包。

核心第一进程及第一次重启的通过项保留；从失败的 project 阶段使用全新 other-fixture-retry 续跑，见 `core-resume.json`，没有删除旧失败目录。侧栏重新使用新的独立案例。总套件按每组明确结果出口继续，核对配置、目录及当前包摘要后才复用通过结果。原失败不会计入通过数量。核心原始结果中保留的历史 error 与失败 case 属于此前尝试，最终同名检查已有后续通过记录。

初始命令为 `npm run test:background -- -ExplanationPath <真实JSON> -ExplanationProject <真实项目>`；出现上述适配失败后，以 `-ResumeRunRoot/-FromPhase` 和 `-ResumeSuiteRoot` 继续同一安装包。不是声称首轮没有失败。最终默认完整分组均已操作通过；未来无参数命令运行独立核心、JSON复制、正文、侧栏和最近记录，只有显式传入两个案例参数时才追加真实转换案例，不依赖 Vonimir。

`launcher-rejected-package.txt` 记录不同包摘要的恢复请求在启动 VS Code 前被实际拒绝。所有完整进程日志保留于总表列出的 ignored runtime 目录，必要结果及代表截图已复制到本目录。

## 窄布局补验

复看最初的 1000×900 截图，发现 VS Code 因多个编辑组和默认设置将 diff 自动降为 inline。原代码选择与复制结果真实有效，但该图不证明左右并排，因此保留为 `layout-narrow-inline-before.png`。

随后只在独立测试配置合并编辑组、关闭窄屏自动 inline，使用同一包另跑 LayoutOnly。实际左右列坐标见 `layout-columns.json`，左列和右列都有宽度且互不覆盖；当前 `layout-narrow-diff.png` 来自这轮。4 项检查及额外 6 次实际复制均通过，已计入总数，未删掉此前通过的复制。`layout-final-results.json`、`layout-final-copy-results.json` 与总表的额外组保留原始结果。布局使用专门的代码文字检查显示和复制；源码定位及真实片段另由 JSON、核心和实际转换组验证。
