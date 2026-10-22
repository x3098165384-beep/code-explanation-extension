# 不切换窗口的后台验收

## 0.2.0：JSON、讲解侧栏与真实文字复制

0.2.0 已完成 JSON 阅读、完整正文页、项目讲解侧栏、最近记录、继续上次讲解及旧文件转换。正式安装包已在 VS Code 1.142.0 完成六组后台验收及额外布局检查：规格全部 22 项操作通过，111 项不同检查、包含重启及续跑的 126 次通过记录，另有 41 次真实剪贴板比较通过。类型检查、构建、打包及 46 项已有检查也已通过。

全部最终通过组对应同一安装包，SHA-256 为 `0C304332AA3B9A71403A913412A2E59FC3CF8D7B979E5FB0E273690A83E45AFA`。[完整验收表](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/acceptance.md)、[逐组结果](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/results.json)、[复制内容](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/copy-results.json)和[隔离记录](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/isolation.json)已保存。原失败、修复及使用同一安装包继续运行的过程均保留，没有将失败尝试计为通过。后台进程均已退出。

实际截图：[代码区域与简短翻译](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/conversion-begin-step.png)、[侧栏展开步骤](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/sidebar-expanded.png)、[重启后恢复及真实 diff](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/recent-restored.png)、[窄 diff 代码区域](../.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/layout-narrow-diff.png)。额外布局检查仅调整独立测试配置，确认 1000 像素宽窗口中左右两列实际并排，分别约 306 像素宽，并重新完成 6 次真实复制。原自动改为单列的截图和拖选尚未稳定时的失败记录保留。

下列任务记录是各阶段的实际结果，版本和包摘要各自独立；最终交付以本节上方使用同一安装包的验收为准。

| 阶段 | 实际通过结果 | 证据 |
| --- | --- | --- |
| 正式 JSON 阅读 | 9 项界面检查、16 次复制比较 | [任务 02](../.scratch/reading-experience/evidence/02-json-reading-2026-10-22/README.md) |
| 完整正文页 | 8 项界面检查、7 次复制比较 | [任务 03](../.scratch/reading-experience/evidence/03-formatted-body-2026-10-22/README.md) |
| 项目讲解侧栏 | 3 个进程、14 项检查 | [任务 04](../.scratch/reading-experience/issues/04-project-sidebar.md) |
| 最近记录和恢复 | 5 个进程、20 项检查，真实打开 22 份讲解并读取磁盘数据库，确认上限 20 条 | [任务 05](../.scratch/reading-experience/issues/05-recent-and-resume.md) |
| 转换后的真实讲解 | 12 步定位、18 项检查、6 次复制比较 | [任务 06](../.scratch/reading-experience/evidence/06-generation-and-conversion-2026-10-22/README.md) |

各阶段使用真实 VS Code 1.142.0 和本地 VSIX。代码框为可选择的文字，整块复制使用当前显示所对应的代码；原生 `CF_UNICODETEXT` 与选择结果逐字比较。所有实际复制运行均使用用户桌面以外的窗口站，按顺序运行，不覆盖用户的 `WinSta0` 剪贴板。只有独立桌面不足以隔离剪贴板。

新版本使用方法见[使用说明](first-release-usage.md)。下方保留旧版本及任务 01 的先行验证，明确区分当时的最小试验、旧图片显示与当前生产功能。

## 任务 01：行内文字选择与复制先行验证

2026-10-22，[任务 01](../.scratch/reading-experience/issues/01-select-and-copy-verification.md)已在独立后台 VS Code 1.142.0 中通过 10 项检查、17 次真实选择或整块复制比较；[实际结果](../.scratch/reading-experience/evidence/01-select-copy-2026-10-22/results.json)、[复制内容](../.scratch/reading-experience/evidence/01-select-copy-2026-10-22/copy-results.json)及[普通代码选区](../.scratch/reading-experience/evidence/01-select-copy-2026-10-22/copy-file-selected.png)已保留。当时由验证驱动构造最小文字评论及正文页，既有 0.1.3 包只提供实际代码引用和 diff，生产插件尚未改为新方案。

本轮确认可使用原生引用块底色及受控 `pre/code` 文字，适度简化外框；Tab 与换行先编码为 HTML 实体，避免 Markdown 预处理改变代码。普通围栏将 Tab 展为空格的失败调查保留，不计入通过数量。

实际复制需要不同的 Windows 窗口站，单独 `CreateDesktop` 不能隔离剪贴板。新增 `-CopyOnly` 使用非交互窗口站和每轮独立桌面；本机实际使用系统生成的 `Service-0x0-54064$`，不宣称该窗口站随机独占。原生读取器仅在明确匹配的非交互窗口站内读取 `CF_UNICODETEXT`，核对代码、剪贴板所有者进程及线程桌面；不访问用户的 `WinSta0` 剪贴板。沙箱渲染线程无法直接读取的桌面信息如实记录，不将它误判为复制到了用户窗口站。

