/**
 * Build the card illustration used by README.md and the market listing.
 *
 * The chart itself is produced by the bundle's own data engine and option
 * builder (`__test.aggregate` / `__test.buildOption`), rendered by ECharts in
 * SSR-SVG mode — no hand-drawn mock data. The surrounding chrome mirrors the
 * card's real header, control bar and footer so readers recognise the product.
 *
 * Run: node scripts/demo-image.mjs   (writes assets/demo.html + assets/demo-chart.svg)
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
  __DSH_BOOT__: { entries: [{ id: 'dsh-chart-lab', rev: 'demo' }] },
}
/* zrender measures text through a 2D context even in SSR mode. */
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

/* --- sample dataset: this repository's own commit activity -------------- */
const rows = [
  ['10-19', '66-zhimeng', 3], ['10-19', 'search', 7],
  ['10-20', '66-zhimeng', 0], ['10-20', 'search', 14],
  ['10-21', '66-zhimeng', 0], ['10-21', 'search', 5],
  ['10-22', '66-zhimeng', 1], ['10-22', 'search', 13],
  ['10-23', '66-zhimeng', 17], ['10-23', 'search', 35],
  ['10-24', '66-zhimeng', 4], ['10-24', 'search', 36],
  ['10-25', '66-zhimeng', 3], ['10-25', 'search', 32],
  ['10-26', '66-zhimeng', 29], ['10-26', 'search', 29],
  ['10-27', '66-zhimeng', 7], ['10-27', 'search', 45],
  ['10-28', '66-zhimeng', 0], ['10-28', 'search', 28],
  ['10-29', '66-zhimeng', 0], ['10-29', 'search', 36],
  ['10-30', '66-zhimeng', 21], ['10-30', 'search', 9],
  ['10-31', '66-zhimeng', 0], ['10-31', 'search', 60],
  ['11-01', '66-zhimeng', 0], ['11-01', 'search', 35],
  ['11-02', '66-zhimeng', 9], ['11-02', 'search', 33],
  ['11-03', '66-zhimeng', 239], ['11-03', 'search', 44],
  ['11-04', '66-zhimeng', 41], ['11-04', 'search', 12],
  ['11-05', '66-zhimeng', 74], ['11-05', 'search', 5],
  ['11-06', '66-zhimeng', 57], ['11-06', 'search', 0],
  ['11-07', '66-zhimeng', 93], ['11-07', 'search', 35],
  ['11-08', '66-zhimeng', 9], ['11-08', 'search', 14],
].map(([日期, 作者, 提交数]) => ({ 日期, 作者, 提交数 }))

const state = {
  type: 'bar',
  x: '日期',
  y: ['提交数'],
  agg: 'sum',
  group: '作者',
  topN: 0,
  sort: 'none',
  stack: true,
  palette: 'ink',
  xName: '日期',
  yName: '提交数',
  filters: {},
  recipe: {},
}

const view = T.aggregate(rows, state)
const option = T.buildOption(view, state, false)

const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 1016, height: 404 })
chart.setOption(option)
const chartSvg = chart.renderToSVGString()
chart.dispose()

/* --- compose the card chrome around that real chart --------------------- */
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const chip = (label, on) => `<span class="chip${on ? ' on' : ''}">${esc(label)}</span>`
const group = (label, control) => `<span class="grp"><span class="lab">${esc(label)}</span>${control}</span>`

const bars = [
  chip('柱', true), chip('条'), chip('线'), chip('面'), chip('饼'), chip('环'), chip('散点'), chip('热力'),
].join('')
const controls = [
  group('维度', '<span class="sel">日期 ▾</span>'),
  group('配色', '<span class="sel">水墨丹青 ▾</span>'),
  group('指标', chip('提交数', true)),
  group('分组', '<span class="sel">作者 ▾</span>'),
  group('排序', '<span class="sel">原序 ▾</span>'),
  chip('堆叠', true),
].join('')

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:28px;background:#eef1f5;font:13px/1.5 -apple-system,"SF Pro Text","PingFang SC",sans-serif;color:#1f2329}
.card{width:1080px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:16px;overflow:hidden;box-shadow:0 18px 48px -24px rgba(15,23,42,.35)}
.head{display:flex;align-items:baseline;gap:10px;padding:16px 20px 8px}
.title{font-size:15px;font-weight:650}
.note{font-size:11.5px;color:#6b7278;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src{font-size:11px;color:#8e969e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 20px 10px}
.chip{font-size:11.5px;padding:3px 8px;border-radius:7px;border:.5px solid rgba(0,0,0,.12);color:#3a3f45;background:#fff}
.chip.on{background:#eef3ff;border-color:#b7c9f5;color:#1d4ed8;font-weight:600}
.grp{display:inline-flex;align-items:center;gap:5px;margin-left:4px}
.lab{font-size:11px;color:#8e969e}
.sel{font-size:11.5px;padding:3px 8px;border-radius:7px;border:.5px solid rgba(0,0,0,.12);color:#3a3f45;background:#fbfcfd}
.chart{padding:0 12px}
.foot{display:flex;justify-content:space-between;padding:8px 20px 12px;font-size:11px;color:#8e969e;border-top:.5px solid rgba(0,0,0,.07)}
</style></head><body>
<div class="card">
  <div class="head"><span class="title">提交活动 · 最近 21 天</span><span class="note">git log --all，按作者堆叠；卡片内可换类型、聚合、筛选并导出 CSV / PNG</span><span class="src">.dsh-chart-lab/commit-activity.csv</span></div>
  <div class="bar">${bars}<span style="width:10px"></span>${controls}</div>
  <div class="chart">${chartSvg}</div>
  <div class="foot"><span>42 行 × 3 列</span><span>本地计算 · 不产生模型往返</span></div>
</div>
</body></html>`

writeFileSync(join(root, 'assets', 'demo-chart.svg'), chartSvg)
writeFileSync(join(root, 'assets', 'demo.html'), html)
console.log('wrote assets/demo-chart.svg and assets/demo.html')
