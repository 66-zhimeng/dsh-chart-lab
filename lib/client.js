window.__ModuleLoader__.load({ id: 'dsh-chart-lab', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * dsh-chart-lab, browser half: a keyed `tool.call.toolview` for the
 * `chart_lab` tool.
 *
 * The card reads the dataset once from the settled result node's `meta` and
 * then owns it. Every control — chart type, dimension, metrics, aggregation,
 * grouping, filters, Top-N, sort, table view, CSV/PNG export, and any
 * control a project-local recipe adds — recomputes in this file and
 * re-renders the chart. Nothing here ever calls `conversation.send`, so a
 * click costs zero tokens and zero model turns. That is the whole point of
 * the plugin.
 *
 * Hand-written CJS in the module-loader wrapper: no build step, so the file
 * can be patched in place the way the profile's other plugins are.
 * @module dsh-chart-lab/client
 */
var React = require('react');
var el = React.createElement;
var useState = React.useState;
var useMemo = React.useMemo;
var useRef = React.useRef;
var useEffect = React.useEffect;
var useCallback = React.useCallback;

var PLUGIN_ID = 'dsh-chart-lab';
var TOOL_NAME = 'chart_lab';
var ASSET_DIR = '/plugins/' + PLUGIN_ID + '/assets';

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

/**
 * Theme-agnostic on purpose: every colour is either `currentColor` or a
 * neutral grey alpha, so the card sits correctly on the light and the dark
 * shell without reading host theme tokens that this package cannot verify.
 */
var CSS = [
  '.cl-card{border:1px solid rgba(128,128,128,.28);border-radius:10px;padding:10px 12px 12px;margin:6px 0;font-size:13px;line-height:1.5;background:rgba(128,128,128,.045)}',
  '.cl-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
  '.cl-title{font-weight:600;font-size:14px}',
  '.cl-note{opacity:.65;font-size:12px}',
  '.cl-src{margin-left:auto;opacity:.5;font-size:11px;font-variant-numeric:tabular-nums}',
  '.cl-bar{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-bottom:8px}',
  '.cl-grp{display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
  '.cl-lab{opacity:.6;font-size:11px;white-space:nowrap}',
  '.cl-btn{border:1px solid rgba(128,128,128,.3);background:rgba(128,128,128,.1);color:inherit;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;font-family:inherit;line-height:1.6}',
  '.cl-btn:hover{background:rgba(128,128,128,.2)}',
  '.cl-btn[data-on="1"]{background:rgba(88,140,255,.28);border-color:rgba(88,140,255,.55)}',
  '.cl-sel{border:1px solid rgba(128,128,128,.3);background:rgba(128,128,128,.1);color:inherit;border-radius:6px;padding:2px 4px;font-size:12px;font-family:inherit;max-width:180px}',
  '.cl-sel option{color:initial}',
  '.cl-rng{vertical-align:middle;width:110px}',
  '.cl-chart{width:100%;height:340px;min-height:180px}',
  '.cl-resize{height:6px;cursor:ns-resize;opacity:.35;text-align:center;font-size:9px;user-select:none;letter-spacing:2px}',
  '.cl-resize:hover{opacity:.8}',
  '.cl-tblwrap{max-height:340px;overflow:auto;border:1px solid rgba(128,128,128,.22);border-radius:6px}',
  '.cl-tbl{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}',
  '.cl-tbl th,.cl-tbl td{border-bottom:1px solid rgba(128,128,128,.18);padding:3px 8px;text-align:left;white-space:nowrap}',
  '.cl-tbl th{position:sticky;top:0;background:rgba(128,128,128,.16);backdrop-filter:blur(3px)}',
  '.cl-foot{display:flex;gap:10px;align-items:center;margin-top:6px;font-size:11px;opacity:.6;flex-wrap:wrap}',
  '.cl-err{color:#e5534b;font-size:12px;padding:6px 0}',
  '.cl-stack{font-size:10px;opacity:.6;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;margin:4px 0}',
  '.cl-warn{opacity:.7;font-size:11px;padding:2px 0}',
].join('\n');

/** Inject the stylesheet once per page (materialization-time side effect). */
function installStyles() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + PLUGIN_ID + '"]') !== null) return;
  var tag = document.createElement('style');
  tag.setAttribute('data-plugin', PLUGIN_ID);
  tag.setAttribute('data-plugin-css', PLUGIN_ID);
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

/* ------------------------------------------------------------------ *
 * ECharts lazy loader
 * ------------------------------------------------------------------ */

var echartsTask = null;

/** Resolve the asset URL, riding the boot graph's rev for cache busting. */
function assetUrl(file) {
  var graph = window.__DSH_BOOT__;
  var rev;
  if (graph && Array.isArray(graph.entries)) {
    for (var i = 0; i < graph.entries.length; i += 1) {
      if (graph.entries[i] && graph.entries[i].id === PLUGIN_ID) { rev = graph.entries[i].rev; break; }
    }
  }
  return ASSET_DIR + '/' + file + (rev === undefined ? '' : '?rev=' + rev);
}

/**
 * Load `echarts.min.js` on first use and hand back `window.echarts`.
 * Memoized per page; a rejection is final and the card shows the reason.
 */
function loadECharts() {
  if (echartsTask !== null) return echartsTask;
  echartsTask = new Promise(function (resolve, reject) {
    if (window.echarts !== undefined) { resolve(window.echarts); return; }
    var script = document.createElement('script');
    script.src = assetUrl('echarts.js');
    script.async = true;
    script.onload = function () {
      if (window.echarts === undefined) { reject(new Error('echarts 资源已加载但未注册全局对象')); return; }
      resolve(window.echarts);
    };
    script.onerror = function () { reject(new Error('echarts 资源加载失败（host 资源路由未注册？）')); };
    document.head.appendChild(script);
  });
  return echartsTask;
}

/* ------------------------------------------------------------------ *
 * Local data engine — every button press lands here, never on the model
 * ------------------------------------------------------------------ */

