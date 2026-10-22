# 行内代码讲解 0.2.0 安装包

本目录保存已完成后台验收的 `code-explanation-extension-0.2.0.vsix`。从 GitHub 打开该文件后选择下载原文件；不要将文件页面另存为 VSIX。

SHA-256：`0C304332AA3B9A71403A913412A2E59FC3CF8D7B979E5FB0E273690A83E45AFA`

## 安装

1. 在需要使用插件的 VS Code 配置中打开扩展面板。
2. 点击面板右上角 `…`，选择“从 VSIX 安装”，选中下载的文件。
3. 按提示重新加载窗口。左侧活动栏应出现“行内代码讲解”，点击后可查看项目讲解。

也可以在终端中安装。使用具名配置时，明确指定配置名称，例如：

```powershell
code --profile VibeCoding --install-extension .\code-explanation-extension-0.2.0.vsix --force
```

将 `VibeCoding` 换成实际使用的已有配置名称；使用默认配置时省略 `--profile VibeCoding`。只安装到默认配置，不能保证其他配置中的插件已经更新。

## 版本与验收

本目录保留已验收安装包的原字节，不因补充文档重新构建。以后代码变化需要重新打包并验证受影响的行为，不能沿用本包的摘要和通过记录。

使用方法见 `docs/first-release-usage.md`，完整验收及截图见 `.scratch/reading-experience/evidence/07-background-acceptance-2026-10-22/acceptance.md`。继续工作前先读 `docs/handoff/2026-10-22-191534-github-vsix.md`。

本包保存于 GitHub 源码仓库，尚未发布到 VS Code Marketplace。内置扩展同步不会代传此 VSIX；其他电脑需下载安装包。讲解 JSON 随项目自行同步，阅读进度未提供跨电脑迁移保证。
