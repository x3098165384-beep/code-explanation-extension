# 任务 03：完整讲解正文运行记录

2026-10-22，VS Code 1.142.0、正式 VSIX 0.2.0。实施起点 `40b6fe23eebf3428a478362bde47f33d71376eac`。

正式通过目录为 `.scratch/first-release/runtime/background/20261022-162055-652d1e46`，执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/verify-background.ps1 -BodyOnly`。VSIX SHA-256：`812FDE0EC186DABCECEEFBE6F0BAB299E84F3F13A33CDA76E7335D14DD89A36D`。

- [8 项检查通过](results.json)，包含启动不自动阅读、完整正文与当前步骤、真实复制、保存和重排、无效 JSON 与暂时缺失后的恢复、源码失效和修复、删除步骤、更换讲解、关闭重开及停止。
- [7 次复制实际结果通过](body-copy-results.json)。使用 CDP 在本轮 VS Code 内真实拖选和 Ctrl+C，或点击正式正文页的“复制这段代码”。选中内容、VS Code 剪贴板接口和 Win32 `CF_UNICODETEXT` 逐项比较，覆盖局部字符、Tab、空行、中文路径、引号、反斜杠和代码块末尾换行。Windows 普通复制的 CRLF 仅按既定换行规则还原为 LF 后比较。
- 保存后仍为同一个正文页，按稳定步骤标识定位。复制入口在页面更新后失效；把旧入口作为新正文中的普通链接点击，也没有改变剪贴板。关闭后保存不会重建正文，停止后保存不会重新显示或复制。
- 代码失效后原行内讲解与范围清除，正文仍可复制；修复恢复行内显示。关闭全部源码标签后，也能从正文切步，在旁边重新打开源码。
- 作者 HTML 作为文字显示，作者命令没有成为可执行链接，测试命令未执行。正文不展示 JSON 定位对象或转义字符串。
- [隔离记录](isolation.json)确认没有切换桌面、没有向当前桌面发送输入，输入桌面前后均为 `Default`。实际测试位于非交互窗口环境 `Service-0x0-54064$` 的本轮单独桌面。[剪贴板读取进程](body-copy-isolation.json)属于相同环境；每次剪贴板 owner 均为本轮主进程及桌面。该 Service 环境由系统分配，不声称每轮独占；所有复制运行均串行。

截图：[标题和简介](body-overview.png)、[默认定位当前步骤](body-complete.png)、[实际复制](body-copied.png)、[保存重排](body-updated.png)、[使用上一次成功加载内容](body-stale.png)、[JSON 恢复](body-json-recovered.png)、[源码失效](body-invalid-source.png)、[恢复及仅剩正文后继续切步](body-source-recovered.png)、[关闭重开](body-reopened.png)、[停止清理](body-stopped.png)。截图说明显示结果，复制是否正确以真实动作与剪贴板比较为准。

本轮发现并修复了一个实际显示问题：刚查看正文后切步，原显示流程会在正文所在编辑器组打开源码，将正文藏到后台。[修复前结果](before-fix/columns-results.json)和[截图](before-fix/columns.png)保留。现在显示源码时沿用可见代码列；仅剩正文时在旁边打开源码，不额外保存列或活动讲解。

其他试跑修正了两处验证脚本问题：VS Code 自己注入的脚本不能被计为作者脚本；写入相同步骤的新正文后，必须等待这次正文被接受，再查询新链接。一次关闭案例源码标签时遇到测试编辑留下的未保存标记，已主动结束该轮私有进程；最终脚本仅还原本轮案例文档后关闭，没有修改用户工程或窗口。

共同既有检查 `npm test` 45 项和类型检查通过；源码列修复后重新构建打包成功。正文页面始终使用真实代码文字，保留任务 02 的行内复制实现。

随后检查截图发现无效 JSON 的同一文件错误重复显示在文件提示和步骤提示中。已按 Reader 的现有分工约定修正调用：文件错误只通过独立参数显示，步骤提示只接收代码定位错误。该小修由任务 04 的 Reader 修改纳入，任务 07 将对最终安装包重新执行正文检查；本目录截图仍如实保留当时的重复提示，不能用本轮结果代替最终全量验收。
