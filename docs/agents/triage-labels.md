# 任务状态

普通任务在 `Status:` 中使用以下名称：

| 技能中的状态 | 本项目的状态 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者需要评估任务 |
| `needs-info` | `needs-info` | 等待提出者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 要求已明确，可交给代理执行 |
| `ready-for-human` | `ready-for-human` | 需要人工实现 |
| `wontfix` | `wontfix` | 决定不处理 |

技能要求设置任务状态时，使用表中的本项目状态名称。
wayfinder 的领取和解决状态按 `issue-tracker.md` 中的专门约定记录。