/** Coerce one cell to a finite number, or null when it is not numeric. */
function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Stable string form of a cell, used as a grouping key and axis label. */
function label(value) {
  if (value === null || value === undefined) return '(空)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

var AGG_FNS = {
  sum: function (values) { var t = 0; for (var i = 0; i < values.length; i += 1) t += values[i]; return t; },
  avg: function (values) { if (values.length === 0) return null; return AGG_FNS.sum(values) / values.length; },
  count: function (values) { return values.length; },
  min: function (values) { return values.length === 0 ? null : Math.min.apply(null, values); },
  max: function (values) { return values.length === 0 ? null : Math.max.apply(null, values); },
  median: function (values) {
    if (values.length === 0) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },
};

/** Helper surface handed to recipe code (documented in the system prompt). */
var HELPERS = {
  sum: function (values) { return AGG_FNS.sum(values.map(num).filter(function (v) { return v !== null; })); },
  avg: function (values) { return AGG_FNS.avg(values.map(num).filter(function (v) { return v !== null; })); },
  median: function (values) { return AGG_FNS.median(values.map(num).filter(function (v) { return v !== null; })); },
  min: function (values) { return AGG_FNS.min(values.map(num).filter(function (v) { return v !== null; })); },
  max: function (values) { return AGG_FNS.max(values.map(num).filter(function (v) { return v !== null; })); },
  num: num,
  label: label,
  uniq: function (values) { return Array.from(new Set(values)); },
  groupBy: function (rows, keyOf) {
    var out = new Map();
    for (var i = 0; i < rows.length; i += 1) {
      var key = typeof keyOf === 'function' ? keyOf(rows[i]) : rows[i][keyOf];
      var k = label(key);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(rows[i]);
    }
    return out;
  },
  parseDate: function (value) { var d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; },
  fmt: function (value, digits) {
    var n = num(value);
    if (n === null) return label(value);
    var d = digits === undefined ? 2 : digits;
    return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(d);
  },
};

/** Apply the card's include-filters: a column with no selection filters nothing. */
function applyFilters(rows, filters) {
  var active = Object.keys(filters).filter(function (col) { return filters[col] && filters[col].length > 0; });
  if (active.length === 0) return rows;
  return rows.filter(function (row) {
    for (var i = 0; i < active.length; i += 1) {
      var col = active[i];
      if (filters[col].indexOf(label(row[col])) === -1) return false;
    }
    return true;
  });
}

/**
 * Fold rows into `{ categories, series }` for the chart, honouring the
 * dimension, the metric list, the aggregation, the optional split column,
 * sorting and Top-N. Runs on every control change — typically sub-millisecond
 * for tens of thousands of rows, which is why interaction needs no server.
 */
function aggregate(rows, state) {
  var x = state.x;
  var metrics = state.y.length > 0 ? state.y : [];
  var agg = state.agg;
  var group = state.group;

  if (agg === 'none') {
    // Raw mode: one point per row, in file order — the honest view for
    // scatter plots and already-aggregated files.
    var cats = rows.map(function (row) { return label(row[x]); });
    var rawSeries = metrics.map(function (metric) {
      return { name: metric, data: rows.map(function (row) { return num(row[metric]); }) };
    });
    return { categories: cats, series: rawSeries, total: cats.length };
  }

  var fold = AGG_FNS[agg] || AGG_FNS.sum;
  var catOrder = [];
  var catSeen = new Set();
  var groupOrder = [];
  var groupSeen = new Set();
  var buckets = new Map();

  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    var cat = label(row[x]);
    if (!catSeen.has(cat)) { catSeen.add(cat); catOrder.push(cat); }
    var grp = group === '' ? '' : label(row[group]);
    if (group !== '' && !groupSeen.has(grp)) { groupSeen.add(grp); groupOrder.push(grp); }
    var key = cat + ' ' + grp;
    var bucket = buckets.get(key);
    if (bucket === undefined) { bucket = {}; buckets.set(key, bucket); }
    for (var m = 0; m < metrics.length; m += 1) {
      var metric = metrics[m];
      if (bucket[metric] === undefined) bucket[metric] = [];
      if (agg === 'count') { bucket[metric].push(1); continue; }
      var value = num(row[metric]);
      if (value !== null) bucket[metric].push(value);
    }
    if (metrics.length === 0) {
      if (bucket.__count === undefined) bucket.__count = [];
      bucket.__count.push(1);
    }
  }

  var effectiveMetrics = metrics.length > 0 ? metrics : ['__count'];
  var valueOf = function (cat, grp, metric) {
    var bucket = buckets.get(cat + ' ' + grp);
    if (bucket === undefined || bucket[metric] === undefined) return null;
    return fold(bucket[metric]);
  };

  // Sort and trim on the FIRST metric (summed across groups), which is what
  // "top 10 by revenue" means to a reader.
  var primary = effectiveMetrics[0];
  if (state.sort !== 'none') {
    var weight = {};
    for (var c = 0; c < catOrder.length; c += 1) {
      var total = 0;
      var groups = group === '' ? [''] : groupOrder;
      for (var g = 0; g < groups.length; g += 1) {
        var v = valueOf(catOrder[c], groups[g], primary);
        if (v !== null) total += v;
      }
      weight[catOrder[c]] = total;
    }
    catOrder.sort(function (a, b) {
      return state.sort === 'asc' ? weight[a] - weight[b] : weight[b] - weight[a];
    });
  }
  // Remember the pre-trim count: the Top-N slider's range must be derived
  // from the full category set, or trimming would ratchet its own maximum
  // down and the user could never widen the view again.
  var totalCategories = catOrder.length;
  if (state.topN > 0 && catOrder.length > state.topN) catOrder = catOrder.slice(0, state.topN);

  var series = [];
  if (group === '') {
    for (var mi = 0; mi < effectiveMetrics.length; mi += 1) {
      var mName = effectiveMetrics[mi];
      series.push({
        name: mName === '__count' ? '行数' : mName,
        data: catOrder.map(function (cat) { return valueOf(cat, '', mName); }),
      });
    }
  } else {
    for (var gi = 0; gi < groupOrder.length; gi += 1) {
      var gName = groupOrder[gi];
      series.push({
        name: gName,
        data: catOrder.map(function (cat) { return valueOf(cat, gName, primary); }),
      });
    }
  }
  return { categories: catOrder, series: series, total: totalCategories };
}