只执行本项最小验证时，使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/verify-background.ps1 -CopyOnly`。驱动仅向确认属于本轮的页面发送鼠标与键盘事件，不调用当前桌面的系统输入或切换桌面。更换生产读取或显示后，还需按新规格对实际安装包复验，不能把本项结果直接当作全部后续功能完成。

## 0.1.3 代码框验收

2026-10-22，VS Code 1.142.0 的七个独立进程阶段全部正常结束，49 项后台检查通过，共生成 42 张通过截图。保留的[逐项结果](../.scratch/first-release/evidence/background-0.1.3-2026-10-22/results.json)与[隔离记录](../.scratch/first-release/evidence/background-0.1.3-2026-10-22/isolation.json)对应安装包 SHA-256 `6efb903f1edd285c8cceee7a617163188400f596d84dbaa55d3102be11914286`。

新增检查使用当前 Vonimir 讲解及两份脚本的独立副本，确认简短翻译、深浅代码框、特殊字符和反斜杠、HTML 不执行，以及实际 diff 的双侧定位和停止清除。原有更新、错误处理、未保存内容与重启检查同样通过。本轮未写入原游戏脚本，没有读取原窗口的未保存内容；前后输入桌面均为 `Default`，记录中的 `switchedDesktop`、`sentInput` 均为 `false`。

- [当前讲解与独立代码框](../.scratch/first-release/evidence/background-0.1.3-2026-10-22/46-inline-code-dark.png)
- [路径判断及其简短翻译](../.scratch/first-release/evidence/background-0.1.3-2026-10-22/46-inline-code-path.png)
- [浅色代码框](../.scratch/first-release/evidence/background-0.1.3-2026-10-22/47-inline-code-light.png)
- [特殊字符及 Windows 路径](../.scratch/first-release/evidence/background-0.1.3-2026-10-22/48-inline-code-special.png)
- [实际 diff 中的代码框](../.scratch/first-release/evidence/background-0.1.3-2026-10-22/49-code-block-diff.png)

本轮只验证上述版本、默认深浅主题及固定测试视口。代码框在原生评论中以矢量图显示，按容器宽度缩放；选择或复制原文使用“查看正文”，详见[使用说明](first-release-usage.md#行内代码框)。

## 0.1.2 原有结果

2026-10-22 最终一轮：VS Code 1.142.0、插件 0.1.2，六个独立进程阶段的 45 项检查全部通过，另有 34 项格式与异步顺序检查通过，保存 37 张通过截图。[逐项结果](../.scratch/first-release/evidence/background-0.1.2-2026-10-22/results.json)、[进程隔离记录](../.scratch/first-release/evidence/background-0.1.2-2026-10-22/isolation.json)和[首版验收表](first-release-acceptance.md)可直接核对。测试 VSIX 的 SHA-256 为 `bcca661bcf9caa8c311cd241ea8ea69a3c80d20bfb7846b49719f296685e7cfa`。

首版 01–08 项任务已完成，02–08 的验收勾选已按实际证据补齐；任务中的 `Status` 保留原有分诊标签，完成情况单独记录。2026-10-21 的 [35 项结果](../.scratch/first-release/evidence/background-0.1.2/results.json)及原来的修复前失败截图继续保留。

请求者已授权在不抢夺控制权、不切换窗口的条件下自行验证。脚本使用真实 VS Code 和实际 VSIX 安装包，代码编辑、讲解打开和导航通过 VS Code 接口完成，截图直接来自本次测试的渲染进程。不会向当前桌面发送鼠标或键盘输入。

## 怎样隔离

`tools/IsolatedDesktop.cs` 先取得系统允许使用的非交互窗口站，确认它不是用户的 `WinSta0`，再用 Windows `CreateDesktop` 创建本轮桌面，通过 `CreateProcess` 把测试进程放进去。这样窗口和剪贴板都与用户桌面分开；只有单独桌面不能隔离剪贴板。它没有切换桌面、激活窗口或发送输入的接口。创建失败时停止，不改为在当前桌面启动。启动前后记录输入桌面名称。

每轮测试都在 `.scratch/first-release/runtime/background/` 下新建目录，分别保存演示 Git 仓库、解包后的被测扩展、用户配置、扩展目录、共享数据、日志和截图。原演示工程、原讲解和编辑器未保存内容不参与写入。原生进程使用 Windows Job Object 管理；完成、超时或收到停止文件时，只结束本轮进程及其子进程，并释放句柄。

渲染连接仅使用本机回环地址，先核对窗口标题中的本轮随机标识，再读取界面、调整测试视口和截图。只在该实例内部打开步骤列表、选择或取消，不调用系统输入接口。文件选择取消使用 VS Code 自带的简化文件对话框，未测试 Windows 原生文件对话框的外观。

## 运行

先构建、检查并打包当前插件。Windows 上执行：

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run package
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/verify-background.ps1
```

