/**
 * Node-side harness for the browser half's data engine. The card's whole
 * value proposition is that these functions replace a model round-trip, so
 * they are the part that has to be provably right. No DOM needed: the
 * engine is pure.
 *
 * Run: node scripts/test-client.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/* Stand in for the browser globals the bundle touches at registration time. */
let handoff = null
globalThis.window = {
  __ModuleLoader__: { load: (h) => { handoff = h } },
  __DSH_BOOT__: { entries: [{ id: 'dsh-chart-lab', rev: 'test' }] },
}
globalThis.document = { querySelector: () => ({}), createElement: () => ({ setAttribute() {} }), head: { appendChild() {} } }

const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
/* eslint-disable-next-line no-new-func */
new Function(source)()

/** Minimal React surface the bundle touches at materialization time.
 * `Component` matters: the error boundary subclasses it as the module body
 * runs, so a stub without it fails the whole bundle load. */
function FakeComponent(props) { this.props = props }
FakeComponent.prototype.setState = function () {}
const fakeReact = {
  createElement: () => null, Component: FakeComponent,
  useState: () => [null, () => {}], useMemo: (f) => f(), useRef: () => ({ current: null }),
  useEffect: () => {}, useCallback: (f) => f,
}
const exportsObj = handoff.factory((spec) => {
  if (spec === 'react') return fakeReact
  throw new Error('unexpected require: ' + spec)
})
const T = exportsObj.__test

let passed = 0
let failed = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed += 1; console.log('  ✓ ' + name); return }
  failed += 1
  console.log('  ✗ ' + name + '\n      期望 ' + e + '\n      实际 ' + a)
}

const rows = [
  { region: '华东', product: 'A', qty: 10, price: 2 },
  { region: '华东', product: 'B', qty: 5, price: 4 },
  { region: '华北', product: 'A', qty: 7, price: 2 },
  { region: '华北', product: 'B', qty: 3, price: 9 },
  { region: '华南', product: 'A', qty: 20, price: 1 },
]
const base = { x: 'region', y: ['qty'], agg: 'sum', group: '', topN: 0, sort: 'none', type: 'bar' }

console.log('\n[聚合]')
check('sum 按维度折叠', T.aggregate(rows, base), { categories: ['华东', '华北', '华南'], series: [{ name: 'qty', data: [15, 10, 20] }], total: 3 })
check('total 是截断前的类数', T.aggregate(rows, { ...base, sort: 'desc', topN: 2 }).total, 3)
check('avg', T.aggregate(rows, { ...base, agg: 'avg' }).series[0].data, [7.5, 5, 20])
check('max', T.aggregate(rows, { ...base, agg: 'max' }).series[0].data, [10, 7, 20])
check('median 偶数个取中值', T.aggregate(rows, { ...base, x: 'product', agg: 'median' }).series[0].data, [10, 4])
check('count 计行数', T.aggregate(rows, { ...base, agg: 'count' }).series[0].data, [2, 2, 1])
check('无指标时回落到行数', T.aggregate(rows, { ...base, y: [], agg: 'count' }).series[0].name, '行数')
check('多指标各成系列', T.aggregate(rows, { ...base, y: ['qty', 'price'] }).series.map(s => s.name), ['qty', 'price'])

console.log('\n[排序与 Top-N]')
check('降序', T.aggregate(rows, { ...base, sort: 'desc' }).categories, ['华南', '华东', '华北'])
check('升序', T.aggregate(rows, { ...base, sort: 'asc' }).categories, ['华北', '华东', '华南'])
check('Top-2 在排序后截断', T.aggregate(rows, { ...base, sort: 'desc', topN: 2 }).categories, ['华南', '华东'])
check('Top-N 数据同步截断', T.aggregate(rows, { ...base, sort: 'desc', topN: 2 }).series[0].data, [20, 15])

console.log('\n[分组拆系列]')
const grouped = T.aggregate(rows, { ...base, group: 'product' })
check('系列 = 分组值', grouped.series.map(s => s.name), ['A', 'B'])
check('缺失组合补 null', grouped.series[1].data, [5, 3, null])

