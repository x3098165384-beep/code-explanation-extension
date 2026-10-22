param([string]$CodePath, [int]$TimeoutSeconds = 600, [switch]$LayoutOnly,
    [string]$ExplanationPath, [string]$ExplanationProject, [switch]$CopyOnly, [switch]$JsonOnly,
    [switch]$BodyOnly, [switch]$SidebarOnly, [switch]$RecentOnly, [switch]$ConversionOnly, [switch]$CoreOnly, [string]$ResultFile,
    [string]$ResumeRunRoot, [string]$FromPhase, [string]$ResumeSuiteRoot)
$ErrorActionPreference = 'Stop'
$copyIsolation = $true
$projectRoot = Split-Path $PSScriptRoot -Parent
$runName = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = Join-Path $projectRoot ('.scratch/first-release/runtime/background/' + $runName)
if ($ResumeRunRoot -or $ResumeSuiteRoot) {
    $runRoot = (Resolve-Path -LiteralPath $(if($ResumeRunRoot){$ResumeRunRoot}else{$ResumeSuiteRoot})).Path
    $allowed = [IO.Path]::GetFullPath((Join-Path $projectRoot '.scratch/first-release/runtime/background/'))
    if (-not $runRoot.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw '只能继续本项目独立后台目录中的检查。' }
    $runName = Split-Path $runRoot -Leaf
    if ($ResumeRunRoot -and (-not $CoreOnly -or $FromPhase -notin @('restore','project','lecture-edit','multiple-roots','no-project','layout'))) { throw '需要指定核心组中的实际恢复阶段。' }
} else { New-Item -ItemType Directory -Path $runRoot | Out-Null }
if (-not ($LayoutOnly -or $CopyOnly -or $JsonOnly -or $BodyOnly -or $SidebarOnly -or $RecentOnly -or $ConversionOnly -or $CoreOnly)) {
    if($ResumeSuiteRoot -and (Test-Path -LiteralPath (Join-Path $runRoot 'suite.json'))){Copy-Item -LiteralPath (Join-Path $runRoot 'suite.json') -Destination (Join-Path $runRoot ('suite-before-resume-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')+'.json'))}
    $suite = @{ startedAt = [DateTime]::UtcNow.ToString('o'); groups = @(); result = '进行中' }
    $groups = @('CoreOnly', 'JsonOnly', 'BodyOnly', 'SidebarOnly', 'RecentOnly')
    if ($ExplanationPath -or $ExplanationProject) { $groups += 'ConversionOnly' }
    try {
        foreach ($group in $groups) {
            $groupResult = Join-Path $runRoot ($group + '.json')
            $parameters = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, ('-' + $group), '-TimeoutSeconds', $TimeoutSeconds, '-ResultFile', $groupResult)
            if ($CodePath) { $parameters += @('-CodePath', $CodePath) }
            if ($group -eq 'ConversionOnly') { $parameters += @('-ExplanationPath', $ExplanationPath, '-ExplanationProject', $ExplanationProject) }
            $reuse=$false
            if($ResumeSuiteRoot -and (Test-Path -LiteralPath $groupResult)){
                $existing=Get-Content -LiteralPath $groupResult -Raw -Encoding UTF8|ConvertFrom-Json
                if(-not ([IO.Path]::GetFullPath($existing.runRoot)).StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw '已有分组结果不属于本项目后台目录。'}
                $existingConfig=Get-Content -LiteralPath (Join-Path $existing.runRoot 'configuration.json') -Raw -Encoding UTF8|ConvertFrom-Json
                $existingResult=Get-Content -LiteralPath (Join-Path $existing.runRoot 'results.json') -Raw -Encoding UTF8|ConvertFrom-Json
                $version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json).version
                $currentHash=(Get-FileHash -LiteralPath (Join-Path $projectRoot ('code-explanation-extension-'+$version+'.vsix'))).Hash
                if($existingConfig.runRoot -ne $existing.runRoot -or $existingConfig.packageSha256 -ne $currentHash -or $existingResult.packageSha256 -ne $currentHash){throw '已有分组与当前正式安装包不符。'}
                $reuse=$existingResult.result -eq '通过'
            }
            if(-not $reuse){
                & powershell.exe @parameters
                if ($LASTEXITCODE -ne 0) { throw ('后台检查组未通过：' + $group) }
            }
            $child = Get-Content -LiteralPath $groupResult -Raw -Encoding UTF8 | ConvertFrom-Json
            $result = Get-Content -LiteralPath (Join-Path $child.runRoot 'results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $suite.groups += @{ name = $group; runRoot = $child.runRoot; packageSha256 = $result.packageSha256; checks = @($result.cases|Where-Object{$_.result -eq '通过'}).Count; result = $result.result; reusedAfterFailure = $reuse }
            $suite | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $runRoot 'suite.json') -Encoding UTF8
        }
        if (@($suite.groups.packageSha256 | Select-Object -Unique).Count -ne 1) { throw '各检查组使用了不同安装包，不能判定完整通过。' }
        $suite.result = '通过'
    } catch {
        $suite.result = '失败'; $suite.error = $_.Exception.Message
        throw
    } finally {
        $suite.finishedAt = [DateTime]::UtcNow.ToString('o')
        $suite | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $runRoot 'suite.json') -Encoding UTF8
    }
    Write-Output ('完整后台检查结果：' + (Join-Path $runRoot 'suite.json'))
    return
}
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
if (-not $ResumeRunRoot) {
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
} else {
    $configuration = Get-Content -LiteralPath (Join-Path $runRoot 'configuration.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($configuration.runRoot -ne $runRoot) { throw '恢复目录和原运行记录不符。' }
    if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $configuration.packageSha256) { throw '安装包已改变，不能借原运行结果继续。' }
    $port=$configuration.port; $unpacked=Join-Path $runRoot 'package'; $userData=Join-Path $runRoot 'user-data'; $extensions=Join-Path $runRoot 'extensions'
    $saved=Join-Path $runRoot ('failure-before-resume-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
    New-Item -ItemType Directory -Path $saved | Out-Null
    foreach($name in @('results.json','isolation.json','driver-error.json','failure-state.json','failure.png')) { if(Test-Path -LiteralPath (Join-Path $runRoot $name)){Copy-Item -LiteralPath (Join-Path $runRoot $name) -Destination $saved} }
    Remove-Item -LiteralPath (Join-Path $runRoot 'driver-error.json') -ErrorAction SilentlyContinue
    if ($FromPhase -eq 'project') {
        $otherFixture=Join-Path $runRoot ('other-fixture-retry-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
        & node (Join-Path $PSScriptRoot 'prepare-acceptance.cjs') ('--directory=' + $otherFixture)
        if($LASTEXITCODE -ne 0){throw '恢复检查的独立项目未准备完成。'}
        $configuration.otherProject=Join-Path $otherFixture 'project'
        $configuration|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runRoot 'configuration.json') -Encoding utf8
    }
    @{fromPhase=$FromPhase;previousEvidence=$saved;packageSha256=$configuration.packageSha256}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runRoot 'resume.json') -Encoding utf8
}
$env:CODE_EXPLANATION_BACKGROUND_RUN = $runRoot
$env:ELECTRON_RUN_AS_NODE = $null
$env:VSCODE_IPC_HOOK_CLI = $null
$env:VSCODE_PORTABLE = $null
$env:CODE_EXPLANATION_BACKGROUND_PHASE = if ($ConversionOnly) { 'conversion' } elseif ($RecentOnly) { 'recent' } elseif ($BodyOnly) { 'body' } elseif ($SidebarOnly) { 'sidebar' } elseif ($JsonOnly) { 'json' } elseif ($CopyOnly) { 'copy' } elseif ($LayoutOnly) { 'layout' } else { $null }
if ($ResumeRunRoot) { $env:CODE_EXPLANATION_BACKGROUND_PHASE=$FromPhase }
Add-Type -Path (Join-Path $PSScriptRoot 'IsolatedDesktop.cs')
if ($copyIsolation) {
    if (-not (Test-Path -LiteralPath (Join-Path $runRoot 'ClipboardProbe.exe'))) {
    Add-Type -Path (Join-Path $PSScriptRoot 'ClipboardProbe.cs') -OutputAssembly (Join-Path $runRoot 'ClipboardProbe.exe') -OutputType ConsoleApplication
    }
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
$baseArguments=$arguments.Clone()
if($ResumeRunRoot -and $FromPhase -eq 'project'){$arguments[$arguments.Count-1]='"'+$configuration.otherProject+'"'}
if($ResumeRunRoot -and $FromPhase -eq 'multiple-roots'){$arguments[$arguments.Count-1]='"'+(Join-Path $runRoot 'two-projects.code-workspace')+'"'}
if($ResumeRunRoot -and $FromPhase -eq 'no-project'){$arguments=$arguments[0..($arguments.Count-2)]}
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
    $phases = if ($RecentOnly) { @('recent-restore', 'recent-project', 'recent-multiple-roots', 'recent-restore-final') } elseif ($SidebarOnly) { @('sidebar-multiple-roots', 'sidebar-no-project') } elseif ($LayoutOnly -or $CopyOnly -or $JsonOnly -or $BodyOnly -or $ConversionOnly) { @() } else { @('restore', 'project', 'lecture-edit', 'multiple-roots', 'no-project', 'layout') }
    if($ResumeRunRoot){$start=[Array]::IndexOf($phases,$FromPhase);$phases=@($phases|Select-Object -Skip ($start+1));$arguments=$baseArguments}
    foreach ($phase in $phases) {
        $env:CODE_EXPLANATION_BACKGROUND_PHASE = $phase
        $phaseResult = Get-Content -LiteralPath (Join-Path $runRoot 'results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $phaseResult.result = '进行中'
        [IO.File]::WriteAllText((Join-Path $runRoot 'results.json'), ($phaseResult | ConvertTo-Json -Depth 100))
        $phaseArguments = $arguments.Clone()
        if (($phase -in @('project', 'recent-project', 'sidebar-multiple-roots', 'recent-multiple-roots')) -and -not $configuration.otherProject) {
            $otherFixture = Join-Path $runRoot 'other-fixture'
            & node (Join-Path $PSScriptRoot 'prepare-acceptance.cjs') ('--directory=' + $otherFixture)
            if ($LASTEXITCODE -ne 0) { throw '另一项目未准备完成。' }
            $configuration.otherProject = Join-Path $otherFixture 'project'
            $configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'configuration.json') -Encoding utf8
        }
        if ($phase -in @('project', 'recent-project')) { $phaseArguments[$phaseArguments.Count - 1] = '"' + $configuration.otherProject + '"' }
        if ($phase -in @('multiple-roots', 'sidebar-multiple-roots', 'recent-multiple-roots')) {
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
    if ($ResultFile) { @{runRoot=$runRoot} | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding utf8 }
} catch {
    $record.error = $_.Exception.Message
    throw
} finally {
    if ($session) { $session.Dispose() }
    $record.finishedAt = [DateTime]::UtcNow.ToString('o')
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'isolation.json') -Encoding utf8
}
