# MinCtx

**READ LESS · DO LESS · SAY LESS · CARRY LESS — KEEP RESULT**

一个 Claude Code 插件：在尽量不影响任务结果的前提下，让 Agent 只读必要信息、只做必要工作、只输出必要内容，并在上下文变贵之前自动"轻量接力"到新会话。

> We don't optimize for fewer tokens. We optimize for fewer tokens with equivalent outcomes.
>
> The cheapest token is the token you never load.

## 它帮你省在哪

| 功能 | 你会看到什么 | 为什么省 |
|---|---|---|
| **长对话自动换新会话** | 一轮回答结束后提示：“上下文 460K，交接已保存，`/clear` 后发‘继续’” | 对话越长，每句话都要把全部历史重新算一遍钱。换新会话后只带一张 1–2K 的交接纸条，之后每句话都便宜 |
| **不打断正在做的事** | Claude 干活途中不会被中断，这一轮做完才检查 | 这一轮的输入已经花掉了，中途打断既浪费又会丢进度 |
| **最贵的那句话不发出去** | 超过上限后，你没换会话就发的下一句会被拦下，并自动存进交接 | 这一次一分钱不花，换会话后照样执行 |
| **大文件不整个读** | Claude 想读上千行的文件时，先拿到一份“目录”（每个函数在第几行），再只读需要的几十行 | 少读的内容，之后每一轮都不用再背着 |
| **少绕路、少啰嗦** | Claude 不为了“了解项目”乱翻文件，不说开场白，不复述改动 | 输入和输出都更少（靠规则约束，不是强制） |
| **随时看用量** | `/minctx:stats` | 看清钱花在哪 |

## 为什么是 Plugin 而不是 Skill

Skill 只是“建议”，拦不住一次整文件读取，也没法在一句贵消息发出前把它截下来。所以 MinCtx 是一个 Plugin，组合了几种 Claude Code 原生能力：

| 机制 | 实现 | 上下文成本 |
|---|---|---|
| 行为规范（少读 / 少做 / 少说 / 维护状态） | `SessionStart` hook 注入，约 270 tokens，每个会话一次 | 极低 |
| 大文件读取拦截：Read、Bash（`cat`/`cat -n`/`nl`/`head`/`tail`/`sed -n`）、PowerShell（`Get-Content`/`gc`/`type`） | `PreToolUse` hook，按实际要读的行数判断，按范围读少量行照常放行 | 0，只在拦截时返回大纲 |
| 本轮结束时检查上下文并交接 | `Stop` hook | 超限时多一步很小的 state.md 更新 |
| 两轮之间拦下超限后的新消息 | `UserPromptSubmit` hook | 0 |
| `/minctx:checkpoint`、`/minctx:stats`、`/minctx:limit` | 仅限用户调用的 skill | 平时不占上下文 |

## 安装

需要 Node.js ≥ 18，并且在 PATH 里（hooks 用 Node 运行，Windows / macOS / Linux 都可以）。

```text
/plugin marketplace add ZaneYuan/MinCtx
/plugin install minctx@minctx
```

本地开发时可以用：`claude --plugin-dir /path/to/MinCtx`

## 核心功能：Zero-Compact Session Rollover

`/compact` 做的是 **Conversation → 更小的 Conversation**，而且总结本身要先读完整个大上下文。
MinCtx 做的是 **Conversation → 可执行状态**：

```text
L0 Durable State    Git / 文件系统 / 测试        → 不复制（代码就在磁盘上）
L1 Task State       目标 / 决策 / 阻塞 / 下一步  → 写进 handoff
L2 Disposable       讨论过程 / 失败尝试 / 工具日志 → 直接丢弃（原 transcript 仍可按需 grep）
```

具体流程：

1. **过程中**：Agent 在每个里程碑重写 `.minctx/state.md`（不超过 25 行：goal / done / decisions / blockers / next）。这是增量维护，不等到最后才一次性总结。
2. **执行中绝不打断**：Claude 读文件、改代码、跑测试的过程中，MinCtx 不做任何事。
3. **一轮结束时检查**（`Stop` hook）：
   - 到上限的 80%（默认 360K）：提示一次，说明现在是换会话的好时机。
   - 到上限（默认 450K）：让 Claude 顺手更新一次 `state.md`，这一步很小，旧内容基本都在缓存里。然后自动写好 `.minctx/handoff.md`，并提示你 `/clear`。
4. **handoff 内容**：state.md（没写的话，退回使用你发过的原始需求）、本会话修改过的文件列表（不含代码内容）、最后一次测试/构建命令及结果，以及旧 transcript 路径（需要某个细节时去 grep，而不是把 450K 重新灌回来）。
5. 你输入 `/clear`，新会话自动加载 handoff；发一句“继续”就接着做。
6. **如果你没 `/clear` 就发了新消息**：这时上一轮已经结束，拦下它不会打断任何工作。这句话不会发出去、不花钱，而是存进 handoff，`/clear` 后发“继续”即可。想发给旧会话的话，在消息前加 `++` 放行一次。斜杠命令永远不会被拦截。

随时可以手动接力：`/minctx:checkpoint`，然后 `/clear`。

调整上限：`/minctx:limit 450k`（也支持 `1m`、`150k`、`off`、`on`），只对当前项目生效。200K 上下文窗口的模型建议设为 `150k`。

## 配置

