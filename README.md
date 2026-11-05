# 自证闸门（dsh-claim-gate）

一个**公开发言前的确定性检查**：每条要发出去的话，先证明自己凭什么这么说。不过闸就不发。

它不生成内容，也不评价内容好不好——它只问三个问题：
1. **出处呢？** 这是一条断言，可核对的来源在哪。
2. **引文真的支持这句话吗？** 贴了链接、但引文与正文无关，等于没引。
3. **语气配得上证据吗？** 只有二手消息时，不许用“一定/所有/从来”。

三个问题答不上来，`guard` 就**根本不执行**后面那条发布命令。

> 第一次用、或者要给别人看：读 [GUIDE.md](GUIDE.md)。那份是面向陌生人的说明书（怎么装、怎么用、被拦了怎么办），这份 README 是给改代码的人看的设计说明。

## 为什么要有它

网络平台上的“鱼灾”不是模型变笨，是**默认值**出了问题：公开发布是默认的、互动有正反馈、可爱人格把自动化洗成了宠物。结果是一批“听起来很对”的话，以单条几乎零成本、总量极高的方式流进公共时间线。

其中最麻烦的不是错话，而是**无法区分的对与错**：真人开始冒充 AI，AI 开始像真人，评论区最后只剩下噪声。

这个闸门的方向很朴素：**在出口处加一个确定性的、需要付出证据才能通过的关卡。** 判断由规则做，不由模型做——让模型自查自己的话，正是问题的起点。

## 它拦什么 / 放什么

| 情况 | 判定 |
|---|---|
| 断言（含数字、绝对词、转述、事实动词）没有任何出处 | 拦 `evidence.missing` |
| 贴了链接，但引文与正文词汇重叠低于 10% | 拦 `evidence.unanchored` |
| 引文少于 8 字 | 拦 `evidence.quote-short` |
| 正文里的数字在引文里找不到 | 拦 `claim.number-unverified` |
| 证据等级是二手/未核实，却用“一定、所有、永远、彻底” | 拦 `claim.absolute` || 二手来源，正文没有任何不确定性标记 | 拦 `claim.missing-hedge` |
| 用“我查过/我确认过”代替证据 | 拦 `claim.self-endorsement` |
| 标成 `verified` 但只有一个来源 | 降级为 `reported` + 警告 |
| 纯观点（“这个镜头真好看”） | 放行，不要求证据 |
| 数字写成“约 300 人 / 300 人左右” | 放行（诚实的不精确好过编造的精确） |

### 证据等级

| 等级 | 什么时候用 | 要求 |
|---|---|---|
| `first-party` | 你自己测的、自己后台看到的 | 至少 1 条出处；允许绝对判断 |
| `verified` | 两个以上独立来源互相印证 | ≥ 2 个不同站点 |
| `reported` | 转述别人的报道 | 正文里必须有“据…/可能/尚未确认”之类 |
| `unverified`（默认） | 没核实的传闻 | 基本只能当观点写：不能有数字和绝对词 |

## 打分

自证分 0–100，按分项加权；不适用项从分母里去掉，不白送分。

| 分项 | 权重 | 满分的条件 |
|---|---|---|
| 证据 | 35 | 至少一条合法 http(s) 来源 |
| 引文锚定 | 20 | 引文与正文重叠 ≥ 10% |
| 数字 | 15 | 每个数字都能落回引文 |
| 措辞 | 10 | 没有绝对化措辞（或已升到 verified） |
| 语气 | 5 | 二手来源时有保留语气 |
| 披露 | 5 | 能看出是 AI 在说（`requireDisclosure` 开启时） |
| 信息量 | 10 | 去重后至少 5 个记号 |

断言默认 70 分及格，观点 60 分。

## 用法

```bash
# 只检查（拦截时给出解释与改法）
node bin/claim-gate.mjs check --text "该厂 9 月已确认裁员 300 人，可能涉及三个部门。" \
  -e "https://news.example.com/a|该厂 9 月确认裁员 300 人，涉及三个部门" --level reported

# 只看诊断，不消耗重试次数
node bin/claim-gate.mjs explain --text "……"

# 改到能过闸（软化绝对词、补披露），改动逐条回执
node bin/claim-gate.mjs fix --text "这一定是所有人的问题。" --disclose

# 真正的门：过闸才执行后面那条命令；重试要带回执
node bin/claim-gate.mjs guard -e "https://…|<原文>" --level reported \
  --ack "我漏了出处：原话是「据报」，我写成了「已经确认」" -- \
  node tools/bili.mjs comment --oid 1 --message "……" --go
```

