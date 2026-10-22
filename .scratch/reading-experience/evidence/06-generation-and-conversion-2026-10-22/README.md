# 任务 06：外部 skill 与旧讲解转换

已完成文件转换、结构比较、磁盘代码检查及 skill 检查。随后在独立后台 VS Code 通过 18 项实际检查、6 次选择或整块复制比较，保存 6 张通过截图。任务 07 继续对最终安装包做整体复验。

## 转换结果

| 原文件 | 新文件 | 步数 | 结果 |
| --- | --- | --- | --- |
| `first-release/explanation.example.md` | `reading-experience/explanation.example.json` | 5 | 结构及无损比较通过；在遗留演示目录检查，第 1 步通过，第 2–5 步所需的 Git 对象无法读取 |
| `first-release/explanation-formatting.example.md` | `reading-experience/explanation-formatting.example.json` | 1 | 结构、无损比较及现有独立验收工程的磁盘代码检查通过 |
| Vonimir 的 `docs/explanations/enemy-pre-spawn-presentation.md` | 同项目 `.code-explanations/enemy-pre-spawn-presentation.json` | 12 | 结构、无损比较、12 步磁盘代码检查全部通过 |

插件示例位置相对本项目 `.scratch/`。Vonimir 项目为 `F:/Sync/svnVO/trunk/Vonimir`；此路径仅用于定位本次外部输入，不是插件运行依赖。全部原文件保留，新文件写入前已确认无同名文件。

Vonimir `.vscode/settings.json` 没有 `codeExplanation.directory`，本次读取的项目设置采用默认 `.code-explanations/`。没有读取用户窗口的配置文件选择、未保存设置或用户级配置，不声称覆盖窗口实际配置。讲解引用路径仍相对 Vonimir 项目，不随讲解目录变化。

## 无损比较与代码检查

一次性执行在内存中加载 `c227738dcb21cd5c60e581d556c9c6505cf4859e` 的正式旧解析器；新文件经正式 `dist/explanation.js` 的版本 2 解析器接受，来源提交为 `391ce05`。没有将旧解析器、转换脚本或导入入口加入正常插件或 skill 工作流。

逐项比较讲解标识、标题、标题后简介、代码引用和步骤；每步的标识、顺序、标题、解码后正文、范围及摘要全部相等。仅移除旧模型的 Markdown 标题行号，改用显式 JSON 标题及正文，并将外层格式版本改为 `2`。原始文件字节在写入后再次比较，未被修改。完整文件哈希和逐步正文哈希见 [conversion-results.json](conversion-results.json)。

代码对应使用正式 `checkTarget`、`normalizeText` 和 `sha256`，没有重算旧引用来掩盖变化。外部 `check-explanation.mjs` 直接加载插件解析及定位函数，同时检查真实路径、存在状态和 Git 版本。

- Vonimir：12/12 步定位通过，具体行号见 JSON 证据。源文件仅从磁盘读取，没有读取编辑器未保存内容，也未运行 Unity。
- JavaScript 示例：在 `.scratch/first-release/runtime/acceptance/project` 检查通过。
- 价格示例：在 `.scratch/first-release/verification/runtime/workspace` 检查，第 2–5 步的 `git cat-file` 返回无法取得对象。保留原提交、摘要和正文，未切换或改写该演示仓库。其他真实 diff 的后台验证不能替这 4 步补记通过。

本次没有修改业务源码、`.meta` 或 Unity 配置，没有切换分支或改变已有暂存内容。提交仅包含本任务文件。新 JSON 路径改变，不保证继承原 Markdown 路径下的旧阅读进度。

## skill 与工具

Teach with Code Explanation 保留英文标题、仅手动调用及“代码块后简短直接翻译”的要求。正文保持 Markdown，文件改为 JSON；输出目录读取项目 `codeExplanation.directory`，缺省 `.code-explanations/`。说明同步侧栏、最近讲解、“继续上次讲解”、排版正文与文字复制，不再要求矢量图代码框。