/* ------------------------------------------------------------------ *
 * Recipe evaluation — project-local JS, inlined into the card
 * ------------------------------------------------------------------ */

/** Built-in control names. A recipe control sharing one of these ids used to
 * silently shadow it in the merged `state`, so the built-in button kept
 * highlighting while the recipe quietly overrode what it did. */
var BUILTIN_STATE_KEYS = ['type', 'x', 'y', 'agg', 'group', 'topN', 'sort', 'stack', 'smooth', 'palette', 'filters', 'view', 'height', 'recipe'];

/** Cartesian series need axes; a pie/heatmap option carries none. */
var CARTESIAN_TYPES = ['bar', 'line', 'scatter', 'effectScatter', 'boxplot', 'candlestick'];

/**
 * Repair an option a recipe handed back. A recipe that rewrites
 * `series[].type` can put a cartesian series on an option built for pie or
 * heatmap — a series with no axes to sit on, which ECharts draws as nothing
 * at all. Restoring the axes stops a well-meaning recipe from blanking the
 * chart.
 */
function repairOption(option, view) {
  if (option === null || typeof option !== 'object' || !Array.isArray(option.series)) return option;
  var needsAxes = false;
  for (var i = 0; i < option.series.length; i += 1) {
    var s = option.series[i];
    if (s !== null && typeof s === 'object' && CARTESIAN_TYPES.indexOf(s.type) !== -1) { needsAxes = true; break; }
  }
  if (!needsAxes) return option;
  if (option.xAxis !== undefined && option.yAxis !== undefined) return option;
  option.xAxis = { type: 'category', data: view.categories };
  option.yAxis = { type: 'value' };
  // Unwrap pie-shaped {name, value} data into the plain numbers a cartesian
  // series expects.
  option.series = option.series.map(function (s) {
    if (s !== null && typeof s === 'object' && Array.isArray(s.data) && s.data.length > 0
      && s.data[0] !== null && typeof s.data[0] === 'object') {
      return Object.assign({}, s, { data: s.data.map(function (d) { return (d !== null && typeof d === 'object') ? d.value : d; }) });
    }
    return s;
  });
  return option;
}

var recipeCache = new Map();

/**
 * Evaluate a project-local recipe module. The source is a function body that
 * `return`s `{ controls?, transform?, option? }`. It is the user's own
 * project file (the model only names the path), and it runs with no
 * arguments in scope beyond what the card passes into its functions.
 */
function evalRecipe(path, code) {
  var cached = recipeCache.get(code);
  if (cached !== undefined) return cached;
  var result;
  try {
    /* eslint-disable-next-line no-new-func */
    var factory = new Function('"use strict";\n' + code);
    var mod = factory();
    if (mod === null || typeof mod !== 'object') throw new Error('recipe 未 return 一个对象');
    var controls = Array.isArray(mod.controls) ? mod.controls : [];
    // A control id that matches a built-in one shadows it in the merged
    // `state`, which makes the built-in button look broken. Detect it here so
    // the card can say so out loud instead of behaving mysteriously.
    var collisions = [];
    for (var ci = 0; ci < controls.length; ci += 1) {
      var id = controls[ci] && controls[ci].id;
      if (typeof id === 'string' && BUILTIN_STATE_KEYS.indexOf(id) !== -1) collisions.push(id);
    }
    result = {
      controls: controls,
      transform: typeof mod.transform === 'function' ? mod.transform : null,
      option: typeof mod.option === 'function' ? mod.option : null,
      collisions: collisions,
      error: null,
    };
  } catch (error) {
    result = { controls: [], transform: null, option: null, collisions: [], error: (path || 'recipe') + '：' + (error && error.message ? error.message : String(error)) };
  }
  recipeCache.set(code, result);
  return result;
}

/* ------------------------------------------------------------------ *
 * ECharts option builder
 * ------------------------------------------------------------------ */

var PALETTE = ['#5b8ff9', '#61ddaa', '#f6bd16', '#f6903d', '#7262fd', '#78d3f8', '#9661bc', '#ff99c3', '#008685', '#d4b106'];

/** Selectable colour schemes; the first one is the historical default. */
var PALETTES = [
  ['default', '默认', PALETTE],
  ['ink', '水墨丹青', ['#B23A2E', '#33587D', '#4F7D63', '#B8912E', '#8E2F3C', '#8A5A3B', '#4B4F55', '#4A6A73']],
  ['dunhuang', '敦煌', ['#3D7A5D', '#2C6C8F', '#A8503A', '#7C4A33', '#C0932C', '#8C8B84', '#6B3F4A', '#3A3632']],
  ['celadon', '宋瓷', ['#6E9095', '#7C9A8A', '#6F8A5E', '#8A97A0', '#5E7482', '#58827C', '#B08A3E', '#4A5259']],
  ['morandi', '莫兰迪', ['#9A8C98', '#8A9A8B', '#C4A69F', '#7E8B93', '#B7A99A', '#8E7C93', '#A3A8A1', '#6E6F73']],
  ['vivid', '鲜明', ['#2E86AB', '#E4572E', '#17B890', '#F4A259', '#6A4C93', '#2A9D8F', '#E9C46A', '#B56576']],
];

/** Resolve one palette by id, falling back to the default scheme. */
function paletteOf(state) {
  var id = state.palette;
  for (var i = 0; i < PALETTES.length; i += 1) if (PALETTES[i][0] === id) return PALETTES[i][2];
  return PALETTE;
}

/**
 * Split a trailing unit out of a column name: `产量(吨)` → `产量` + `吨`.
 * Only bracketed suffixes count — guessing a unit out of free text would
 * mangle ordinary names far more often than it would help.
 */
