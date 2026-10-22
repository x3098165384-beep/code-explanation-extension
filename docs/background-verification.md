# 不切换窗口的后台验收

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

`tools/IsolatedDesktop.cs` 用 Windows `CreateDesktop` 创建新的窗口环境，通过 `CreateProcess` 的桌面参数把测试进程放进去。它没有切换桌面、激活窗口或发送输入的接口。创建失败时停止，不改为在当前桌面启动。启动前后记录输入桌面名称。

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

只检查代码框时，加 `-LayoutOnly`。需要核对已有讲解时，同时传入 `-ExplanationPath '讲解文件完整路径'` 和 `-ExplanationProject '代码项目完整路径'`；目前这两个参数用于当前文件引用的讲解，脚本只将讲解及所引用文件复制到独立工程中。省略时使用已有演示讲解。默认完整流程最后也运行代码框检查。

## 结果含义

`results.json` 逐项记录结果，PNG 是该实例实际渲染的界面。`isolation.json` 记录进程、独立窗口环境、退出结果及前后输入桌面。失败会保留截图和界面状态；存在结果文件不等于通过，所有阶段都须正常结束且结果明确通过。

首次曾使用 VS Code 官方的 `extensionTestsPath` 入口；该模式会使用内存存储，不能据此判断进度跨进程持久化。因此最终流程改由 `test/integration` 中的独立测试扩展驱动普通 VS Code 实例，使用真实磁盘存储，依次运行首次流程、同项目重启、另一个项目、未保存讲解、多目录项目和没有项目六个阶段；0.1.3 再增加代码框阶段。未修改生产插件接口，也未替换阅读进度对象。

真实运行可证明本次路径中的编辑器内容、Git 读取、正文、定位、更新和清理；不能自动扩大为任意主题、窗口尺寸、语言或系统版本都已经验证。原有可控读取顺序检查继续覆盖手动与普通运行都难以稳定制造的迟到结果。

本次额外发现并修复了旧源码通知取消新打开的问题：[修复前结果](../.scratch/first-release/evidence/background-0.1.2/before-fix-results.json)。已用两项可控制读取顺序的检查先确认失败、修复后通过，再使用 0.1.2 实际安装包复验相同操作。重启检查没有替换进度对象，读取的是真实磁盘存储。

本轮补齐了多目录项目选择和取消、无项目提示、新建未落盘源码的普通阅读和 diff、明确重命名前后路径、当前整个文件删除、固定版本错误，以及 10 种无效更新。文件开头 BOM 标记和 Windows 换行可读，正文中的步骤标记不会被误读；命令链接和 HTML 不执行，普通外部链接仍显示。新建未保存源码必须已关联项目内的具体路径，才能按讲解的相对路径确认对应文档。

外部链接启动浏览器和 Windows 原生文件对话框外观仍未单独操作，不计为通过。已验证的是链接显示、不授予命令执行权限、实际文件选择取消及讲解读取；这些环境限制不扩大为插件功能缺失，也不要求请求者重复手测已覆盖场景。原手动工程没有参与本轮测试写入；此前的 [Git 和磁盘核对](../.scratch/first-release/evidence/background-0.1.2/original-demo-unchanged.json)按原日期保留，没有访问其窗口或未保存缓冲区。

实现依据：[Windows 独立桌面](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createdesktopw)、[进程连接到指定桌面的规则](https://learn.microsoft.com/en-us/windows/win32/winstation/thread-connection-to-a-desktop)、[VS Code 官方扩展测试入口](https://code.visualstudio.com/api/working-with-extensions/testing-extension)、[测试模式使用内存存储的官方源码](https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMainService.ts)、[官方 Windows ZIP 说明](https://code.visualstudio.com/docs/setup/windows#_install-from-a-zip-archive)。
