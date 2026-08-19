// chart_lab recipe 示例 2：本地数据处理 + 派生指标 + 参考线。
//
// 演示 transform()：在浏览器里重算数据。用户拖动「平滑窗口」「最近 N 期」
// 时只重跑这个函数，不回到模型。
//
// 用法：
//   chart_lab({
//     title: "产量趋势",
//     file: "examples/data/weekly-output.json",
//     recipe: "examples/recipes/moving-average.js",
//     chart: { type: "line", x: "周次", y: ["产量(吨)"], agg: "sum" }
//   })
return {
  controls: [
    { id: 'window', kind: 'select', label: '平滑窗口', options: [['1', '不平滑'], ['2', '2 期'], ['3', '3 期']], value: '1' },
    { id: 'lastN', kind: 'slider', label: '最近期数', min: 0, max: 12, step: 1, value: 0 },
    { id: 'target', kind: 'slider', label: '目标线', min: 0, max: 1000, step: 50, value: 0 },
  ],

  // 返回新的行数组（也可以返回 { rows }）。`h` 提供 sum/avg/median/min/max/
  // num/label/uniq/groupBy/parseDate/fmt。
  transform({ rows, controls, h }) {
    const metric = '产量(吨)'
    let out = rows.slice()

    const lastN = Number(controls.lastN) || 0
    if (lastN > 0 && out.length > lastN) out = out.slice(-lastN)

    const win = Number(controls.window) || 1
    if (win > 1) {
      out = out.map((row, i) => {
        const slice = out.slice(Math.max(0, i - win + 1), i + 1)
        return { ...row, [metric]: h.avg(slice.map(r => r[metric])) }
      })
    }
    return out
  },

  // 目标线用 ECharts markLine 画，同样是纯客户端配置。
  option({ option, controls }) {
    const target = Number(controls.target) || 0
    if (target > 0 && Array.isArray(option.series) && option.series.length > 0) {
      option.series[0] = {
        ...option.series[0],
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: target, label: { formatter: '目标 ' + target, position: 'insideEndTop' } }],
          lineStyle: { type: 'dashed', color: '#f6903d' },
        },
      }
    }
    return option
  },
}
