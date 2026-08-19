// chart_lab recipe 示例 1：只做内置控件做不到的事。
//
// 内置已经有：图表类型、维度、指标、聚合、分组、筛选、Top-N、排序、堆叠、
// 平滑。不要用 recipe 重复实现它们。
//
// 保留的控件 id（用了会覆盖内置设置，卡片会告警）：
//   type / x / y / agg / group / topN / sort / stack / smooth /
//   filters / view / height
//
// 用法：
//   chart_lab({
//     title: "周产量",
//     file: "examples/data/weekly-output.json",
//     recipe: "examples/recipes/value-labels.js"
//   })
return {
  controls: [
    { id: 'showVal', kind: 'toggle', label: '显示数值', value: false },
    { id: 'gapPct', kind: 'slider', label: '柱间距%', min: 0, max: 80, step: 10, value: 30 },
  ],

  // `controls` 是本 recipe 控件的当前值；`option` 是内置生成的 ECharts 配置。
  // 拖动上面的控件只会重跑这个函数，不产生任何模型调用。
  option({ option, controls }) {
    if (!Array.isArray(option.series)) return option
    for (const s of option.series) {
      if (s === null || typeof s !== 'object') continue
      s.label = controls.showVal
        ? { show: true, position: 'top', fontSize: 10 }
        : { show: false }
      if (s.type === 'bar') s.barGap = controls.gapPct + '%'
    }
    return option
  },
}