console.log('\n[筛选]')
check('空筛选不动数据', T.applyFilters(rows, {}).length, 5)
check('空数组不算筛选', T.applyFilters(rows, { region: [] }).length, 5)
check('单列包含筛选', T.applyFilters(rows, { region: ['华东'] }).length, 2)
check('多列取交集', T.applyFilters(rows, { region: ['华东', '华北'], product: ['A'] }).length, 2)

console.log('\n[原始模式与类型]')
check('agg=none 一行一点', T.aggregate(rows, { ...base, agg: 'none' }).series[0].data, [10, 5, 7, 3, 20])
check('数字字符串可折叠', T.aggregate([{ k: 'x', v: '3' }, { k: 'x', v: '4' }], { ...base, x: 'k', y: ['v'] }).series[0].data, [7])
check('非数字被跳过', T.aggregate([{ k: 'x', v: 'N/A' }, { k: 'x', v: 5 }], { ...base, x: 'k', y: ['v'] }).series[0].data, [5])
check('null 维度显示为 (空)', T.label(null), '(空)')

console.log('\n[recipe]')
const good = T.evalRecipe('t.js', 'return { controls: [{id:"n",kind:"slider",value:3}], transform({rows,state,h}) { return rows.filter(r => r.qty >= state.n) } }')
check('解析出控件', good.controls.length, 1)
check('transform 可用', good.transform({ rows, state: { n: 7 }, h: T.helpers }).length, 3)
check('无错误', good.error, null)
const bad = T.evalRecipe('bad.js', 'return notDefined')
check('坏 recipe 不抛出', bad.error !== null, true)
check('坏 recipe 降级为空控件', bad.controls, [])
const nonObject = T.evalRecipe('n.js', 'return 42')
check('非对象 recipe 被拒', nonObject.error !== null, true)

console.log('\n[助手]')
check('h.sum 忽略非数字', T.helpers.sum([1, '2', null, 'x', 3]), 6)
check('h.median', T.helpers.median([5, 1, 3]), 3)
check('h.groupBy', [...T.helpers.groupBy(rows, 'region').keys()], ['华东', '华北', '华南'])
check('h.fmt 整数不补零', T.helpers.fmt(7), '7')
check('h.fmt 小数保留两位', T.helpers.fmt(7.129), '7.13')
check('h.uniq', T.helpers.uniq([1, 1, 2]), [1, 2])

console.log('\n[ECharts 配置]')
const view = T.aggregate(rows, base)
check('柱状图轴向', T.buildOption(view, { ...base, type: 'bar' }, false).xAxis.type, 'category')
check('条形图轴向翻转', T.buildOption(view, { ...base, type: 'hbar' }, false).yAxis.type, 'category')
check('饼图产出 pie 系列', T.buildOption(view, { ...base, type: 'pie' }, false).series[0].type, 'pie')
check('面积图带 areaStyle', T.buildOption(view, { ...base, type: 'area' }, false).series[0].areaStyle.opacity, 0.22)
check('堆叠生效', T.buildOption(view, { ...base, type: 'bar', stack: true }, false).series[0].stack, 'total')
check('中文分类原样进配置', T.buildOption(view, { ...base, type: 'bar' }, false).xAxis.data, ['华东', '华北', '华南'])
const wide = T.aggregate(Array.from({ length: 40 }, (_, i) => ({ region: 'r' + i, qty: i })), base)
check('多分类时自动加 dataZoom', T.buildOption(wide, base, false).dataZoom.length, 2)

console.log('\n[规模]')
const big = Array.from({ length: 50000 }, (_, i) => ({ region: 'r' + (i % 200), qty: i % 97 }))
const t0 = process.hrtime.bigint()
const bigView = T.aggregate(big, { ...base, sort: 'desc', topN: 20 })
const ms = Number(process.hrtime.bigint() - t0) / 1e6
check('5 万行折叠出 20 类', bigView.categories.length, 20)
console.log('  · 5 万行聚合耗时 ' + ms.toFixed(1) + ' ms（每次点击的实际成本）')

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项失败') + '：' + passed + ' passed, ' + failed + ' failed\n')
process.exit(failed === 0 ? 0 : 1)