function splitUnit(name) {
  var text = String(name === undefined || name === null ? '' : name);
  var m = /^(.*?)\s*[（(\[]([^）)\]]{1,12})[）)\]]\s*$/.exec(text);
  if (m === null) return { base: text, unit: '' };
  return { base: m[1], unit: m[2] };
}

/**
 * Axis captions for the current view. Derived from the columns the user has
 * selected, so they follow the dimension/metric dropdowns with no help from
 * the model; `state.xName` / `state.yName` / `state.unit` override when the
 * caller supplied something more presentable than the raw column name.
 */
function axisTitles(view, state) {
  var x = splitUnit(state.xName !== undefined && state.xName !== '' ? state.xName : state.x);
  // Grouped views split one metric across series, so the series names are
  // group values — the metric itself is the honest y caption there.
  var metrics = Array.isArray(state.y) ? state.y : [];
  var yRaw = state.yName !== undefined && state.yName !== ''
    ? state.yName
    : (state.group !== '' && metrics.length > 0
      ? metrics[0]
      : (view.series.length === 1 ? view.series[0].name : metrics.join(' / ')));
  var y = splitUnit(yRaw);
  var yUnit = state.unit !== undefined && state.unit !== '' ? state.unit : y.unit;
  return {
    x: x.base + (x.unit !== '' ? ' (' + x.unit + ')' : ''),
    y: y.base + (yUnit !== '' ? ' (' + yUnit + ')' : ''),
    unit: yUnit,
  };
}

/** Decide dark vs light from the card's inherited text colour. */
function isDarkSurface(node) {
  try {
    var colour = window.getComputedStyle(node).color;
    var parts = colour.match(/\d+(\.\d+)?/g);
    if (parts === null || parts.length < 3) return false;
    var luminance = (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255;
    return luminance > 0.5;
  } catch (error) {
    return false;
  }
}

/** Build the ECharts option for the current view. */
function buildOption(view, state, dark) {
  var fg = dark ? 'rgba(235,235,240,.85)' : 'rgba(30,30,35,.85)';
  var grid = dark ? 'rgba(160,160,175,.18)' : 'rgba(60,60,70,.14)';
  var type = state.type;
  var base = {
    color: paletteOf(state),
    textStyle: { color: fg, fontFamily: 'inherit' },
    animationDuration: 260,
    tooltip: { trigger: type === 'pie' || type === 'donut' || type === 'scatter' ? 'item' : 'axis', confine: true },
    legend: { type: 'scroll', top: 0, textStyle: { color: fg }, icon: 'roundRect' },
    grid: { left: 8, right: 14, bottom: 6, top: 30, containLabel: true },
  };

  if (type === 'pie' || type === 'donut') {
    var slice = view.series[0];
    base.series = [{
      type: 'pie',
      radius: type === 'donut' ? ['42%', '68%'] : '62%',
      center: ['50%', '55%'],
      data: view.categories.map(function (cat, i) { return { name: cat, value: slice ? slice.data[i] : 0 }; }),
      label: { color: fg },
      emphasis: { focus: 'self' },
    }];
    return base;
  }

  if (type === 'scatter') {
    var scatterTitles = axisTitles(view, state);
    var scatterName = { color: fg, fontSize: 11, opacity: 0.75 };
    base.xAxis = { type: 'category', data: view.categories, name: scatterTitles.x, nameLocation: 'middle', nameGap: 26, nameTextStyle: scatterName, axisLine: { lineStyle: { color: grid } }, axisLabel: { color: fg } };
    base.yAxis = { type: 'value', name: scatterTitles.y, nameLocation: 'end', nameGap: 10, nameTextStyle: scatterName, splitLine: { lineStyle: { color: grid } }, axisLabel: { color: fg } };
    base.series = view.series.map(function (s) { return { name: s.name, type: 'scatter', data: s.data, symbolSize: 8 }; });
    base.dataZoom = [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 0, textStyle: { color: fg } }];
    base.grid.bottom = 46;
    base.grid.top = 34;
    return base;
  }

  if (type === 'heatmap') {
    var values = [];
    var maxV = 0;
    for (var s = 0; s < view.series.length; s += 1) {
      for (var c = 0; c < view.categories.length; c += 1) {
        var v = view.series[s].data[c];
        values.push([c, s, v === null ? '-' : v]);
        if (v !== null && v > maxV) maxV = v;
      }
    }
    base.tooltip = { position: 'top', confine: true };
    base.xAxis = { type: 'category', data: view.categories, axisLabel: { color: fg } };
    base.yAxis = { type: 'category', data: view.series.map(function (x) { return x.name; }), axisLabel: { color: fg } };
    base.visualMap = { min: 0, max: maxV || 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, textStyle: { color: fg } };
    base.series = [{ type: 'heatmap', data: values, label: { show: false } }];
    base.grid.bottom = 44;
    base.legend = { show: false };
    return base;
  }

  var horizontal = type === 'hbar';
  var titles = axisTitles(view, state);
  var nameStyle = { color: fg, fontSize: 11, opacity: 0.75 };
  var categoryAxis = {
    type: 'category', data: view.categories,
    name: titles.x, nameLocation: 'middle', nameGap: 26, nameTextStyle: nameStyle,
    axisLine: { lineStyle: { color: grid } }, axisLabel: { color: fg, hideOverlap: true },
  };
  var valueAxis = {
    type: 'value',
    name: titles.y, nameLocation: 'end', nameGap: 10, nameTextStyle: nameStyle,
    splitLine: { lineStyle: { color: grid } }, axisLabel: { color: fg },
  };
  if (horizontal) {
    // Swapped orientation: the category caption now runs down the left edge
    // and the value caption sits under the bottom axis.
    categoryAxis.nameGap = 40;
    valueAxis.nameLocation = 'middle';
    valueAxis.nameGap = 26;
  }
  base.xAxis = horizontal ? valueAxis : categoryAxis;
  base.yAxis = horizontal ? categoryAxis : valueAxis;
  // Room for the captions: the axis name would otherwise be clipped by the
  // grid edge (containLabel does not account for it).
  base.grid.bottom = 26;
  base.grid.top = 34;
  if (horizontal) base.grid.left = 20;
  if (titles.unit !== '') {
    base.tooltip = Object.assign({}, base.tooltip, {
      valueFormatter: function (value) {
        return (value === null || value === undefined ? '-' : value) + ' ' + titles.unit;
      },
    });
  }
  base.series = view.series.map(function (s) {
    if (type === 'line' || type === 'area') {
      return {
        name: s.name, type: 'line', data: s.data, smooth: state.smooth === true, showSymbol: view.categories.length <= 80,
        areaStyle: type === 'area' ? { opacity: 0.22 } : undefined,
        stack: state.stack ? 'total' : undefined,
        connectNulls: true,
      };
    }
    return { name: s.name, type: 'bar', data: s.data, stack: state.stack ? 'total' : undefined, barMaxWidth: 42 };
  });
  if (view.categories.length > 24) {
    base.dataZoom = [
      { type: 'inside', orient: horizontal ? 'vertical' : 'horizontal' },
      { type: 'slider', orient: horizontal ? 'vertical' : 'horizontal', height: horizontal ? undefined : 16, width: horizontal ? 14 : undefined, bottom: horizontal ? undefined : 0, right: horizontal ? 0 : undefined, textStyle: { color: fg } },
    ];
    if (!horizontal) base.grid.bottom = 46;
    else base.grid.right = 30;
  }
  return base;
}

