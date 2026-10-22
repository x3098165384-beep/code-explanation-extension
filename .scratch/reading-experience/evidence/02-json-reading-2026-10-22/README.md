# 任务 02：正式 JSON 阅读运行记录

2026-10-22，VS Code 1.142.0、正式插件安装包 0.2.0。实施起点 `c227738dcb21cd5c60e581d556c9c6505cf4859e`。

最终独立运行目录：`.scratch/first-release/runtime/background/20261022-155905-be3e1983`。该轮新建案例工程、配置和解包目录，没有复用旧手动案例。运行命令为 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/verify-background.ps1 -JsonOnly`。

- [9 项实际检查全部通过](results.json)，包括普通文件、固定版本、修改行和整个文件新增/删除、未保存源码、保存更新与重排、无效 JSON 恢复、拒绝旧 Markdown、可读正文回看及停止。
- [16 次复制逐字比较全部通过](json-copy-results.json)。局部复制使用实际鼠标拖选和 Ctrl+C；整块复制实际点击生产显示的复制入口。文本包含 Tab、空行、中文路径、引号、反斜杠及长行，没有从源码另取文本替代复制结果。
- [窗口隔离记录](isolation.json)显示没有切换桌面或向当前桌面发送输入，输入桌面始终为 Default。测试进程位于非交互窗口环境 Service-0x0-54064$，使用每轮单独桌面；该环境名称由系统分配，不声称每轮新建窗口环境。[原生读取进程的环境](json-copy-isolation.json)与测试桌面一致；每次原生剪贴板结果的 ownerProcessId 均为本轮 main，ownerThreadDesktop 均为本轮桌面。没有写入用户的 WinSta0 剪贴板。
- 类型检查、构建以及 `npm test` 的 44 项检查通过：20 项 JavaScript 对应检查、10 项 JSON 输入检查和 14 项更新/取消顺序检查。

安装包 SHA-256 为 `D8676E221AA0D52F85E47DD5CAB81D5353B03A3867927A4CB8F08294F76ABEB9`。包内代码为本任务实现，0.2.0 元数据由主代理统一更新。

代表截图：[普通代码](json-file.png)、[复制入口与两个代码块](json-selected.png)、[整个删除文件的真实 diff](json-diff.png)、[保存更新](json-updated.png)、[失效源码恢复](json-source-recovered.png)、[错误 JSON 恢复](json-invalid-recovered.png)、[临时可读正文](json-body-fallback.png)、[停止](json-stopped.png)。图片只展示显示结果；复制验收以实际动作及原生剪贴板比较为准。

首次脚本试跑暴露了复制按键事件写法、Windows 路径大小写和订阅完成时重新显示导致测试取节点过早的问题。最终脚本沿用任务 01 的 rawKeyDown，并在代码显示稳定后执行复制，未把这些失败计入通过次数。生产没有增加测试状态。

本轮没有验证完整规格全部 22 项操作。侧栏、最近记录和正式完整正文页由后续任务完成；当前回看从已接受数据生成可读 Markdown 虚拟文档。旧公共后台阶段中的 Markdown 输入生成和 SVG 断言仍待任务 07 适配，不能用本轮结果代替默认全量命令的通过记录。
