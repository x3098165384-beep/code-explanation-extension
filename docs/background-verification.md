# 不切换窗口的后台验收

2026-10-21 最终一轮：VS Code 1.142.0、插件 0.1.2，四个独立进程阶段的 35 项检查全部通过，另有 34 项格式与异步顺序检查通过。已保留 29 张通过截图及 1 张修复前失败截图。[逐项结果](../.scratch/first-release/evidence/background-0.1.2/results.json)、[进程隔离记录](../.scratch/first-release/evidence/background-0.1.2/isolation.json)和[首版验收表](first-release-acceptance.md)可直接核对。测试 VSIX 的 SHA-256 为 `b047b505d57a697237aeff33ea9ceb58ff792d0f19a2fbd14e4e30223b6eb943`。

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

## 结果含义

`results.json` 逐项记录结果，PNG 是该实例实际渲染的界面。`isolation.json` 记录进程、独立窗口环境、退出结果及前后输入桌面。失败会保留截图和界面状态；存在结果文件不等于通过，所有阶段都须正常结束且结果明确通过。

首次曾使用 VS Code 官方的 `extensionTestsPath` 入口；该模式会使用内存存储，不能据此判断进度跨进程持久化。因此最终流程改由 `test/integration` 中的独立测试扩展驱动普通 VS Code 实例，使用真实磁盘存储，再分别重启同一项目和切换到另一个独立项目。未修改生产插件接口，也未替换阅读进度对象。

真实运行可证明本次路径中的编辑器内容、Git 读取、正文、定位、更新和清理；不能自动扩大为任意主题、窗口尺寸、语言或系统版本都已经验证。原有可控读取顺序检查继续覆盖手动与普通运行都难以稳定制造的迟到结果。

本次额外发现并修复了旧源码通知取消新打开的问题：[修复前结果](../.scratch/first-release/evidence/background-0.1.2/before-fix-results.json)。已用两项可控制读取顺序的检查先确认失败、修复后通过，再使用 0.1.2 实际安装包复验相同操作。重启检查没有替换进度对象，读取的是真实磁盘存储。

本次没有单独操作多根目录的项目选择、新建且尚未落盘的源码文件、外部链接打开或 Windows 原生文件对话框外观。这些不计入已运行的 35 项，也不要求请求者为本次后台方案重复手动验收。原手动演示工程的 [Git 和磁盘核对](../.scratch/first-release/evidence/background-0.1.2/original-demo-unchanged.json)全部与准备基准一致；没有访问其窗口或读取未保存缓冲区。

实现依据：[Windows 独立桌面](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createdesktopw)、[进程连接到指定桌面的规则](https://learn.microsoft.com/en-us/windows/win32/winstation/thread-connection-to-a-desktop)、[VS Code 官方扩展测试入口](https://code.visualstudio.com/api/working-with-extensions/testing-extension)、[测试模式使用内存存储的官方源码](https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMainService.ts)、[官方 Windows ZIP 说明](https://code.visualstudio.com/docs/setup/windows#_install-from-a-zip-archive)。
