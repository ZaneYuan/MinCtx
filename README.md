# MinCtx

**中文** | [English](README.en.md)

一个真正能帮你省钱和 token 额度的 Claude Code 插件，输入、输出、使用规范全覆盖。
核心目标：让你的 agent **只读必要，回得精简，做得适当**。

---

## 原理

Claude Code 每轮请求都会重放完整的会话历史，所以 token 消耗大头在输入端，而且会随会话长度累积。MinCtx 在三个位置介入：

| 方面 | 浪费来源 | MinCtx 的处理 | 实现 |
|---|---|---|---|
| 输入 · 读取 | 为改一行代码整读上千行文件，之后每轮都重复计费 | 超过 300 行且未指定范围的读取会被拒绝，同时返回带行号的文件大纲；按范围读取照常放行 | `PreToolUse`：Read、Bash（`cat`/`nl`/`head`/`tail`/`sed -n`）、PowerShell（`Get-Content`/`gc`/`type`） |
| 输入 · 会话 | 长会话里每条消息都按全量上下文计费；`/compact` 本身也要先读一遍全量上下文 | 一轮结束时检查上下文大小；超过上限就生成约 1–2K 的 handoff，`/clear` 后注入新会话 | `Stop`、`SessionStart` |
| 输入 · 会话 | 超过上限后顺手发出的下一条消息 | 这条消息不会发送，而是并入 handoff，在新会话中执行 | `UserPromptSubmit` |
| 输出 · 行为 | 冗长回复、过度实现、为“了解项目”做的无关探索 | 会话级协议（约 270 tokens）：先定范围、先搜后读、最小改动、不复述 | `SessionStart` |

与 `/compact` 的区别：`/compact` 是把长对话压成短对话；MinCtx 是把对话转成可执行状态。代码和 git 历史不进入 handoff，因为仓库本身就是真实来源。handoff 只包含仓库里恢复不出来的信息：

- `state.md`：目标、已完成事项、决策及原因、阻塞、下一步，由 agent 在里程碑处增量维护
- 本会话修改过的文件列表（不含内容）
- 最近一次测试/构建命令及结果
- 被拦下的 prompt
- 旧 transcript 路径：需要某个细节时去检索，不做全量回灌

执行中的轮次永远不会被中断。这一轮的输入已经付过费，所以交接放在轮次结束时进行。

## 安装

需要 Node.js ≥ 18（hooks 用 Node 运行），支持 Windows / macOS / Linux。

```text
/plugin marketplace add ZaneYuan/MinCtx
/plugin install minctx@minctx
```

安装后重启 Claude Code。本地开发时可以用：`claude --plugin-dir <本地路径>`（注意是本地路径，不能填 URL）。

检查是否生效：项目目录下会出现 `.minctx/`（自带 gitignore），并且 `/minctx:stats` 能输出统计。

## 使用

日常使用无需任何操作。会话接近上限时的流程如下：

1. **上下文达到上限的 80%**（默认 360K）：轮次结束后提示一次。
2. **达到上限**（默认 450K）：当前轮次正常完成，agent 更新 `state.md`，插件写入 `.minctx/handoff.md`，并提示执行 `/clear`。
3. 执行 `/clear` 后发送“继续”：新会话从 handoff 恢复。
4. 如果超过上限后没有 `/clear` 就发送了新消息：该消息不发送、不计费，并入 handoff。需要强制发给当前会话时，在消息前加 `++`。以 `/` 开头的命令始终放行。

**使用 200K 上下文窗口的模型时**，请执行 `/minctx:limit 150k`。否则 Claude Code 会在到达 450K 之前先自动压缩，MinCtx 的交接不会触发。

## 命令

| 命令 | 说明 |
|---|---|
| `/minctx:stats` | 当前会话的上下文大小、输入/输出 token、读取行数、工具调用次数、拦截记录 |
| `/minctx:limit [hard] [soft] \| off \| on` | 查看或设置交接上限（全局生效）；`soft` 默认取 `hard` 的 80% |
| `/minctx:checkpoint` | 手动生成 handoff，适合在两个任务之间用，之后执行 `/clear` |

这三个命令都设置了 `disable-model-invocation`，不调用时不占用上下文。

## 配置

按以下顺序合并，后者覆盖前者：内置默认值 → `~/.minctx/config.json` → `<项目>/.minctx/config.json` → 环境变量 `MINCTX_MODE`。

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

- `mode`：`enforce` 正常执行 · `shadow` 只把“本应执行的动作”写入 `.minctx/log.jsonl`，不改变行为 · `off` 关闭
- `rollover.refreshState`：到达上限时，是否先让 agent 更新 `state.md` 再写 handoff
- `softTokens`：不设置时等于 `hardTokens × softRatio`

## 验证

目标是在结果等价的前提下减少 token，而不是单纯压低 token。`bench/run.js` 会对同一组任务分别在 baseline 和 MinCtx 两种条件下运行，再用 agent 不可见的验收测试判定结果：

```bash
node bench/run.js --runs 3        # 需要已登录的 claude CLI，会产生 API 费用
```

只有当 MinCtx 组的通过率不低于 baseline（容差可以用 `--tolerance` 设置），并且 token 总量更低时，结论才是 `Safe saving: PASS`。原始数据写入 `bench/results/`。

目前还没有公开的基准结果。新增任务：`bench/tasks/<name>/{repo/, task.json, <验收测试>}`。

## 限制

- hook 无法自行新开会话，交接后需要手动执行一次 `/clear`。
- 上下文大小取自 transcript 中最近一次主会话请求的 usage。如果单轮运行时间很长，结束时可能已经明显超过上限。
- 读取拦截只判断单条简单命令；管道和组合命令视为已经过滤，直接放行。
- 行为协议属于模型指令，不能保证每次都被遵守；读取拦截和交接是强制执行的。

## 开发

```bash
npm test                        # 单元测试 + hook 端到端测试，不调用模型
claude plugin validate .
```

```text
hooks/hooks.json    SessionStart / UserPromptSubmit / PreToolUse / Stop
rules/protocol.md   会话级行为协议
scripts/minctx.js   hook 入口；checkpoint / limit 命令
scripts/lib/        config · transcript · guard · state
scripts/stats.js    会话统计
skills/             checkpoint · stats · limit
bench/              A/B 基准测试
```

Roadmap：CLI 包装器实现免 `/clear` 交接；扩充基准任务；工具输出压缩。
