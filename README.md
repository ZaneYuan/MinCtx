# MinCtx

**中文** | [English](README.en.md)

**让 Claude Code 少花 token 的插件：少读、少做、少说、不背旧账，结果不打折。**

装上以后照常使用 Claude Code，不用改任何习惯。MinCtx 在后台做四件事：

- **长对话自动换新会话**：对话快到上限时，把进度记成一张 1–2K 的小纸条，换到新会话接着做，不再背着几十万 token 的历史。
- **不打断正在做的事**：Claude 干活途中不插手，这一轮做完才检查。
- **最贵的那句话不发出去**：超过上限后，你没换会话就发的下一句会被拦下（不花钱），并自动带到新会话。
- **大文件不整个读**：Claude 想读上千行的文件时，先给它一份“目录”，让它只读需要的几十行。

> 我们不追求“token 越少越好”，而是“token 更少，结果一样好”。

---

## 目录

1. [为什么需要它](#1-为什么需要它)
2. [安装](#2-安装)
3. [确认装好了](#3-确认装好了)
4. [日常使用：你会看到什么](#4-日常使用你会看到什么)
5. [三个命令](#5-三个命令)
6. [常见问题](#6-常见问题)
7. [进阶配置](#7-进阶配置)
8. [怎么证明“省”得对](#8-怎么证明省得对)
9. [更新与卸载](#9-更新与卸载)

---

## 1. 为什么需要它

Claude 每回答你一句话，都要把**整段对话历史**重新读一遍，并按这个长度计费（或消耗额度）。

| 对话长度 | 你发一句“好了吗” | 实际要处理的内容 |
|---|---|---|
| 刚开始 | 很便宜 | 几 K |
| 聊了一下午 | 很贵 | 可能几十万 token |

所以很多人会遇到：**随手问一句，5 小时额度就少了一大截。**

还有两个常见的浪费：

- Claude 为了改一行代码，把一个上千行的文件整个读进来。而读进来的内容，之后每一句话都要跟着重复计费。
- Claude 自带的 `/compact` 压缩，要先把整段超长对话读一遍才能总结，这一次本身就很贵。

MinCtx 的思路是：**没加载的 token 最便宜。** 能不读就不读；对话太长了，就换个干净的新会话，只带必要的进度过去。

---

## 2. 安装

**前提**：电脑上装有 [Node.js](https://nodejs.org/) 18 或更高版本。在终端运行 `node -v` 可以检查。Windows、macOS、Linux 都支持。

### 方法 A：在 Claude Code 里安装（推荐）

打开 Claude Code，在输入框里依次输入：

```text
/plugin marketplace add ZaneYuan/MinCtx
/plugin install minctx@minctx
```

然后**退出并重新打开 Claude Code**，插件才会生效。

### 方法 B：下载到本地后启动

在终端（PowerShell / Terminal）里运行，**不是在 Claude 的输入框里**：

```bash
git clone https://github.com/ZaneYuan/MinCtx
cd 你的项目目录
claude --plugin-dir /path/to/MinCtx
```

> ⚠️ `--plugin-dir` 后面要写**本地文件夹路径**，不能写 GitHub 链接。

---

## 3. 确认装好了

1. 在任意项目里打开 Claude Code，项目目录下会自动出现一个 `.minctx` 文件夹。它会自己忽略 git，不会被提交。
2. 在 Claude 里输入 `/minctx:stats`，能看到类似下面的统计：

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

3. （可选）让 Claude 读一个超过 300 行的文件，比如“看一下 xxx.js”。它会先拿到文件目录，再按行号只读需要的部分。

---

## 4. 日常使用：你会看到什么

**大多数时候你什么都不用做。** 只有对话变长时，才会看到下面几种提示。

### 情况一：对话到了上限的 80%（默认 360K）

一轮回答结束后，会出现一次提示：

```text
MinCtx: context is 380K tokens (hand-off at 450K).
If the current task is done, /minctx:checkpoint then /clear starts the next one cheaply.
```

意思是：对话已经很长了。如果手头这件事做完了，现在换新会话最划算。**不换也没关系**，这只是提醒。

### 情况二：对话到了上限（默认 450K）

Claude 这一轮会**正常做完**，不会被打断。结束时它会顺手用几行字更新一下进度记录，然后你会看到：

```text
MinCtx: this turn finished at 460K tokens (limit 450K).
Handoff saved (~1200 tokens). Run /clear, then send "continue" to keep going in a fresh session.
```

接下来你只要两步：

1. 输入 `/clear`（开一个干净的新会话）
2. 发一句 `继续`

新会话会自动读到交接纸条（目标、做到哪、做过的决定、改过的文件、下一步），接着干活。代码都在磁盘上，需要时它会自己去读，不用把几十万 token 的旧对话再搬过来。

### 情况三：超过上限后，你没换会话就发了新消息

这句话**不会发出去，不花钱**，并自动存进交接纸条：

```text
MinCtx: this session is at 460K tokens (limit 450K), so this message was NOT sent and cost nothing.
It is saved in the handoff (~1200 tokens). Run /clear, then send "continue".
To send it to this session anyway, start the message with "++".
```

照着做 `/clear`，再发 `继续` 就行，新会话会处理你刚才那句话。

**想坚持在旧会话里发？** 在消息前加 `++`，例如 `++ 再帮我看一下这个函数`，这次就会放行。

> 以 `/` 开头的命令（比如 `/clear`）永远不会被拦截。

### 情况四：Claude 说某个文件“太长，先看目录”

这是正常现象，Claude 会自己处理：先按目录定位，再只读需要的那几十行。如果它确实需要整个文件，它会明确指定读取全部行数，这时不会再被拦。

---

## 5. 三个命令

| 命令 | 作用 |
|---|---|
| `/minctx:stats` | 查看当前会话用了多少：上下文大小、读了多少行、调用了几次工具、插件拦了几次 |
| `/minctx:limit` | 查看或修改换会话的上限，对所有项目生效 |
| `/minctx:checkpoint` | 手动存一份交接纸条。做完一件事、准备开始下一件时用，然后 `/clear` |

`/minctx:limit` 的用法：

```text
/minctx:limit            显示当前设置
/minctx:limit 450k       上限 450K，提醒点自动取 80%（360K）
/minctx:limit 450k 350k  同时指定上限和提醒点
/minctx:limit 150k       适合 200K 上下文的模型
/minctx:limit off        关闭自动换会话（读文件拦截仍然有效）
/minctx:limit on         重新打开
```

这三个命令平时**不占任何上下文**，只有你输入时才会加载。

---

## 6. 常见问题

**Q：我用的是 200K 上下文的模型，要改什么吗？**
要。输入 `/minctx:limit 150k`。否则对话还没到 450K，Claude Code 就会先自己压缩，MinCtx 的换会话就不会触发。

**Q：换会话会不会丢信息？**
交接纸条里有目标、已完成的事、做过的决定和原因、改过的文件、最后一次测试结果和下一步。代码本身在磁盘上，不需要复制。旧对话的完整记录也还在，路径写在纸条里；新会话需要某个细节时会去查，而不是瞎猜。

**Q：会不会在 Claude 干活干到一半时打断它？**
不会。检查只发生在**一轮回答结束之后**。代价是：如果 Claude 一轮里自己连续干了很久，这一轮结束时可能已经超过上限不少。

**Q：会不会影响回答质量？**
设计原则是只省“不会改变下一步正确决策”的信息。你可以用第 8 节的对比测试自己验证。

**Q：我想先观察一下，不想让它真的拦截？**
使用“影子模式”：在项目的 `.minctx/config.json` 里写 `{"mode": "shadow"}`。插件只记录“本来会拦截什么”（写在 `.minctx/log.jsonl`），完全不改变行为。

**Q：怎么完全关掉？**
在 `.minctx/config.json` 里写 `{"mode": "off"}`，或者用 `/plugin` 菜单禁用或卸载插件。

---

## 7. 进阶配置

配置文件按以下顺序合并，后面的覆盖前面的：

1. 默认值
2. `~/.minctx/config.json`：全局，`/minctx:limit` 写在这里
3. `<项目>/.minctx/config.json`：只对这个项目生效
4. 环境变量 `MINCTX_MODE`

完整配置示例（都是默认值）：

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

| 配置项 | 说明 |
|---|---|
| `mode` | `enforce`：正常拦截；`shadow`：只记录不拦截；`off`：关闭 |
| `readGuard.maxLines` | 超过多少行的文件不允许整个读，默认 300 |
| `rollover.hardTokens` | 换会话的上限 |
| `rollover.softTokens` / `softRatio` | 提醒点；不写 `softTokens` 时等于 上限 × `softRatio` |
| `rollover.refreshState` | 到上限时是否让 Claude 先更新一次进度记录，默认开启 |
| `rollover.overridePrefix` | 强制发给旧会话的前缀，默认 `++` |
| `rollover.handoffMaxAgeHours` | 交接纸条多久后失效，默认 24 小时 |

插件拦截读取的方式包括：Read 工具；Bash 的 `cat`、`cat -n`、`nl`、`head`、`tail`、`sed -n`；PowerShell 的 `Get-Content`、`gc`、`type`。判断标准是这条命令**实际要读多少行**，按范围读少量行、或接了过滤的管道（如 `cat 文件 | grep xxx`）都会照常放行。

---

## 8. 怎么证明“省”得对

省 80% 的 token、却多出 10% 的 bug，不算成功。MinCtx 自带一个对比测试：同一个任务，分别在**装和不装插件**的情况下跑，用 Claude 看不到的验收测试判断结果对不对。

```bash
node bench/run.js --runs 3     # 需要本机已登录 claude，会产生 API 费用
```

输出的最后一行是结论：

```text
Safe saving: PASS (quality held within 0pp, tokens saved)
```

只有**通过率没下降、并且 token 确实减少**，才算 PASS。

> 目前仓库还没有公开的实测数据。欢迎跑完后把结果贴到 Issue。

想加自己的测试任务：新建 `bench/tasks/<名字>/`，里面放 `repo/`（初始代码）、`task.json`（任务描述和验收命令），以及验收测试文件。

---

## 9. 更新与卸载

```text
/plugin marketplace update minctx    更新到最新版，然后重启 Claude Code
/plugin uninstall minctx@minctx      卸载
```

卸载后，项目里的 `.minctx` 文件夹可以直接删除。

---

## 开发者

```bash
npm test                          # 单元测试 + hook 端到端测试（不调用模型）
claude plugin validate .          # 校验插件 manifest
```

```text
.claude-plugin/     plugin.json, marketplace.json
hooks/hooks.json    SessionStart / UserPromptSubmit / PreToolUse / Stop
rules/protocol.md   每个会话开头注入的行为规范（约 270 tokens）
scripts/minctx.js   hook 入口 + checkpoint / limit 命令
scripts/stats.js    会话统计
scripts/lib/        config / transcript / guard / state(handoff)
skills/             /minctx:checkpoint, /minctx:stats, /minctx:limit
bench/              对比测试与任务
test/               node:test
```

**已知限制**

- Claude Code 的 hook 不能直接新开会话，所以需要你手动输入一次 `/clear`。
- 行为规范（少读、少说）是给模型的指令，不能 100% 保证被遵守；读取拦截和换会话是强制执行的。

**路线图**：免手动 `/clear` 的一键接力（CLI 包装器）、更多对比测试任务、工具输出压缩。