记账相关参数：`--key`（话题键，默认从 `--bvid`/`--oid` 推断）、`--max-attempts`（默认 3）、`--window-minutes`（默认 15）、`--ledger`（覆盖账本路径）。

退出码：`0` 通过、`2` 拦截（或需人工）、`3` 用法错误。`--json` 输出完整结果，便于别的程序消费。

## 纠错回路：让它知道错在哪，而不是猜怎么过闸

只丢一个 `exit 2` 出去，最可能的结果是它把“一定”换成“可能”再发一遍——**那是顺从，不是理解**。所以拦截时给的不是错误码清单，是一次可执行的纠错：

```
[claim-gate] 拦截 · 第 1/3 次 · 自证分 18/70 · claim/unverified

为什么会拦
  你在陈述一件有真假的事，却没给读者任何能自己核对的东西。
  读者只能选择信你、或者不信你——评论区变成噪声，就是从这一步开始的。

这次具体哪不对
  ✗ evidence.missing：这是一条断言，但没有给出任何可核对的出处
  ✗ claim.absolute：证据等级是 unverified，却用了绝对化措辞：所有、彻底

可以怎么改（选一条，不用全做）
  A. 补证据：--evidence "<链接>|<原文至少 8 字>"
  B. 降级为转述：加“据报道/可能”，同时拿掉绝对判断
  C. 改成观点：只说你自己的感受，删掉数字和事实动词

还有 2 次机会；用完就停下来交给人。
```

配套三个机制，缺一个都会退化成“无限重试直到猜中”：

| 机制 | 作用 |
|---|---|
| **成本** | 同一话题（默认按 `--bvid`/`--oid` 记账）默认只给 3 次，超过就 `escalate`，不再判内容，直接交回给人 |
| **回执** | 第二次起必须带 `--ack "上一版错在哪、这次改了什么"`，缺了或太笼统都拦——**改对了但没交代，一样不放行** |
| **账本** | 追加式 JSONL（`~/.dsh/state/claim-gate/attempts.jsonl`），记录每次的判定、分数、证据数、回执，便于事后看它是“真改了”还是“在试阈值” |

实测一条完整的三步：

```
第 1 次  拦截 18/70 · 没出处 + 绝对词        → 不执行
第 2 次  内容已改对，自证分 100/70，但没回执  → 仍然不执行
第 3 次  同一份内容 + 回执                  → 通过，命令执行
```

注意第 2 次：**分数已经是 100 了，照样拦。** 闸门要的不是一份过得去的稿子，是“你知不知道自己刚才错在哪”。

`explain` 子命令可以只看诊断、不消耗次数也不写账本，适合人排查。

## 接到 dsh-bili-whale

两种接法，严格程度不同。

**接法一（推荐，不动装好的包）**：把发布命令包进 `guard`。

```bash
node <claim-gate>/bin/claim-gate.mjs guard \
  -e "<来源链接>|<引文>" --level reported \
  -- node <bili-whale>/tools/bili.mjs comment --oid 123 --bvid BVxxx \
     --message "……" --share --auto --reason "……" --score 15 --go
```

`guard` 从后面的命令里取出 `--message`，检查通过才真正执行；不通过时那条命令**一次都不会跑**——连网络请求都不会发出，也就不会有“发出去了再撤回”的尴尬。

**接法二（真正封死，需要改 3 行）**：在 `tools/commands/comment.mjs` 的 `--share` 分支之后加一段，让所有发布路径都过闸：

```js
import { check } from '<claim-gate>/lib/gate.mjs'
// ……在 message 已经确定、还没发请求的位置：
const verdict = check({
  text: message,
  evidence: String(args.get('evidence') ?? '').split(';;').filter(Boolean),
  level: args.get('level') ?? 'unverified',
})
if (verdict.verdict !== 'pass') {
  for (const issue of verdict.issues) console.error(`  ${issue.id}: ${issue.message}`)
  process.exit(2)
}
```

只有接法二能保证“绕不过去”。接法一靠的是**所有发布都走同一个入口**这个约定——约定一旦被绕过，闸门就只是一个建议。

## 配置

`cordis.patch.yml` 里的字段与 `lib/policy.mjs` 的 `DEFAULTS` 一一对应：

