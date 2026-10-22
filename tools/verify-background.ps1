param([string]$CodePath, [int]$TimeoutSeconds = 600, [switch]$LayoutOnly,
    [string]$ExplanationPath, [string]$ExplanationProject, [switch]$CopyOnly, [switch]$JsonOnly,
    [switch]$BodyOnly, [switch]$SidebarOnly)
$ErrorActionPreference = 'Stop'
$copyIsolation = $CopyOnly -or $JsonOnly -or $BodyOnly -or $SidebarOnly
$projectRoot = Split-Path $PSScriptRoot -Parent
$runName = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = Join-Path $projectRoot ('.scratch/first-release/runtime/background/' + $runName)
New-Item -ItemType Directory -Path $runRoot | Out-Null
if (-not $CodePath) {
    $cachedCode = Join-Path $projectRoot '.scratch/first-release/runtime/vscode-1.142.0-archive/app/Code.exe'
    if (Test-Path -LiteralPath $cachedCode) { $CodePath = $cachedCode }
    else {
        $command = Get-Command code.cmd -ErrorAction Stop
        $CodePath = Join-Path (Split-Path (Split-Path $command.Source -Parent) -Parent) 'Code.exe'
    }
}
$CodePath = (Resolve-Path -LiteralPath $CodePath).Path
if ([IO.Path]::GetFileName($CodePath) -ne 'Code.exe') { throw '需要指定已安装的 Code.exe。' }
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$package = Join-Path $projectRoot ('code-explanation-extension-' + $packageVersion + '.vsix')
if (-not (Test-Path -LiteralPath $package)) { throw '请先生成当前版本的 VSIX 安装包。' }
$fixture = Join-Path $runRoot 'fixture'
& node (Join-Path $PSScriptRoot 'prepare-acceptance.cjs') ('--directory=' + $fixture)
if ($LASTEXITCODE -ne 0) { throw '独立演示工程未准备完成，未启动 VS Code。' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$unpacked = Join-Path $runRoot 'package'
[IO.Compression.ZipFile]::ExtractToDirectory($package, $unpacked)
$userData = Join-Path $runRoot 'user-data'
$extensions = Join-Path $runRoot 'extensions'
New-Item -ItemType Directory -Path (Join-Path $userData 'User'), $extensions | Out-Null
$settings = @{
    'window.title' = ('后台验收 ' + $runName + ' ${activeEditorShort}')
    'window.restoreWindows' = 'none'
    'workbench.startupEditor' = 'none'; 'files.autoSave' = 'off'
    'diffEditor.renderSideBySide' = $true; 'editor.wordWrap' = 'on'
    'update.mode' = 'none'; 'extensions.autoCheckUpdates' = $false; 'extensions.autoUpdate' = $false
    'telemetry.telemetryLevel' = 'off'; 'git.autofetch' = $false
    'git.openRepositoryInParentFolders' = 'never'
    'files.simpleDialog.enable' = $true
    'files.hotExit' = 'onExitAndWindowClose'
} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $userData 'User/settings.json'), $settings)
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$packageStream = [IO.File]::OpenRead($package)
$packageHasher = [Security.Cryptography.SHA256]::Create()
try { $packageHash = [BitConverter]::ToString($packageHasher.ComputeHash($packageStream)).Replace('-', '') }
finally { $packageStream.Dispose(); $packageHasher.Dispose() }
$configuration = @{
    runName = $runName; runRoot = $runRoot; fixture = $fixture; port = $port
    codePath = $CodePath; packagePath = $package; packageSha256 = $packageHash
}
if ($ExplanationPath -or $ExplanationProject) {
    if (-not $ExplanationPath -or -not $ExplanationProject) { throw '需要同时指定讲解文件和对应代码项目。' }
    $configuration.explanationPath = (Resolve-Path -LiteralPath $ExplanationPath).Path
    $configuration.explanationProject = (Resolve-Path -LiteralPath $ExplanationProject).Path
}
$configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'configuration.json') -Encoding utf8
$env:CODE_EXPLANATION_BACKGROUND_RUN = $runRoot
$env:ELECTRON_RUN_AS_NODE = $null
$env:VSCODE_IPC_HOOK_CLI = $null
$env:VSCODE_PORTABLE = $null
$env:CODE_EXPLANATION_BACKGROUND_PHASE = if ($BodyOnly) { 'body' } elseif ($SidebarOnly) { 'sidebar' } elseif ($JsonOnly) { 'json' } elseif ($CopyOnly) { 'copy' } elseif ($LayoutOnly) { 'layout' } else { $null }
Add-Type -Path (Join-Path $PSScriptRoot 'IsolatedDesktop.cs')
if ($copyIsolation) {
    Add-Type -Path (Join-Path $PSScriptRoot 'ClipboardProbe.cs') -OutputAssembly (Join-Path $runRoot 'ClipboardProbe.exe') -OutputType ConsoleApplication
}
$arguments = @(
    '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--locale=en',
    '--disable-updates', '--disable-telemetry', '--enable-automation',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    ('--remote-debugging-port=' + $port),
    ('--user-data-dir="' + $userData + '"'), ('--extensions-dir="' + $extensions + '"'),
    ('--shared-data-dir="' + (Join-Path $runRoot 'shared-data') + '"'),
    ('--extensionDevelopmentPath="' + (Join-Path $unpacked 'extension') + '"'),
    ('--extensionDevelopmentPath="' + (Join-Path $projectRoot 'test/integration') + '"'),
    ('"' + (Join-Path $fixture 'project') + '"')
)
$session = $null
$record = @{ runRoot = $runRoot; startedAt = [DateTime]::UtcNow.ToString('o'); switchedDesktop = $false; sentInput = $false }
try {
    $session = [CodeExplanationVerification.IsolatedDesktop]::Start($CodePath, ($arguments -join ' '), $projectRoot, (Join-Path $runRoot 'main.log'), [bool]$copyIsolation)
    $record.desktop = $session.DesktopName; $record.inputDesktopBefore = $session.InputDesktopBefore
    $record.processId = $session.ProcessId
    $record.windowStation = $session.WindowStationName; $record.clipboardIsolated = [bool]$copyIsolation
    if ($copyIsolation) {
        @{ station = $session.WindowStationName; desktop = $session.DesktopName; mainProcessId = $session.ProcessId; uniqueStationPerRun = $session.WindowStationName.StartsWith('CodeExplanationClipboard_') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'copy-expected-isolation.json') -Encoding utf8
    }
    Write-Output ('已在独立 Windows 窗口环境启动后台测试：' + $runRoot)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not $session.Wait(1000)) {
        if (Test-Path -LiteralPath (Join-Path $runRoot 'stop')) { throw '已收到停止请求，结束本次测试进程。' }
        if ([DateTime]::UtcNow -gt $deadline) { throw '后台测试超时，结束本次测试进程。' }
    }
    $record.exitCode = $session.ExitCode
    $record.inputDesktopAfter = [CodeExplanationVerification.IsolatedDesktop]::InputDesktopName()
    if ($record.exitCode -ne 0) { throw ('后台 VS Code 返回错误：' + $record.exitCode) }
    if (-not (Test-Path -LiteralPath (Join-Path $runRoot 'results.json'))) { throw '后台进程已结束，但没有测试结果，不能判定通过。' }
    if ((Get-Content -LiteralPath (Join-Path $runRoot 'results.json') -Raw -Encoding UTF8 | ConvertFrom-Json).result -ne '通过') { throw '后台检查尚未全部通过。' }
    $record.phases = @(@{ name = '首次流程'; desktop = $session.DesktopName; processId = $session.ProcessId; exitCode = $session.ExitCode })
    $session.Dispose(); $session = $null
    $phases = if ($SidebarOnly) { @('sidebar-multiple-roots', 'sidebar-no-project') } elseif ($LayoutOnly -or $CopyOnly -or $JsonOnly -or $BodyOnly) { @() } else { @('restore', 'project', 'lecture-edit', 'multiple-roots', 'no-project', 'layout') }
    foreach ($phase in $phases) {
        $env:CODE_EXPLANATION_BACKGROUND_PHASE = $phase
        $phaseResult = Get-Content -LiteralPath (Join-Path $runRoot 'results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $phaseResult.result = '进行中'
        [IO.File]::WriteAllText((Join-Path $runRoot 'results.json'), ($phaseResult | ConvertTo-Json -Depth 100))
        $phaseArguments = $arguments.Clone()
        if ($phase -eq 'project' -or ($phase -eq 'sidebar-multiple-roots' -and -not $configuration.otherProject)) {
            $otherFixture = Join-Path $runRoot 'other-fixture'
            & node (Join-Path $PSScriptRoot 'prepare-acceptance.cjs') ('--directory=' + $otherFixture)
            if ($LASTEXITCODE -ne 0) { throw '另一项目未准备完成。' }
            $configuration.otherProject = Join-Path $otherFixture 'project'
            $configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'configuration.json') -Encoding utf8
            if ($phase -eq 'project') { $phaseArguments[$phaseArguments.Count - 1] = '"' + $configuration.otherProject + '"' }
        }
        if ($phase -eq 'multiple-roots' -or $phase -eq 'sidebar-multiple-roots') {
            $workspaceFile = Join-Path $runRoot 'two-projects.code-workspace'
            $workspace = @{ folders = @(
                @{ name = '首个项目'; path = (Join-Path $fixture 'project') },
                @{ name = '另一个项目'; path = $configuration.otherProject }
            ) }
            [IO.File]::WriteAllText($workspaceFile, ($workspace | ConvertTo-Json -Depth 5))
            $phaseArguments[$phaseArguments.Count - 1] = '"' + $workspaceFile + '"'
        }
        if ($phase -eq 'no-project' -or $phase -eq 'sidebar-no-project') { $phaseArguments = $phaseArguments[0..($phaseArguments.Count - 2)] }
        $session = [CodeExplanationVerification.IsolatedDesktop]::Start($CodePath, ($phaseArguments -join ' '), $projectRoot, (Join-Path $runRoot ($phase + '.log')), [bool]$copyIsolation)
        if ($copyIsolation) {
            @{ station = $session.WindowStationName; desktop = $session.DesktopName; mainProcessId = $session.ProcessId; uniqueStationPerRun = $session.WindowStationName.StartsWith('CodeExplanationClipboard_') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'copy-expected-isolation.json') -Encoding utf8
        }
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while (-not $session.Wait(1000)) {
            if ((Test-Path -LiteralPath (Join-Path $runRoot 'stop')) -or [DateTime]::UtcNow -gt $deadline) { throw '重启检查停止或超时。' }
        }
        $record.phases += @{ name = $phase; desktop = $session.DesktopName; processId = $session.ProcessId; exitCode = $session.ExitCode }
        if ($session.ExitCode -ne 0 -or (Test-Path -LiteralPath (Join-Path $runRoot 'driver-error.json')) -or
            (Get-Content -LiteralPath (Join-Path $runRoot 'results.json') -Raw -Encoding UTF8 | ConvertFrom-Json).result -ne '通过') { throw ('后台重启检查未通过：' + $phase) }
        $session.Dispose(); $session = $null
    }
    $record.inputDesktopAfter = [CodeExplanationVerification.IsolatedDesktop]::InputDesktopName()
    Write-Output ('后台测试已结束，结果：' + (Join-Path $runRoot 'results.json'))
} catch {
    $record.error = $_.Exception.Message
    throw
} finally {
    if ($session) { $session.Dispose() }
    $record.finishedAt = [DateTime]::UtcNow.ToString('o')
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'isolation.json') -Encoding utf8
}
