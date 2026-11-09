/**
 * Render one gallery page covering every chart form the card supports.
 *
 * Panels use the bundle's own `aggregate` / `buildOption`, so each chart is the
 * real thing the card draws — only the surrounding shell is trimmed down for a
 * compact overview. Palette is varied per panel to show the colour schemes too.
 *
 * Run: node scripts/gallery.mjs && swift scripts/snapshot.swift assets/gallery.html assets/gallery.png 1240 1120 2
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as echarts from 'echarts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/* --- load the browser bundle the way the Node test harness does ---------- */
let handoff = null
globalThis.window = {
  __ModuleLoader__: { load: (h) => { handoff = h } },
  __DSH_BOOT__: { entries: [{ id: 'dsh-chart-lab', rev: 'gallery' }] },
}
const fakeContext = { font: '', measureText: (text) => ({ width: String(text).length * 7 }) }
globalThis.document = {
  querySelector: () => ({}),
  createElement: (tag) => (tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => fakeContext, setAttribute() {} }
    : { setAttribute() {} }),
  head: { appendChild() {} },
}
function FakeComponent(props) { this.props = props }
FakeComponent.prototype.setState = function () {}
const fakeReact = {
  createElement: () => null,
  Component: FakeComponent,
  useState: () => [null, () => {}],
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useCallback: (fn) => fn,
}
new Function(readFileSync(join(root, 'lib', 'client.js'), 'utf8'))()
const bundle = handoff.factory((spec) => {
  if (spec === 'react') return fakeReact
  throw new Error('unexpected require: ' + spec)
})
const T = bundle.__test

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* --- datasets ----------------------------------------------------------- */
const week = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const daily = []
week.forEach((day, index) => {
  daily.push({ 日期: day, 线路: 'A 线', 产量: 320 + (index % 3) * 45, 能耗: 88 + (index % 2) * 9 })
  daily.push({ 日期: day, 线路: 'B 线', 产量: 260 + (index % 4) * 38, 能耗: 74 + (index % 3) * 7 })
})
const regions = [
  { 地区: '华东', 份额: 38 }, { 地区: '华北', 份额: 24 }, { 地区: '华南', 份额: 17 },
  { 地区: '西南', 份额: 12 }, { 地区: '东北', 份额: 9 },
]
const machines = [
  { 设备: '注塑机', 负载: 82, 温度: 61 }, { 设备: '空压机', 负载: 64, 温度: 54 },
  { 设备: '冷冻机', 负载: 91, 温度: 47 }, { 设备: '水泵', 负载: 38, 温度: 42 },
  { 设备: '风机', 负载: 55, 温度: 39 },
]
const slots = []
;['早班', '中班', '夜班'].forEach((shift, shiftIndex) => {
  ;['A 线', 'B 线', 'C 线'].forEach((line, lineIndex) => {
    slots.push({ 班次: shift, 线路: line, 产出: 24 + shiftIndex * 29 + lineIndex * 13 })
  })
})

/* --- panel helpers ------------------------------------------------------ */
function chartSvg(rows, state, width, height) {
  const view = T.aggregate(rows, state)
  const option = T.buildOption(view, state, false)
  // A still cannot play ECharts' entrance animation: the emitted keyframes set
  // `transform`, which overrides each symbol's own transform attribute and
  // collapses scatter points onto the origin. Canvas (the live card) is fine.
  option.animation = false
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  chart.setOption(option)
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

const panels = [
  {
    title: '柱状 · 按线路堆叠', note: 'bar · group · stack', palette: 'ink',
    body: chartSvg(daily, { type: 'bar', x: '日期', y: ['产量'], agg: 'sum', group: '线路', stack: true, palette: 'ink', xName: '日期', yName: '产量(件)', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '条形 · 横向比较', note: 'hbar', palette: 'default',
    body: chartSvg(daily.filter((row) => row.线路 === 'A 线'), { type: 'hbar', x: '日期', y: ['产量'], agg: 'sum', group: '', palette: 'default', xName: '日期', yName: '产量(件)', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '折线 · 双指标', note: 'line · 2 metrics', palette: 'celadon',
    body: chartSvg(daily.filter((row) => row.线路 === 'A 线'), { type: 'line', x: '日期', y: ['产量', '能耗'], agg: 'sum', group: '', smooth: true, palette: 'celadon', xName: '日期', yName: '数值', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '面积 · 分线路', note: 'area · stack', palette: 'morandi',
    body: chartSvg(daily, { type: 'area', x: '日期', y: ['产量'], agg: 'sum', group: '线路', stack: true, smooth: true, palette: 'morandi', xName: '日期', yName: '产量(件)', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '饼图 · 地区份额', note: 'pie', palette: 'dunhuang',
    body: chartSvg(regions, { type: 'pie', x: '地区', y: ['份额'], agg: 'sum', group: '', palette: 'dunhuang', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '环图 · 设备占比', note: 'donut', palette: 'vivid',
    body: chartSvg(machines, { type: 'donut', x: '设备', y: ['负载'], agg: 'sum', group: '', palette: 'vivid', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '散点 · 负载分布', note: 'scatter', palette: 'ink',
    body: chartSvg(machines, { type: 'scatter', x: '设备', y: ['负载', '温度'], agg: 'sum', group: '', palette: 'ink', xName: '设备', yName: '数值', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '热力 · 班次 × 线路', note: 'heatmap', palette: 'celadon',
    body: chartSvg(slots, { type: 'heatmap', x: '班次', y: ['产出'], agg: 'sum', group: '线路', palette: 'celadon', filters: {}, recipe: {} }, 372, 236),
  },
  {
    title: '表格 · 原始行', note: 'table',
    body: `<div class="cl-tblwrap" style="max-height:236px"><table class="cl-tbl"><thead><tr><th>日期</th><th>线路</th><th>产量</th><th>能耗</th></tr></thead><tbody>${
      daily.slice(0, 6).map((row) => `<tr><td>${esc(row.日期)}</td><td>${esc(row.线路)}</td><td>${row.产量}</td><td>${row.能耗}</td></tr>`).join('')
    }</tbody></table></div>`,
  },
]

const grid = panels.map((panel) => `
  <section class="panel">
    <header class="panel-head"><span class="panel-title">${esc(panel.title)}</span><span class="panel-note">${esc(panel.note)}</span></header>
    <div class="panel-body">${panel.body}</div>
  </section>`).join('')

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
html,body{margin:0;background:#f6f7f9;color:#1f2329}
body{padding:28px;font:13px/1.5 -apple-system,"SF Pro Text","PingFang SC",system-ui,sans-serif}
h1{font-size:16px;font-weight:650;margin:0 0 4px}
.sub{color:#6b7278;font-size:12px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.panel{background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:16px;padding:14px 14px 10px;box-shadow:0 16px 40px -30px rgba(15,23,42,.5)}
.panel-head{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}
.panel-title{font-size:12.5px;font-weight:600}
.panel-note{color:#8b929a;font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.panel-body{height:236px}
.panel-body svg{display:block;width:100%;height:100%}
${T.CSS}
</style></head><body>
<h1>dsh-chart-lab · 图表形式总览</h1>
<div class="sub">九种输出形式，全部来自插件自身的 aggregate / buildOption（ECharts SSR 渲染）；配色随面板切换。</div>
<div class="grid">${grid}</div>
</body></html>`

writeFileSync(join(root, 'assets', 'gallery.html'), html)
console.log('wrote assets/gallery.html')
