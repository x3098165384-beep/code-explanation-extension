param(
    [string]$CodePath,
    [switch]$Reuse
)

$ErrorActionPreference = 'Stop'
$verificationRoot = $PSScriptRoot
$runtimeRoot = Join-Path $verificationRoot 'runtime'
$manifestPath = Join-Path $runtimeRoot 'manifest.json'
$extensionPath = Join-Path $verificationRoot 'extension'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '需要先安装 Node.js，才能准备独立验证工程。'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw '需要先安装 Git，才能准备真实的历史版本比较。'
}
if (-not (Test-Path -LiteralPath (Join-Path $extensionPath 'package.json') -PathType Leaf)) {
    throw '验证扩展尚未准备完成，extension 目录缺少 package.json。'
}

if (-not $CodePath) {
    $codeCommand = Get-Command code.cmd -ErrorAction SilentlyContinue
    if ($codeCommand) {
        $CodePath = Join-Path (Split-Path (Split-Path $codeCommand.Source -Parent) -Parent) 'Code.exe'
    }
}
if (-not $CodePath -or -not (Test-Path -LiteralPath $CodePath -PathType Leaf)) {
    throw '未找到已安装的 Code.exe。请通过 -CodePath 指定 VS Code 的完整路径。'
}
$CodePath = (Resolve-Path -LiteralPath $CodePath).Path
if ([IO.Path]::GetFileName($CodePath) -ne 'Code.exe') {
    throw '-CodePath 需要指向已安装的 Code.exe。'
}

$prepareArguments = @((Join-Path $verificationRoot 'prepare-fixture.js'))
if ($Reuse) {
    $prepareArguments += '--reuse'
}
& node @prepareArguments
if ($LASTEXITCODE -ne 0) {
    throw '演示工程没有准备完成，未启动 VS Code。'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedFixtureRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot 'workspace'))
if ([IO.Path]::GetFullPath($manifest.fixtureRoot) -ne $expectedFixtureRoot) {
    throw '演示工程不在当前验证目录的 runtime/workspace 内，未启动 VS Code。'
}

$userDataPath = Join-Path $runtimeRoot 'vscode-user-data'
$extensionsPath = Join-Path $runtimeRoot 'vscode-extensions'
New-Item -ItemType Directory -Path (Join-Path $userDataPath 'User'), $extensionsPath -Force | Out-Null
$settingsPath = Join-Path $userDataPath 'User/settings.json'
if (-not (Test-Path -LiteralPath $settingsPath)) {
    @'
{
  "workbench.startupEditor": "none",
  "files.autoSave": "off",
  "editor.wordWrap": "on",
  "diffEditor.renderSideBySide": true
}
'@ | Set-Content -LiteralPath $settingsPath -Encoding utf8
}

$codeCliPath = Join-Path (Split-Path $CodePath -Parent) 'bin/code.cmd'
if (Test-Path -LiteralPath $codeCliPath -PathType Leaf) {
    $version = & $codeCliPath --version
} else {
    $version = (Get-Item -LiteralPath $CodePath).VersionInfo.ProductVersion
}
Write-Output ('已安装的 VS Code 版本：' + ($version -join ' '))
Write-Output '即将启动独立扩展开发窗口，仅打开一个演示源文件，不打开项目文件夹。'
Write-Output '本脚本不更改工作区信任或安全设置，也不加载用户原有扩展目录。若仍出现安全提示，先停止界面操作并检查启动方式。'

$launchArguments = @(
    '--new-window',
    '--skip-welcome',
    '--skip-release-notes',
    ('--extensionDevelopmentPath="' + $extensionPath + '"'),
    ('--user-data-dir="' + $userDataPath + '"'),
    ('--extensions-dir="' + $extensionsPath + '"'),
    ('"' + (Join-Path $manifest.fixtureRoot $manifest.files.main) + '"')
)
Start-Process -FilePath $CodePath -ArgumentList $launchArguments -WindowStyle Normal
Write-Output '已发出启动请求。运行结果须在真实 VS Code 窗口中观察并记录。'