也可执行 `npm.cmd run test:background`，它先打包当前代码再验收该 VSIX，避免误测旧安装包。仅希望复验现有安装包时，直接使用上述 PowerShell 脚本。

已有本地缓存时优先使用 `.scratch/first-release/runtime/vscode-1.142.0-archive/app/Code.exe`，否则使用已安装的 VS Code。也可以用 `-CodePath '完整路径/Code.exe'` 明确指定。ZIP 仅解压到测试目录，不安装或替换现有 VS Code；本次下载版本与已安装版同为 1.142.0、同一提交。脚本不结束安装版的更新进程；安装版被更新锁阻止时，改用独立 ZIP。

默认每个进程最多运行 600 秒，可用 `-TimeoutSeconds` 调整。在日志打印的本轮目录中创建名为 `stop` 的文件可停止该轮，不会关闭其他 VS Code 实例。

默认流程依次运行原有代码与 Git 检查、JSON 阅读与复制、完整正文、侧栏和最近记录。各组使用独立案例及配置，安装包摘要必须一致；最近记录组内部的五个普通进程使用同一配置，以验证真实重启。顶层目录的 `suite.json` 记录各组实际目录、包摘要和结果，每组 `results.json` 保留逐项操作。

只复验一部分时，可使用 `-CoreOnly`、`-JsonOnly`、`-BodyOnly`、`-SidebarOnly` 或 `-RecentOnly`。`-LayoutOnly` 仅检查代码区域；`-CopyOnly` 保留任务 01 的先行显示实验，不代替生产插件复制验收。

本轮核对转换后的 12 步案例时，额外显式传入 `-ExplanationPath '讲解 JSON 完整路径'` 和 `-ExplanationProject '代码项目完整路径'`，默认流程会追加转换案例组；单独运行它可加 `-ConversionOnly`。驱动只将讲解及引用的当前文件复制到独立工程，原输入保持只读。默认无参数流程不依赖 Vonimir 或其他外部项目；旧价格示例缺失的 Git 对象仍按原转换记录报告，不重新计算引用来制造通过。

## 结果含义

`results.json` 逐项记录结果，PNG 是该实例实际渲染的界面。`isolation.json` 记录进程、独立窗口环境、退出结果及前后输入桌面。失败会保留截图和界面状态；存在结果文件不等于通过，所有阶段都须正常结束且结果明确通过。

首次曾使用 VS Code 官方的 `extensionTestsPath` 入口；该模式会使用内存存储，不能据此判断进度跨进程持久化。因此改由 `test/integration` 中的独立测试扩展驱动普通 VS Code 实例，使用真实磁盘存储。旧版本先后验证首次流程、重启、另一个项目、未保存讲解、多目录项目、没有项目及代码框；0.2.0 另增加 JSON、正文、侧栏和最近记录组。最近记录检查只读实际 `state.vscdb` 数据库并跨进程主动恢复，不替换或预置生产持久记录。

真实运行可证明本次路径中的编辑器内容、Git 读取、正文、定位、更新和清理；不能自动扩大为任意主题、窗口尺寸、语言或系统版本都已经验证。原有可控读取顺序检查继续覆盖手动与普通运行都难以稳定制造的迟到结果。

本次额外发现并修复了旧源码通知取消新打开的问题：[修复前结果](../.scratch/first-release/evidence/background-0.1.2/before-fix-results.json)。已用两项可控制读取顺序的检查先确认失败、修复后通过，再使用 0.1.2 实际安装包复验相同操作。重启检查没有替换进度对象，读取的是真实磁盘存储。

本轮补齐了多目录项目选择和取消、无项目提示、新建未落盘源码的普通阅读和 diff、明确重命名前后路径、当前整个文件删除、固定版本错误，以及 10 种无效更新。文件开头 BOM 标记和 Windows 换行可读，正文中的步骤标记不会被误读；命令链接和 HTML 不执行，普通外部链接仍显示。新建未保存源码必须已关联项目内的具体路径，才能按讲解的相对路径确认对应文档。

外部链接启动浏览器和 Windows 原生文件对话框外观仍未单独操作，不计为通过。已验证的是链接显示、不授予命令执行权限、实际文件选择取消及讲解读取；这些环境限制不扩大为插件功能缺失，也不要求请求者重复手测已覆盖场景。原手动工程没有参与本轮测试写入；此前的 [Git 和磁盘核对](../.scratch/first-release/evidence/background-0.1.2/original-demo-unchanged.json)按原日期保留，没有访问其窗口或未保存缓冲区。

实现依据：[Windows 独立桌面](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createdesktopw)、[进程连接到指定桌面的规则](https://learn.microsoft.com/en-us/windows/win32/winstation/thread-connection-to-a-desktop)、[VS Code 官方扩展测试入口](https://code.visualstudio.com/api/working-with-extensions/testing-extension)、[测试模式使用内存存储的官方源码](https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMainService.ts)、[官方 Windows ZIP 说明](https://code.visualstudio.com/docs/setup/windows#_install-from-a-zip-archive)。
