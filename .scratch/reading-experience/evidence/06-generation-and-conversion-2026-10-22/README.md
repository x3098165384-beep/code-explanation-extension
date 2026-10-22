# 任务 06：外部 skill 与旧讲解转换

已完成文件转换、结构比较、磁盘代码检查及 skill 检查。真实后台 VS Code 打开、定位、复制及截图由任务 07 串行执行，本记录不将其标为通过。

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

文件检查不证明界面显示、实际复制或教学含义已重新核对；真实后台结果由任务 07 补充。

## 外部仓库提交

- skill 仓库起点 `51bb42b0e020fb03a6b8c348f8769bcf55d3adc8`，本任务提交 `ad52e07`，仅包含上述 7 份 skill、说明及路由文件。
- Vonimir 起点 `3a06ede61b5b256d532d890edf79cd9a4cda4dcb`，本任务提交 `30ac5390e`，仅新增转换后的 JSON。原有其他工作区改动保留，未推送或进行 SVN 提交。