/* ------------------------------------------------------------------ *
 * Per-card interaction state, durable across unmount/remount
 * ------------------------------------------------------------------ */

var stateStore = new Map();

/** Seed the card's control state from the model's initial `chart` block. */
function initialState(callId, payload) {
  var existing = stateStore.get(callId);
  if (existing !== undefined) return existing;
  var chart = payload.chart || {};
  var seeded = {
    type: chart.type || 'bar',
    x: chart.x || '',
    y: Array.isArray(chart.y) ? chart.y.slice() : [],
    agg: chart.agg || 'sum',
    group: chart.group || '',
    topN: chart.topN || 0,
    sort: chart.sort || 'none',
    stack: chart.stack === true,
    xName: chart.xName || '',
    yName: chart.yName || '',
    unit: chart.unit || '',
    smooth: false,
    palette: chart.palette || 'default',
    filters: {},
    view: chart.type === 'table' ? 'table' : 'chart',
    height: 340,
    recipe: {},
  };
  stateStore.set(callId, seeded);
  return seeded;
}

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

var CHART_BUTTONS = [
  ['bar', '柱'], ['hbar', '条'], ['line', '线'], ['area', '面'],
  ['pie', '饼'], ['donut', '环'], ['scatter', '散点'], ['heatmap', '热力'],
];
var AGG_OPTIONS = [['sum', '求和'], ['avg', '平均'], ['count', '计数'], ['median', '中位'], ['max', '最大'], ['min', '最小'], ['none', '原始']];

function Select(props) {
  return el('select', {
    className: 'cl-sel',
    value: props.value,
    onChange: function (event) { props.onChange(event.target.value); },
    title: props.title,
  }, props.options.map(function (opt) {
    return el('option', { key: opt[0], value: opt[0] }, opt[1]);
  }));
}

function Group(props) {
  return el('span', { className: 'cl-grp' }, el('span', { className: 'cl-lab' }, props.label), props.children);
}

/** Chips that toggle membership of an array-valued state field. */
function Chips(props) {
  return props.options.map(function (opt) {
    var on = props.value.indexOf(opt) !== -1;
    return el('button', {
      key: opt,
      className: 'cl-btn',
      'data-on': on ? '1' : '0',
      onClick: function () {
        var next = on ? props.value.filter(function (v) { return v !== opt; }) : props.value.concat([opt]);
        props.onChange(next);
      },
    }, props.render ? props.render(opt) : opt);
  });
}

/** Render one recipe-declared control. */
function RecipeControl(props) {
  var control = props.control;
  var value = props.value;
  var onChange = props.onChange;
  if (control.kind === 'toggle') {
    return el(Group, { label: control.label || control.id }, el('button', {
      className: 'cl-btn', 'data-on': value ? '1' : '0',
      onClick: function () { onChange(!value); },
    }, value ? '开' : '关'));
  }
  if (control.kind === 'slider') {
    return el(Group, { label: (control.label || control.id) + ' ' + value },
      el('input', {
        type: 'range', className: 'cl-rng',
        min: control.min === undefined ? 0 : control.min,
        max: control.max === undefined ? 100 : control.max,
        step: control.step === undefined ? 1 : control.step,
        value: value,
        onChange: function (event) { onChange(Number(event.target.value)); },
      }));
  }
  if (control.kind === 'button') {
    return el('button', {
      className: 'cl-btn',
      onClick: function () { onChange((typeof value === 'number' ? value : 0) + 1); },
    }, control.label || control.id);
  }
  var options = (control.options || []).map(function (opt) {
    return Array.isArray(opt) ? [String(opt[0]), String(opt[1])] : [String(opt), String(opt)];
  });
  return el(Group, { label: control.label || control.id },
    el(Select, { value: String(value), options: options, onChange: onChange }));
}

/* ------------------------------------------------------------------ *
 * Export helpers
 * ------------------------------------------------------------------ */

/** Serialize the current view back to CSV and hand it to the browser. */
function downloadCsv(view, state, title) {
  var header = ['category'].concat(view.series.map(function (s) { return s.name; }));
  var lines = [header.map(csvCell).join(',')];
  for (var i = 0; i < view.categories.length; i += 1) {
    var row = [view.categories[i]];
    for (var s = 0; s < view.series.length; s += 1) {
      var value = view.series[s].data[i];
      row.push(value === null || value === undefined ? '' : value);
    }
    lines.push(row.map(csvCell).join(','));
  }
  // Leading BOM so Excel reads the CJK labels as UTF-8 instead of ANSI.
  saveBlob(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), safeName(title) + '.csv');
}