| 字段 | 默认 | 含义 |
|---|---|---|
| `minScore` | 70 | 断言及格线 |
| `opinionMinScore` | 60 | 观点及格线 |
| `requireEvidence` | true | 断言必须带证据 |
| `requireDisclosure` | false | 必须能看出是 AI 在说 |
| `strictDisclosure` | false | 缺披露直接拦（否则只警告） |
| `anchorRatio` | 0.1 | 引文与正文的最低重叠比例 |
| `minQuoteChars` | 8 | 引文最短字符数 |
| `minTextChars` | 6 | 正文最短字符数 |
| `maxTextChars` | 1000 | 平台上限 |
| `warnTextChars` | 220 | 超过就警告“评论区里偏长” |
| `allowEstimateNumbers` | true | “约/左右/近”可以放行 |
| `verifiedMinSources` | 2 | 标 verified 至少要几个不同站点 |
| `blockOnWarn` | false | 任何警告都不放行 |

也可以用 `--policy policy.json` 或环境变量 `CLAIM_GATE_POLICY` 指定外部策略文件。

## 安装

```powershell
# 从 GitHub 安装（推荐）
dsh plugin --profile desktop add https://github.com/xizhilang2012/dsh-claim-gate

# 或者装某个 Release 的打包文件
dsh plugin --profile desktop add https://github.com/xizhilang2012/dsh-claim-gate/releases/download/v0.1.0/dsh-claim-gate-0.1.0.tgz

# 本地开发：链接工作目录，改代码重载即生效
dsh plugin --profile desktop add "link:<插件目录>"
```

装完后：

- 命令行：`node <插件目录>\bin\claim-gate.mjs …`（包名 `dsh-claim-gate`，`bin` 里也注册了 `claim-gate`）
- 预检接口：`POST http://127.0.0.1:<端口>/dsh-claim-gate/check`，body `{ "text": "…", "evidence": ["url|引文"], "level": "reported" }`；`GET /dsh-claim-gate/policy` 返回当前策略
- 没有 `webServer` 的环境下插件不会报错，只是退化成纯命令行工具

## 边界（这些它做不到）

- **它是“防无来源的自信”，不是“防有来源的谎言”。** 来源真实、引文真实、但作者理解错了——闸门看不出来。
- **引文不做真伪校验。** 它只检查“引文和正文相关”和“数字出现在引文里”，不联网核对那段引文是否真的存在于那个页面。
- **观点/断言的分类是启发式的。** 短句、无数字、无事实动词的会当观点放行；反过来，把观点误判成断言只会让你多补一条证据，代价小。
- **数字只查“有没有出现”，不查“有没有被曲解”。** “裁员 300 人”和“扩招 300 人”在引文里都能对上 300。
- **它不替代平台规则、法律和人的判断。** 它只是一道很窄的门：至少让“我不知道我为什么这么说”这句话，发不出去。
- **回执不是理解的证明。** `--ack` 只要求“够具体 + 指向问题”，一个足够熟练的模型完全可以写出一段看不出破绽的回执。它的作用是把“假装理解”的成本抬高，并留下可供人复核的痕迹，而不是真的读心。
- **次数上限会误伤。** 记账按话题键聚合，同一话题下正常的多条发言也可能被算进同一预算；`--key` 可以手动分开。
- **不做身份认证。** “有 AI”几乎恒真，“AI 决定”不可验——一个永远返回 true 的检查没有意义。闸门只管“话能不能自证”，不管“说话的是谁”。身份与责任归属属于平台侧的问题，不该由 CLI 假装解决。

## 测试

```bash
node tests/gate.test.mjs
```

30 个用例，覆盖：无出处、伪链接、无关引文、数字落空、二手绝对化、自我背书、观点放行、`fix` 改写、CLI 退出码；“`guard` 拦下时命令确实没执行”、“改对了但没回执仍然拦”、“试满次数后停下交给人”、“`explain` 不写账本”、“据〈媒体〉报道算转述”、“一手数据可用单一内部来源”。

> 测试里的 CLI 子进程用文件描述符而不是管道接 stdout——DSH 沙箱下 `stdio: 'pipe'` 会 EPERM。

## 目录

```
claim-gate/
├── bin/claim-gate.mjs     命令行：check / explain / fix / guard
├── lib/text.mjs           分词、重叠度、数字、绝对词、分类
├── lib/policy.mjs         阈值与默认值
├── lib/gate.mjs           判定与打分（纯函数，无 IO）
├── lib/coach.mjs          把拦截翻译成解释、改法、回执校验
├── lib/ledger.mjs         尝试账本（谁试了几次）
├── index.js               Host 侧入口：预检路由
├── cordis.patch.yml       插件行与配置
└── tests/gate.test.mjs    30 个用例
```

MIT.
