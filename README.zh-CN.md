# dsh-chart-lab

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的可交互 ECharts 数据卡片插件。

**一句话**：数据由 host 从工作区读取，卡片在浏览器里算——**点按钮不花 token，也不产生模型往返**。

[English](README.md) | 中文

## 为什么做这个

生成式 UI 插件通常把每一次交互都送回模型：点一次按钮 = 一次完整模型调用 + 整卡重生成 + 历史累积。做表单尚可，用来**探索**一张图表就是灾难。

`chart_lab` 把两个受众彻底分开：

| | 模型看到 | 卡片看到 |
| --- | --- | --- |
| `execute()` 之后 | 一行摘要（约 220 字节） | 完整数据集 |
| 每次交互 | 什么都没有 | 一次本地重算（5 万行约 5 ms） |

所以 5 万行的文件只花模型十几个 token；换图表类型、换维度、筛选、改聚合，全程不惊动模型。

## 机制

```
模型  ──chart_lab({file, recipe, chart})──▶  host（node）
                                              │  execute(): 读文件、解析、推断列型
                                              │
       ◀── render(): 一行摘要 ────────────────┤
                                              │
       presentationMeta(args, value) ─────────┴──▶ 完整数据集 + recipe 源码
                                                            │
                                                            ▼
                                        浏览器：keyed `tool.call.toolview`
                                        （此后全部本地）
```

关键在 `output.presentationMeta(args, value)` 的**第二个参数**：它拿得到 `execute()` 的返回值，因此 host 可以把一份模型永远看不到的载荷直接交给浏览器；而 `output.render` 把同一个结果收窄成进入提示词的那一行。

## 安装

```sh
dsh plugin --profile web add github:66-zhimeng/dsh-chart-lab
```

（尚未发布到 npm；发布后 `dsh plugin --profile web add dsh-chart-lab` 同样可用。）

然后确认 `$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles` 里有 `dsh-chart-lab`（`dsh plugin add` 通常会自动补上），重启 `dsh web`。

想改代码的话，克隆后用 link 安装：

```sh
git clone https://github.com/66-zhimeng/dsh-chart-lab
cd dsh-chart-lab && npm install
dsh plugin --profile web add link:$PWD
```

需要 Node ≥ 22。ECharts 是普通依赖，由包管理器安装、经插件自己的路由按需下发，**不会打进客户端主 bundle**。

## 工具参数

| 参数 | 说明 |
| --- | --- |
| `file` | 工作区内的数据文件：`.json` / `.ndjson` / `.jsonl` / `.csv` / `.tsv`。**首选**——不进入模型上下文 |
| `pick` | JSON 文档内的点分路径，如 `"result.series"` |
| `rows` | 内联行数组，仅限几十行 |
| `url` | 由 host 端抓取的 JSON 接口 |
| `recipe` | 工作区内的 JS 功能代码路径，用来加自定义控件与本地处理 |
| `chart` | 初始视图：`{type, x, y[], agg, group, topN, sort, stack, xName, yName, unit}` |
| `title` / `note` | 卡片标题与副说明 |

路径不得越出工作区根目录（`dsh` 启动时所在的目录）。

支持的文档形状：数组、`{rows|data|items|records|list|result: [...]}` 包装、列式 `{a: [...], b: [...]}`、单条记录。

## 卡片能做什么——全部本地

图表类型（柱 / 条 / 线 / 面 / 饼 / 环 / 散点 / 热力 / 表格）· 维度 · 指标多选 · 聚合（求和 / 平均 / 计数 / 中位 / 最大 / 最小 / 原始）· 分组拆系列 · 分类筛选 chips · 排序 · Top-N · 堆叠 · 平滑 · 拖拽调高 · 导出 CSV / PNG · 重置。

ECharts 另外白送：图例点击开关、带十字准星的 tooltip；分类超过 24 个时自动出现滚轮/拖拽缩放与滑块。

坐标轴标题**从所选列自动推导**，因此跟着下拉框走，不需要模型参与。列名里写了单位——`产量(吨)`、`能耗(kWh)`、`latency[ms]`——会被自动识别并附到轴名和 tooltip 上；`chart.unit` 可覆盖。

卡片状态按工具调用 id 持久化，滚动移出视口再回来不会丢。

## Recipe：放在项目里的功能代码

recipe 是你自己仓库里的一个 JS 文件（惯例放 `.dshviz/recipes/*.js`）。它是一段**函数体**，`return` 一个对象：

```js
return {
  controls: [
    { id: 'win',     kind: 'select', label: '窗口', options: [['3', '3 天'], ['7', '7 天']], value: '3' },
    { id: 'showVal', kind: 'toggle', label: '数值', value: false },
    { id: 'floor',   kind: 'slider', label: '下限', min: 0, max: 100, step: 5, value: 0 },
    { id: 'redo',    kind: 'button', label: '重算' },   // 值是递增计数器
  ],
  transform({ rows, controls, state, columns, h }) { return rows },      // 可选
  option({ option, rows, view, controls, state, h }) { return option },  // 可选
}
```

- `controls`——本 recipe 控件的当前值，**优先用它**而不是 `state`。
- `state`——内置视图状态，并叠加了 `controls`。
- `h`——`sum / avg / median / min / max / num / label / uniq / groupBy / parseDate / fmt`。
- 两个函数都在浏览器里跑，拖动控件只重跑它们。
- 抛异常不会白屏：`transform` 出错退回未处理的数据并在卡片顶部告警，`option` 出错退回内置配置。

**保留的控件 id**——`type`、`x`、`y`、`agg`、`group`、`topN`、`sort`、`stack`、`smooth`、`filters`、`view`、`height`。这些是内置控件的名字，重名会在 `state` 里覆盖它们，让对应的内置按钮**看起来失灵**（卡片会告警）。切换图表类型、平滑、堆叠、筛选、Top-N、排序、聚合内置都已有按钮，recipe 只该写它们覆盖不到的东西。

可直接运行的示例见 [`examples/`](examples/)。

## 开发

无构建步骤，`lib/*.js` 就是运行的代码。node 半是 ESM；client 半是手写的、包在 `__ModuleLoader__.load` 里的 CJS，因此可以像其他已安装的 dsh 插件一样原地打补丁。

```sh
npm install
npm test        # 42 项数据引擎断言 + 16 项 jsdom 交互断言
```

`scripts/test-client.mjs` 覆盖聚合管线、recipe 求值与配置生成。`scripts/test-interaction.mjs` 在 jsdom 里挂载真实卡片、点击控件，断言图表**确实被重画**——正是这套用例能抓住「按钮高亮了但什么也没发生」。

## 限制

- 单卡上限 20 万行，超出会均匀抽样并在卡片上标注。
- 数据集作为结果节点的 `meta` 随会话日志持久化，因此刷新页面卡片仍可用；但极大的数据集会让日志变大。
- recipe 是可信的项目代码，用 `new Function` 执行，不做沙箱。
- 不支持 SQL 数据源：先导出成文件，或用 `url` 接一个已有接口。

## 许可证

MIT。ECharts 以 Apache-2.0 作为依赖引入，本仓库不转发其产物。
