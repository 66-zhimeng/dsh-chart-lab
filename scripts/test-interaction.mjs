/**
 * Interaction test: drive the real card in jsdom, click the built-in
 * controls, and assert that each one actually redraws the chart.
 *
 * This is the suite that would have caught the shipped bug where a recipe
 * control named `type` shadowed the built-in chart-type state, leaving every
 * built-in button highlighted but inert.
 *
 * Run: npm test   (or: node scripts/test-interaction.mjs)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'requestAnimationFrame', 'ResizeObserver', 'MouseEvent', 'getComputedStyle']) {
  if (dom.window[key] !== undefined) globalThis[key] = dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

/* Fake ECharts: record exactly what the card asks it to draw. */
const calls = []
const fakeInstance = { setOption: opt => calls.push(opt), resize() {}, dispose() {}, getDataURL: () => 'data:,' }
dom.window.echarts = { init: () => fakeInstance, getInstanceByDom: () => undefined, version: 'fake' }

let handoff = null
dom.window.__ModuleLoader__ = { load: h => { handoff = h } }
dom.window.__DSH_BOOT__ = { entries: [] }
new Function('window', 'document', clientSource)(dom.window, dom.window.document)
const { ChartLabToolView } = handoff.factory((spec) => {
  if (spec === 'react') return React
  throw new Error('unexpected require: ' + spec)
}).__test

const { inferColumns } = await import('../lib/dataset.js')

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) { passed += 1; console.log('  ✓ ' + name); return }
  failed += 1
  console.log('  ✗ ' + name + (detail === undefined ? '' : '\n      ' + detail))
}

const rows = [
  { 周次: '第1周', 产量: 310, '能耗(kWh)': 88 },
  { 周次: '第2周', 产量: 345, '能耗(kWh)': 92 },
  { 周次: '第3周', 产量: 305, '能耗(kWh)': 84 },
  { 周次: '第4周', 产量: 380, '能耗(kWh)': 95 },
]
const columns = inferColumns(rows)

/** Mount a card, optionally with a recipe, and return DOM helpers. */
async function mount(recipe) {
  calls.length = 0
  const host = document.createElement('div')
  document.body.appendChild(host)
  const block = {
    callId: 'call-' + Math.random().toString(36).slice(2),
    meta: {
      v: 1, title: '交互测试', note: '', source: { label: 'inline', total: rows.length },
      columns, rows,
      chart: { type: 'bar', x: '周次', y: ['产量'], agg: 'sum', group: '', topN: 0, sort: 'none', stack: false },
      recipe: recipe ?? null,
    },
  }
  const reactRoot = createRoot(host)
  await act(async () => {
    reactRoot.render(React.createElement(ChartLabToolView, { toolName: 'chart_lab', block, callId: block.callId }))
  })
  return {
    host,
    async click(text) {
      const button = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
      if (button === undefined) return null
      const before = calls.length
      await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      return { drew: calls.length > before, option: calls[calls.length - 1] }
    },
  }
}

const seriesType = opt => (opt && Array.isArray(opt.series) && opt.series[0] ? opt.series[0].type : undefined)
const catCount = (opt) => {
  if (opt === undefined) return -1
  if (opt.xAxis && Array.isArray(opt.xAxis.data)) return opt.xAxis.data.length
  if (Array.isArray(opt.series) && opt.series[0] && Array.isArray(opt.series[0].data)) return opt.series[0].data.length
  return -1
}

console.log('\n[内置控件必须真的重画图表]')
{
  const card = await mount()
  check('首次渲染即绘制', calls.length === 1 && seriesType(calls[0]) === 'bar')
  for (const [text, expected] of [['线', 'line'], ['面', 'line'], ['饼', 'pie'], ['环', 'pie'], ['散点', 'scatter'], ['柱', 'bar']]) {
    const result = await card.click(text)
    check('点「' + text + '」→ series.type=' + expected,
      result !== null && result.drew && seriesType(result.option) === expected,
      result === null ? '按钮不存在' : '实际 ' + seriesType(result.option) + (result.drew ? '' : '（且未重画）'))
  }
  const stacked = await card.click('堆叠')
  check('点「堆叠」生效', stacked !== null && stacked.drew && stacked.option.series[0].stack === 'total')
}

console.log('\n[筛选必须同时改数据和图]')
{
  const card = await mount()
  const before = catCount(calls[calls.length - 1])
  const chip = await card.click('第1周')
  check('筛选前 ' + before + ' 类 → 筛选后 1 类',
    chip !== null && chip.drew && catCount(chip.option) === 1,
    chip === null ? '找不到筛选 chip' : '实际 ' + catCount(chip.option) + ' 类')
  const footer = card.host.querySelector('.cl-foot')
  check('页脚行数与图一致', footer !== null && footer.textContent.replace(/\s+/g, '').startsWith('1/4'),
    footer === null ? '无页脚' : footer.textContent.replace(/\s+/g, ' ').slice(0, 30))
}

console.log('\n[recipe 控件重名必须告警，且不再让内置失灵]')
{
  const colliding = { path: 'bad.js', code: 'return { controls: [{ id: "type", kind: "select", options: ["bar","line"], value: "bar" }] }' }
  const card = await mount(colliding)
  const warn = [...card.host.querySelectorAll('.cl-warn')].map(n => n.textContent).join(' ')
  check('重名 id 触发告警', warn.includes('type') && warn.includes('同名'), warn === '' ? '无告警' : warn.slice(0, 80))
}
{
  const clean = {
    path: 'ok.js',
    code: 'return { controls: [{ id: "showVal", kind: "toggle", value: false }],'
      + ' option({ option, controls }) { for (const s of option.series) s.label = { show: !!controls.showVal }; return option } }',
  }
  const card = await mount(clean)
  const warn = [...card.host.querySelectorAll('.cl-warn')].map(n => n.textContent).join(' ')
  check('无重名时不告警', warn === '')
  const result = await card.click('线')
  check('有 recipe 时内置按钮仍生效', result !== null && result.drew && seriesType(result.option) === 'line',
    result === null ? '按钮不存在' : '实际 ' + seriesType(result.option))
}

console.log('\n[坐标轴标题跟随所选列]')
{
  const card = await mount()
  const opt = calls[calls.length - 1]
  check('横轴取维度列名', opt.xAxis !== undefined && opt.xAxis.name === '周次', String(opt.xAxis && opt.xAxis.name))
  check('纵轴取指标列名', opt.yAxis !== undefined && opt.yAxis.name === '产量', String(opt.yAxis && opt.yAxis.name))
  const swap = await card.click('能耗(kWh)')
  check('换指标后纵轴带单位', swap !== null && String(swap.option.yAxis.name).includes('kWh'),
    swap === null ? '找不到指标 chip' : String(swap.option.yAxis.name))
}

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项失败') + '：' + passed + ' passed, ' + failed + ' failed\n')
process.exit(failed === 0 ? 0 : 1)