依次合并：默认值 → `~/.minctx/config.json` → `<项目>/.minctx/config.json` → 环境变量 `MINCTX_MODE`。

```json
{
  "mode": "enforce",
  "readGuard": { "enabled": true, "maxLines": 300, "outlineEntries": 40 },
  "rollover": {
    "enabled": true,
    "hardTokens": 450000,
    "softRatio": 0.8,
    "refreshState": true,
    "overridePrefix": "++",
    "handoffMaxAgeHours": 24
  },
  "handoff": { "maxChars": 8000 }
}
```

- `mode`：`enforce`（拦截 / 阻止）、`shadow`（只记录"本来会做什么"，完全不改变行为）、`off`
- `softTokens` 不写时为 `hardTokens × softRatio`。`refreshState: false` 表示到上限时不让 Claude 更新 state.md，直接用已有信息写 handoff。
- 所有状态都放在 `<项目>/.minctx/`，这个目录会自动 gitignore 自己。

## 如何确保"省"得对

**原则：只省"不会改变下一步正确决策"的信息。**

四条规则：

1. Don't remove constraints.（不删约束）
2. Don't remove unresolved information.（不删未解决的信息）
3. Don't duplicate recoverable information.（能从 repo / git / 测试恢复的，不复制进上下文）
4. Remove anything that does not change a correct next action.

三个不变量：**Decision Invariance**（下一步选择一致）、**Result Invariance**（最终结果等价）、**Constraint Invariance**（用户要求和安全边界不丢）。

MinCtx 的每个机制都保证可恢复（reversible）：

- 读取拦截不是禁止读，而是给出大纲，让 Agent 先定位再读；确实需要整文件时，显式传 `offset`/`limit` 即可。
- handoff 丢掉的内容在旧 transcript 里还在，路径写在 handoff 里。
- `shadow` 模式可以在真正启用前先收集数据：`.minctx/log.jsonl` 会记录每一次"本来会拦截"的动作。

### Benchmark：Safe Token Saving Rate

"省 80% token、多 10% bug"不算成功。`bench/` 会用同一组任务分别跑 baseline 和 MinCtx，并用隐藏的验收测试来判定结果：

```bash
node bench/run.js --runs 5            # 需要本机已登录 claude CLI，会产生 API 费用
node bench/run.js --only bulk-discount-boundary --runs 3 --tolerance 0.05
```

示例输出格式（数字仅作说明，不是实测结果）：

```text
| metric      | baseline | minctx | change |
| pass rate   | 100%     | 100%   |        |
| inputTokens | 184,203  | 97,551 | -47.0% |
| linesRead   | 1,290    | 180    | -86.0% |
...
Safe saving: PASS (quality held within 0pp, tokens saved)
```

添加任务的方式：新建 `bench/tasks/<name>/`，里面放 `repo/`（任务初始代码）、`task.json`（包含 `prompt`、`check` 命令和 `checkFiles`），以及隐藏的验收测试文件。验收测试只在 Agent 完成后才拷进工作区。

### 查看当前会话效率

```text
/minctx:stats
```

```text
MinCtx stats · session 6bfa5c84
Context now      82.1K tokens (soft 360K · hard 450K)
Requests         32
Input processed  3.47M (new 64 · cache write 111.3K · cache read 3.36M)
Output           53.1K
Tool calls       36 (Bash 20, Write 10, Read 1, Edit 1)
Reads            1 of 1 files, ~1250 lines (ranged 0 · full 1)
Guard            2 reads narrowed · 0 hand-offs · 0 handoffs loaded
```

## 已知限制

- Claude Code 的 hook 不能直接“新开会话”，所以交接后还需要你手动 `/clear` 一次。
- 上下文大小取自 transcript 里最近一次主会话请求的 usage。如果 Claude 在一轮里自主跑很久，这一轮可能超过上限很多；这是“不打断”的代价，交接会在这一轮结束时进行。
- 读取拦截只判断单条简单命令；管道（如 `cat f | grep x`）默认视为已经过滤，直接放行。
- 行为规范是给模型的指令，不能 100% 保证被遵守；读取拦截和会话交接是确定性执行的。

## 路线图

- **V2 Zero-Touch Rollover**：提供一个轻量 CLI wrapper（`ctx`），负责管理 Claude 进程，做到自动 checkpoint、自动新开会话、自动重新提交你的消息，完全不需要手动 `/clear`。
- Shadow 数据的离线回放：比较 full context 和裁剪后 context 的结果差异。
- 更多 benchmark 任务（多文件、功能开发、长日志排障），以及逐层消融（dedup / logs / resolved history 各自能省多少、各损失多少）。
- 工具输出压缩（日志、测试输出）。

## 开发

```bash
npm test                          # 单元测试 + hook 端到端测试（不调用模型）
claude plugin validate .          # 校验 manifest
```

结构：

```text
.claude-plugin/     plugin.json, marketplace.json
hooks/hooks.json    SessionStart / UserPromptSubmit / PreToolUse / Stop
rules/protocol.md   注入的行为协议（约 270 tokens）
scripts/minctx.js   hook 分发器 + checkpoint / limit CLI
scripts/stats.js    会话效率报告
scripts/lib/        config / transcript / guard / state(handoff)
skills/             /minctx:checkpoint, /minctx:stats, /minctx:limit
bench/              A/B benchmark 与任务
test/               node:test
```
