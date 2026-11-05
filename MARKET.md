# 上架材料（dsh-claim-gate）

这份文件是给插件市场用的：卡片文案、提交步骤、待办。README 是给用户看的，这里是给上架流程看的。

---

## 一、市场卡片文案

**名称**：`dsh-claim-gate`

**一句话（卡片标题下的那行，≤ 40 字）**

> 发出去之前，先自证：断言要出处，数字要落地，语气要配得上证据。

**卡片正文（三行，超过会被折叠）**

> 三问决定发不发：出处呢？引文真的支持这句话吗？语气配得上证据吗？
> 不过闸就不执行后面的发布命令，而不是发了再撤回。
> 拦下时会说明错在哪、可以怎么改；第二次提交必须带回执。

**关键词**：`dsh-plugin` `fact-check` `evidence` `agent` `自证`

**截图建议**（我没有截图能力，需要你截）
1. 终端里被拦的那一屏（红字 `[claim-gate] 拦截 · 18/70`）
2. 补上出处后通过的一屏（绿字 `通过 · 100/70`）
3. `claim-gate check --json` 的输出，证明它是确定性的、可编程的

---

## 二、这个插件是什么形态（上架前必须知道）

它**没有设置页**，也没有客户端 UI。全部能力在命令行：

```
claim-gate check / explain / fix / guard
```

装进 DSH 之后只多两件事：

- 一个本地 HTTP 预检接口 `POST /dsh-claim-gate/check`
- 一行启动日志

也就是说：**市场里它属于“工具类 / CLI 类”插件，不是“界面类”。** 如果市场对没有 UI 的插件有单独分区，按那个放。

---

## 三、提交路径（按市场现状）

市场的索引是 `dsh-plugin-catalog` 这个 npm 包里的 `index.json`（format 1），镜像在
`awesome-dsh-plugin.com/index.json` 与 `dshmarket.com/index.json`。宿主按名字或仓库地址安装：

```
dsh plugin --profile <profile> add dsh-claim-gate          # npm 名
dsh plugin --profile <profile> add https://github.com/<you>/dsh-claim-gate
```

所以上架 = **让它出现在索引里**。步骤：

1. **建公开仓库**，把 `plugins/claim-gate/` 推上去（`package.json` 里补 `repository` 字段）。
2. **打 tag 发 Release**，附一个打包好的 `dsh-claim-gate-0.1.0.tgz`（`npm pack` 生成）。
3. **提交到目录**：给 `dsh-plugin-catalog` 的维护方提 PR / issue，附上仓库地址与一句话简介。
   （这一步的具体入口我没法替你确认——README 里只写了索引在哪，没写怎么收录。）
4. **可选**：直接发布到 npm（`npm publish`），这样 `dsh plugin add dsh-claim-gate` 就能直接装。

---

## 四、我改了什么（为了让它可以上架）

| 项 | 之前 | 现在 |
|---|---|---|
| 包名 | `@local/dsh-claim-gate` | `dsh-claim-gate`（公开名，能装能索引） |
| `private` | `true` | 已移除（`private` 会挡住 npm 发布） |
| 描述 | 一句话 60+ 字 | 压到 32 字，适合卡片 |
| `keywords` | 无 | 5 个，含 `dsh-plugin` |
| `author` | 无 | `xizhilang_2012` |
| `LICENSE` | 只有字段 | 补了完整 MIT 文本 |
| `icon.svg` | 无 | 方角蓝底 + 门 + 勾 |
| `files` | 6 项 | 补 `LICENSE` / `icon.svg` / `MARKET.md` |

**没改**：代码、测试、README 的技术内容。30 个测试仍然全部通过。

---

## 五、上架前还差的四样（都需要你）

- [ ] **GitHub 仓库地址** —— 我不知道你的账号，`package.json` 里故意没填 `repository`，宁可缺也不填假地址。
- [ ] **截图** —— 上面列的三个画面。
- [ ] **npm 账号 / GitHub 网络** —— 这个 shell 连不上外网（`Invoke-WebRequest` 直接失败），发布动作我做不了。
- [ ] **决定要不要 UI** —— 市场里绝大多数插件有设置页；它是纯 CLI。加一个设置页是可行的（读写策略 JSON），但那是另一个功能，不是上架必需的。

---

## 六、一句话简介的三个备选

1. 发出去之前，先自证。**（最稳，和片名一致）**
2. 说不清凭什么，就别发。**（最冲，适合做封面）**
3. 给 AI 的嘴装一道闸：没有出处的话，发不出去。**（信息量最大，但长）**