function csvCell(value) {
  var text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function safeName(title) {
  return String(title || 'chart').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

function saveBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

/* ------------------------------------------------------------------ *
 * Error boundary
 * ------------------------------------------------------------------ */

/**
 * Without this, ANY throw inside the card — a render slip, or an exception
 * raised in a `useEffect` — propagates to the React root and unmounts the
 * whole subtree, so the card silently vanishes with no clue why. React 18+
 * treats effect errors exactly like render errors, which is how a single bad
 * `setOption` call could take the entire card off the screen.
 *
 * The boundary shows the message and stack in place instead, so a failure is
 * reportable rather than invisible.
 */
var ErrorBoundary = (function () {
  function Boundary(props) {
    React.Component.call(this, props);
    this.state = { error: null, info: '' };
  }
  Boundary.prototype = Object.create(React.Component.prototype);
  Boundary.prototype.constructor = Boundary;
  Boundary.getDerivedStateFromError = function (error) {
    return { error: error };
  };
  Boundary.prototype.componentDidCatch = function (error, info) {
    console.error('[chart-lab] 卡片渲染失败', error, info);
    this.setState({ error: error, info: (info && info.componentStack) || '' });
  };
  Boundary.prototype.render = function () {
    if (this.state.error === null) return this.props.children;
    var error = this.state.error;
    var self = this;
    return el('div', { className: 'cl-card' },
      el('div', { className: 'cl-title' }, '图表卡片出错'),
      el('div', { className: 'cl-err' }, String(error && error.message ? error.message : error)),
      el('pre', { className: 'cl-stack' }, String((error && error.stack) || self.state.info).slice(0, 1200)),
      el('button', {
        className: 'cl-btn',
        onClick: function () { self.setState({ error: null, info: '' }); },
      }, '重试'));
  };
  return Boundary;
}());

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

function ChartLabCard(props) {
  var payload = props.payload;
  var callId = props.callId;
  var chartRef = useRef(null);
  var instanceRef = useRef(null);
  var [engine, setEngine] = useState(window.echarts !== undefined ? window.echarts : null);
  var [engineError, setEngineError] = useState(null);
  var [, forceRender] = useState(0);
  // Last drawing failure, kept in a ref so reporting it never re-triggers the
  // effect that produced it.
  var renderErrorRef = useRef(null);
  var stateRef = useRef(initialState(callId, payload));
  var state = stateRef.current;

  /** Mutate the durable state object and re-render. Pure local; no send. */
  var patch = useCallback(function (delta) {
    Object.assign(stateRef.current, delta);
    forceRender(function (n) { return n + 1; });
  }, []);

  var columns = payload.columns || [];
  var numericColumns = columns.filter(function (c) { return c.kind === 'number'; });
  var filterColumns = columns.filter(function (c) { return Array.isArray(c.values) && c.values.length > 1 && c.values.length <= 24; });

  var recipe = useMemo(function () {
    if (payload.recipe === null || payload.recipe === undefined) return null;
    return evalRecipe(payload.recipe.path, payload.recipe.code);
  }, [payload.recipe]);

  // Seed recipe control defaults exactly once, before the first compute.
  if (recipe !== null && recipe.controls.length > 0) {
    for (var ci = 0; ci < recipe.controls.length; ci += 1) {
      var control = recipe.controls[ci];
      if (control && control.id !== undefined && state.recipe[control.id] === undefined) {
        state.recipe[control.id] = control.value !== undefined ? control.value : (control.kind === 'toggle' ? false : (control.kind === 'slider' ? (control.min || 0) : (Array.isArray(control.options) && control.options.length > 0 ? String(Array.isArray(control.options[0]) ? control.options[0][0] : control.options[0]) : '')));
      }
    }
  }

  var computed = useMemo(function () {
    var rows = applyFilters(payload.rows || [], state.filters);
    var warning = null;
    if (recipe !== null && recipe.transform !== null) {
      try {
        var out = recipe.transform({ rows: rows, state: Object.assign({}, state, state.recipe), controls: state.recipe, columns: columns, h: HELPERS });
        if (Array.isArray(out)) rows = out;
        else if (out !== null && typeof out === 'object' && Array.isArray(out.rows)) rows = out.rows;
      } catch (error) {
        warning = 'recipe.transform 出错：' + (error && error.message ? error.message : String(error));
      }
    }
    return { rows: rows, view: aggregate(rows, state), warning: warning };
  }, [payload.rows, recipe, state.filters, state.x, state.y, state.agg, state.group, state.topN, state.sort, state.type, JSON.stringify(state.recipe)]);

  useEffect(function () {
    if (engine !== null || state.view !== 'chart') return undefined;
    var cancelled = false;
    loadECharts().then(function (api) { if (!cancelled) setEngine(function () { return api; }); },
      function (error) { if (!cancelled) setEngineError(error.message); });
    return function () { cancelled = true; };
  }, [engine, state.view]);

  // Chart lifecycle: create once the engine and the node both exist, resize
  // with the container, dispose on unmount.
  useEffect(function () {
    if (engine === null || chartRef.current === null || state.view !== 'chart') return undefined;
    // A node that still carries an instance (StrictMode double-invoke, or a
    // cleanup that did not run) makes echarts warn and hand back a detached
    // instance that never draws. Clear it before claiming the node.
    var stale = typeof engine.getInstanceByDom === 'function' ? engine.getInstanceByDom(chartRef.current) : undefined;
    if (stale !== undefined && stale !== null) stale.dispose();
    var instance = engine.init(chartRef.current, null, { renderer: 'canvas' });
    instanceRef.current = instance;
    var observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(function () { instance.resize(); });
    if (observer !== null) observer.observe(chartRef.current);
    // The footer's PNG export reads instanceRef, which is empty during the
    // render that mounts the canvas; without this nudge the button stays
    // missing until some unrelated interaction re-renders the card.
    forceRender(function (n) { return n + 1; });
    return function () {
      if (observer !== null) observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, [engine, state.view]);

  useEffect(function () {
    var instance = instanceRef.current;
    if (instance === null || instance === undefined) return;
    // Everything in here is wrapped: an exception thrown from a useEffect
    // propagates to the React root, and before the boundary above existed
    // that unmounted the card outright — the chart looked like it had simply
    // disappeared. Now a failure leaves the previous chart on screen and
    // reports itself in the card footer.
    try {
      var dark = chartRef.current !== null && isDarkSurface(chartRef.current);
      var option = buildOption(computed.view, state, dark);
      if (recipe !== null && recipe.option !== null) {
        try {
          var custom = recipe.option({ option: option, rows: computed.rows, view: computed.view, state: Object.assign({}, state, state.recipe), controls: state.recipe, h: HELPERS, echarts: engine });
          if (custom !== null && typeof custom === 'object') option = repairOption(custom, computed.view);
        } catch (error) {
          // A broken recipe must not blank the chart: keep the built-in
          // option and surface the failure in the footer instead.
          option = buildOption(computed.view, state, dark);
        }
      }
      instance.setOption(option, true);
      if (renderErrorRef.current !== null) { renderErrorRef.current = null; forceRender(function (n) { return n + 1; }); }
    } catch (error) {
      console.error('[chart-lab] setOption 失败', error);
      renderErrorRef.current = '绘制「' + state.type + '」失败：' + (error && error.message ? error.message : String(error));
      forceRender(function (n) { return n + 1; });
    }
  }, [computed, engine, recipe, state.type, state.stack, state.smooth, state.height]);

  useEffect(function () {
    var instance = instanceRef.current;
    if (instance !== null && instance !== undefined) instance.resize();
  }, [state.height]);

  var dimensionOptions = columns.map(function (c) { return [c.name, c.name + (c.kind === 'number' ? ' #' : '')]; });
  var groupOptions = [['', '（不分组）']].concat(
    columns.filter(function (c) { return c.kind !== 'number' && c.distinct <= 40; }).map(function (c) { return [c.name, c.name]; }));

  // Controls that cannot change the current picture stay out of the bar: a
  // button that does nothing is worse than a missing one.
  var currentView = computed.view;
  var capabilities = {
    aggregate: (computed.rows || []).length > (currentView.total || 0),
    stack: ['bar', 'hbar', 'line', 'area'].indexOf(state.type) !== -1 && (currentView.series || []).length > 1,
    topN: (currentView.total || 0) > 8,
    sort: (currentView.total || 0) > 2,
  };

  var bar = el('div', { className: 'cl-bar' },
    el('span', { className: 'cl-grp' }, CHART_BUTTONS.map(function (entry) {
      return el('button', {
        key: entry[0], className: 'cl-btn', 'data-on': state.type === entry[0] && state.view === 'chart' ? '1' : '0',
        onClick: function () { patch({ type: entry[0], view: 'chart' }); },
      }, entry[1]);
    }), el('button', {
      className: 'cl-btn', 'data-on': state.view === 'table' ? '1' : '0',
      onClick: function () { patch({ view: state.view === 'table' ? 'chart' : 'table' }); },
    }, '表')),
    el(Group, { label: '维度' }, el(Select, {
      value: state.x, options: dimensionOptions, onChange: function (v) { patch({ x: v }); },
    })),
    el(Group, { label: '配色' }, el(Select, {
      title: '配色方案',
      value: state.palette || 'default',
      options: PALETTES.map(function (entry) { return [entry[0], entry[1]]; }),
      onChange: function (v) { patch({ palette: v }); },
    })),
    capabilities.aggregate ? el(Group, { label: '聚合' }, el(Select, {
      value: state.agg, options: AGG_OPTIONS, onChange: function (v) { patch({ agg: v }); },
    })) : null,
    numericColumns.length > 0 ? el(Group, { label: '指标' }, el(Chips, {
      options: numericColumns.map(function (c) { return c.name; }),
      value: state.y,
      onChange: function (next) { patch({ y: next }); },
    })) : null,
    groupOptions.length > 1 ? el(Group, { label: '分组' }, el(Select, {
      value: state.group, options: groupOptions, onChange: function (v) { patch({ group: v }); },
    })) : null,
    capabilities.sort ? el(Group, { label: '排序' }, el(Select, {
      value: state.sort,
      options: [['none', '原序'], ['desc', '降序'], ['asc', '升序']],
      onChange: function (v) { patch({ sort: v }); },
    })) : null,
    capabilities.topN ? el(Group, { label: 'Top ' + (state.topN === 0 ? '全部' : state.topN) }, el('input', {
      type: 'range', className: 'cl-rng', step: 1,
      min: 0, max: Math.max(2, Math.min(80, computed.view.total || 60)),
      value: state.topN, onChange: function (event) { patch({ topN: Number(event.target.value) }); },
    })) : null,
    capabilities.stack ? el('button', {
      className: 'cl-btn', 'data-on': state.stack ? '1' : '0',
      title: '堆叠同类系列',
      onClick: function () { patch({ stack: !state.stack }); },
    }, '堆叠') : null,
    (state.type === 'line' || state.type === 'area') ? el('button', {
      className: 'cl-btn', 'data-on': state.smooth ? '1' : '0',
      onClick: function () { patch({ smooth: !state.smooth }); },
    }, '平滑') : null,
    recipe !== null ? recipe.controls.map(function (control) {
      if (!control || control.id === undefined) return null;
      return el(RecipeControl, {
        key: control.id, control: control, value: state.recipe[control.id],
        onChange: function (next) {
          var merged = {};
          merged[control.id] = next;
          patch({ recipe: Object.assign({}, state.recipe, merged) });
        },
      });
    }) : null);

  var filterBar = filterColumns.length === 0 ? null : el('div', { className: 'cl-bar' },
    filterColumns.map(function (column) {
      var selected = state.filters[column.name] || [];
      return el(Group, { key: column.name, label: column.name },
        el(Chips, {
          options: column.values.map(label),
          value: selected,
          onChange: function (next) {
            var merged = {};
            merged[column.name] = next;
            patch({ filters: Object.assign({}, state.filters, merged) });
          },
        }),
        selected.length > 0 ? el('button', {
          className: 'cl-btn',
          onClick: function () {
            var merged = {};
            merged[column.name] = [];
            patch({ filters: Object.assign({}, state.filters, merged) });
          },
        }, '×') : null);
    }));

  var body;
  if (state.view === 'table') {
    var head = ['分类'].concat(computed.view.series.map(function (s) { return s.name; }));
    body = el('div', { className: 'cl-tblwrap' }, el('table', { className: 'cl-tbl' },
      el('thead', null, el('tr', null, head.map(function (name, i) { return el('th', { key: i }, name); }))),
      el('tbody', null, computed.view.categories.map(function (cat, rowIndex) {
        return el('tr', { key: cat + rowIndex }, el('td', null, cat), computed.view.series.map(function (s, si) {
          return el('td', { key: si }, s.data[rowIndex] === null || s.data[rowIndex] === undefined ? '' : HELPERS.fmt(s.data[rowIndex]));
        }));
      }))));
  } else if (engineError !== null) {
    body = el('div', { className: 'cl-err' }, 'ECharts 加载失败：' + engineError);
  } else if (engine === null) {
    body = el('div', { className: 'cl-chart', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 } }, '正在加载图表引擎…');
  } else {
    body = el('div', { className: 'cl-chart', ref: chartRef, style: { height: state.height + 'px' } });
  }

  var resizer = state.view === 'chart' && engine !== null ? el('div', {
    className: 'cl-resize',
    title: '拖动调整高度',
    onMouseDown: function (event) {
      event.preventDefault();
      var startY = event.clientY;
      var startHeight = stateRef.current.height;
      var move = function (moveEvent) {
        var next = Math.max(180, Math.min(900, startHeight + (moveEvent.clientY - startY)));
        Object.assign(stateRef.current, { height: next });
        forceRender(function (n) { return n + 1; });
      };
      var up = function () {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
  }, '⋯⋯⋯') : null;

  var source = payload.source || {};
  var footer = el('div', { className: 'cl-foot' },
    el('span', null, computed.rows.length + ' / ' + (source.total || (payload.rows || []).length) + ' 行'),
    el('span', null, computed.view.categories.length + ' 类 × ' + computed.view.series.length + ' 系列'),
    el('button', { className: 'cl-btn', onClick: function () { downloadCsv(computed.view, state, payload.title); } }, '导出 CSV'),
    instanceRef.current !== null && instanceRef.current !== undefined ? el('button', {
      className: 'cl-btn',
      onClick: function () {
        var url = instanceRef.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: 'transparent' });
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = safeName(payload.title) + '.png';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      },
    }, '导出 PNG') : null,
    el('button', {
      className: 'cl-btn',
      onClick: function () { stateStore.delete(callId); stateRef.current = initialState(callId, payload); forceRender(function (n) { return n + 1; }); },
    }, '重置'),
    payload.recipe ? el('span', null, '功能代码 ' + payload.recipe.path) : null,
    el('span', { style: { marginLeft: 'auto', opacity: 0.7 } }, '本地计算 · 不消耗 token'));

  var warnings = [];
  if (renderErrorRef.current !== null) warnings.push(renderErrorRef.current);
  if (computed.warning !== null) warnings.push(computed.warning);
  if (recipe !== null && recipe.error !== null) warnings.push(recipe.error);
  if (recipe !== null && recipe.collisions && recipe.collisions.length > 0) {
    warnings.push('功能代码的控件 id [' + recipe.collisions.join(', ') + '] 与内置控件同名，会覆盖内置的同名设置'
      + '（所以内置的对应按钮看起来没反应）。改个 id，或改用 controls.<id> 读取自己的值。');
  }
  if (source.sampled === true) warnings.push('数据量超限，已均匀抽样到 ' + (payload.rows || []).length + ' 行');

  return el('div', { className: 'cl-card' },
    el('div', { className: 'cl-head' },
      el('span', { className: 'cl-title' }, payload.title || '数据卡片'),
      payload.note ? el('span', { className: 'cl-note' }, payload.note) : null,
      el('span', { className: 'cl-src' }, source.label || '')),
    bar,
    filterBar,
    warnings.map(function (text, i) { return el('div', { className: 'cl-warn', key: i }, '⚠ ' + text); }),
    body,
    resizer,
    footer);
}

/** The keyed toolview: settled result → card, running call → compact row. */
function ChartLabToolView(props) {
  var block = props.block;
  var meta = block && 'meta' in block ? block.meta : undefined;
  if (meta === undefined || meta === null) {
    return el('div', { className: 'cl-card' },
      el('span', { className: 'cl-note' }, props.toolName + ' 运行中…'));
  }
  if (meta.error !== undefined && meta.error !== null) {
    return el('div', { className: 'cl-card' },
      el('span', { className: 'cl-title' }, meta.title || 'chart_lab'),
      el('div', { className: 'cl-err' }, meta.error));
  }
  return el(ErrorBoundary, null, el(ChartLabCard, { payload: meta, callId: props.callId || block.callId }));
}

/* ------------------------------------------------------------------ *
 * Cordis entry
 * ------------------------------------------------------------------ */

/**
 * Register the keyed toolview. `slots` is the only hard dependency: the card
 * never sends a message, so `sessions` is deliberately not injected — one
 * fewer service that must bind before the card can render.
 */
function apply(ctx) {
  installStyles();
  return ctx.slots.inject('tool.call.toolview', function () {
    return ctx.slots.register({ name: 'tool.call.toolview', key: TOOL_NAME }, ChartLabToolView);
  });
}

exports.apply = apply;
exports.inject = ['slots'];
// Internals reached by the node-side test harness (scripts/test-client.mjs),
// which drives the data engine without a browser. Not part of any contract.
exports.__test = {
  aggregate: aggregate, applyFilters: applyFilters, evalRecipe: evalRecipe,
  buildOption: buildOption, helpers: HELPERS, label: label, num: num,
  ChartLabToolView: ChartLabToolView, ErrorBoundary: ErrorBoundary,
};

return module.exports; } });
