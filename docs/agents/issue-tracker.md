# 本地任务记录

本项目的规格和任务保存在 `.scratch/` 中，使用 Markdown 文件。

## 文件约定

- 每项功能使用一个目录：`.scratch/<功能目录>/`。
- 规格保存在 `.scratch/<功能目录>/spec.md`。
- 每项任务单独保存为 `.scratch/<功能目录>/issues/<NN>-<任务名>.md`，从 `01` 开始编号。
- 普通任务在文件开头附近使用 `Status:` 记录状态；取值见 `triage-labels.md`。
- 评论和后续讨论追加在文件末尾的 `## Comments` 下。

技能要求“发布到任务记录处”时，在对应功能目录中创建文件；要求“读取相关任务”时，读取请求者指定的路径或对应编号的文件。

## wayfinder 的任务约定

使用 wayfinder 规划较大工作时：

- 总体记录保存在 `.scratch/<工作目录>/map.md`，包括备注、已作决定和待解决问题。
- 每个问题单独保存在 `.scratch/<工作目录>/issues/<NN>-<任务名>.md`，从 `01` 开始编号。
- 使用 `Type:` 记录类型：`research`、`prototype`、`grilling` 或 `task`。
- 此类任务使用独立的处理状态：未领取时省略 `Status:`，开始工作前写入 `Status: claimed`，解决后写入 `Status: resolved`。
- 依赖关系写为 `Blocked by: 01, 02`；只有列出的任务全部为 `resolved`，才能开始当前任务。
- 选择下一项任务时，按编号寻找尚未解决、未领取且依赖已解决的任务。
- 解决后，将答案追加到 `## Answer` 下，并在 `map.md` 的已作决定部分补充结论和任务链接。
