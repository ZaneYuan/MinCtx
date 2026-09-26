# MinCtx

**READ LESS · DO LESS · SAY LESS · CARRY LESS — KEEP RESULT**

一个 Claude Code 插件：在尽量不影响任务结果的前提下，让 Agent 只读必要信息、只做必要工作、只输出必要内容，并在上下文变贵之前自动"轻量接力"到新会话。

> We don't optimize for fewer tokens. We optimize for fewer tokens with equivalent outcomes.
>
> The cheapest token is the token you never load.

## 为什么是 Plugin 而不是 Skill

Skill 只是"建议"。它能影响 Agent 之后的行为，但拦不住一次整文件读取，也没法在一次 400K 的请求发出之前把它截下来。所以 MinCtx 是一个 Plugin，里面组合了几种 Claude Code 原生能力：

| 问题 | 机制 | 实现 | 上下文成本 |
|---|---|---|---|
| READ LESS：读得太多 | 先定范围，先搜后读，只读最小范围 | `SessionStart` hook 注入协议（约 270 tokens，每个会话一次） | 极低 |
| | 硬性拦截大文件的整文件读取，并附上文件大纲 | `PreToolUse` hook（Read、`cat`） | 0，只在拦截时返回提示 |
| DO LESS / SAY LESS：做得太多、说得太多 | 最小正确改动（Ponytail 思路）；不说开场白、不复述 diff（Caveman 思路） | 同一份协议 | 同上 |
| CARRY LESS：背着长会话反复烧 token | 增量维护一份小状态，到阈值自动 checkpoint，再接力到新会话，替代 `/compact` | `UserPromptSubmit` + `SessionStart` hooks | handoff 约 0.5K–2K tokens |

`/minctx:checkpoint` 和 `/minctx:stats` 这两个 skill 设置了 `disable-model-invocation`，平时完全不占上下文。

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
2. **Soft limit**（默认 100K）：提醒一次，Agent 会在下一个自然任务边界主动 checkpoint，并建议你 `/clear`。
3. **Hard limit**（默认 150K）：在你的下一条消息**发出之前**拦截。这条消息不会发送，所以不花钱；同时自动生成 `.minctx/handoff.md`，内容包括：
   - state.md（没有 state.md 时，退回使用你发过的原始需求）
   - 本会话修改过的文件列表（不含代码内容）
   - 最后一次测试/构建命令及其结果
   - 被拦下的那条消息
   - 旧 transcript 的路径（可逆：需要某个细节时去 grep，而不是把 400K 重新灌回来）
4. 你输入 `/clear`，新会话会自动加载 handoff；再发一句"继续"，Agent 就会处理被拦下的那条请求。

如果确实想发给旧会话，在消息前加 `++` 即可放行一次。斜杠命令永远不会被拦截。

也可以随时手动接力：`/minctx:checkpoint`，然后 `/clear`。

## 配置

依次合并：默认值 → `~/.minctx/config.json` → `<项目>/.minctx/config.json` → 环境变量 `MINCTX_MODE`。

```json
{
  "mode": "enforce",
  "readGuard": { "enabled": true, "maxLines": 300, "outlineEntries": 40 },
  "rollover": {
    "enabled": true,
    "softTokens": 100000,
    "hardTokens": 150000,
    "overridePrefix": "++",
    "handoffMaxAgeHours": 24
  },
  "handoff": { "maxChars": 8000 }
}
```

- `mode`：`enforce`（拦截 / 阻止）、`shadow`（只记录"本来会做什么"，完全不改变行为）、`off`
- 使用 1M 上下文的话，可以设为 `"softTokens": 300000, "hardTokens": 400000`。不过更早接力通常更省额度。
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
Context now      82.1K tokens (soft 100K · hard 150K)
Requests         32
Input processed  3.47M (new 64 · cache write 111.3K · cache read 3.36M)
Output           53.1K
Tool calls       36 (Bash 20, Write 10, Read 1, Edit 1)
Reads            1 of 1 files, ~1250 lines (ranged 0 · full 1)
Guard            2 reads narrowed · 0 rollovers · 0 handoffs loaded
```

## 已知限制

- Claude Code 的 hook 不能直接"新开会话"，所以 hard limit 之后还需要你手动 `/clear` 一次，自动化程度大约 95%。
- 上下文大小取自 transcript 里最近一次主会话请求的 usage，是"当前会话有多大"的准确值，但不包含你即将发送的那条消息本身。
- 协议规则是给模型的指令，不能 100% 保证被遵守；读取拦截和会话接力是确定性执行的。

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
hooks/hooks.json    SessionStart / UserPromptSubmit / PreToolUse
rules/protocol.md   注入的行为协议（约 270 tokens）
scripts/minctx.js   hook 分发器 + checkpoint CLI
scripts/stats.js    会话效率报告
scripts/lib/        config / transcript / guard / state(handoff)
skills/             /minctx:checkpoint, /minctx:stats
bench/              A/B benchmark 与任务
test/               node:test
```