同步范围为 skill、协作参考、正式检查脚本、人读说明、两个 README 和 ask-matt 路由。教学短例及 `agents/openai.yaml` 未改。`tools/code-reference.cjs` 原本只输出与封装无关的 `source` 和 `target`，继续直接复用插件的摘要实现，不为 JSON 添加重复工具。

本轮实际执行结果：

- `quick_validate.py`：通过。
- `node --check check-explanation.mjs`：通过。
- 外部 skill 仓库 `git diff --check`：通过。
- JSON 检查器读取转换后的 Vonimir 文件：12 步通过，明确说明仅磁盘检查。
- JSON 检查器读取原 `.md`：按预期拒绝并说明需要一次性转换。

文件检查不证明界面显示、实际复制或教学含义已重新核对。下面的后台结果仅证明本次实际安装包及指定案例的显示、定位、复制和输入未改写，不扩大为其他主题、尺寸或完整业务语义均已核对。

## 独立后台 VS Code

运行 `20261022-163233-d8d70137` 正常结束，18 项检查通过，VS Code 为 1.142.0，插件为 0.2.0。安装包哈希及逐项时间见 [ui-results.json](ui-results.json)，实际引用、12 步标识和 6 次剪贴板比较见 [ui-conversion-results.json](ui-conversion-results.json)。没有重新构建或替换请求者窗口中的插件。

验证脚本只读真实 JSON 和它引用的两份磁盘源码，按原始字节复制到本轮独立演示工程。JSON 的正文、标识、顺序、摘要及目标未改；每步经正式打开和导航命令显示，逐一核对文件 URI、原范围和实际高亮。验证完成后清理本轮新增副本；真实输入的字节哈希前后一致，独立工程原讲解、源码和 Git 基准也未改变。

普通步骤实际拖选 `_hasPath` 并复制，另通过界面整块复制路径判断。diff 使用本轮已有九步演示工程，另存一份仅补充代码围栏正文的 JSON，引用、步骤标识、范围及摘要保持不变。分别检查改前、改后和双侧目标，实际拖选复制三次，再整块复制双侧步骤代码。六次剪贴板内容均与预期代码原文相等；截图仅证明显示，复制结果由真实按键或点击及 Win32 剪贴板读取证明。

- [BeginStep 行内讲解](conversion-begin-step.png)
- [PreparePath 行内讲解](conversion-prepare-path.png)
- [路径判断及下方简短翻译](conversion-path-condition-selected.png)
- [diff 改前目标](conversion-diff-3.png)
- [diff 改后目标](conversion-diff-4.png)
- [diff 双侧目标](conversion-diff-5.png)

[隔离记录](ui-isolation.json)显示输入桌面前后都是 `Default`，没有切换桌面或向当前桌面发送输入。实际复制位于非交互窗口站 `Service-0x0-54064$` 及本轮独立桌面，逐次核对剪贴板所有者为本轮 VS Code 主进程和桌面，没有读写用户 `WinSta0` 剪贴板。未启动或操作 Unity，未读取用户窗口的未保存内容。

首轮在跨文件的第 12 步立即检查高亮，当时 DOM 尚未返回可见高亮，断言失败。保留[失败结果](before-wait-results.json)及[随后截图](before-wait-failure.png)。脚本改为等待当前步骤的真实高亮出现，再做相同范围断言；第二轮全部通过，没有修改生产代码或放宽目标检查。

## 外部仓库提交

- skill 仓库起点 `51bb42b0e020fb03a6b8c348f8769bcf55d3adc8`，本任务提交 `ad52e07`，仅包含上述 7 份 skill、说明及路由文件。
- Vonimir 起点 `3a06ede61b5b256d532d890edf79cd9a4cda4dcb`，本任务提交 `30ac5390e`，仅新增转换后的 JSON。原有其他工作区改动保留，未推送或进行 SVN 提交。
