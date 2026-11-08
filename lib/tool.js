/**
 * The `chart_lab` tool definition — the model-facing entry point.
 *
 * The whole point of this tool is the split between what the MODEL sees and
 * what the CARD sees:
 *
 * - `execute()` loads the dataset on the host and returns a COMPACT value
 *   (counts, column names, source) — that is all that enters the session log
 *   as the tool's canonical value, and `output.render` narrows it further to
 *   a single summary line for the prompt.
 * - `output.presentationMeta(args, value)` returns the FULL payload — every
 *   row plus the project-local recipe source. It is persisted as the result
 *   node's `meta` and read by the browser toolview, never by the model.
 *
 * So a 50k-row file costs the model a dozen tokens, and every subsequent
 * button press in the card is pure client-side computation: zero further
 * tool calls, zero further model turns.
 * @module dsh-chart-lab/tool
 */

import {
  MAX_ROWS,
  inferColumns,
  loadDatasetFile,
  loadRecipeFile,
  sampleRows,
} from './dataset.js'

/** Chart kinds the card can render; also the model-facing vocabulary. */
const CHART_TYPES = ['bar', 'hbar', 'line', 'area', 'pie', 'donut', 'scatter', 'heatmap', 'table']
/** Aggregations the card computes locally. */
const AGGREGATIONS = ['sum', 'avg', 'count', 'min', 'max', 'median', 'none']

/**
 * Payloads waiting between `execute` and `presentationMeta`. The harness
 * calls the two back to back on the same execution, so an entry lives for
 * microseconds — except for nested calls, where `presentationMeta` is
 * skipped entirely and the entry would leak. The cap evicts oldest-first so
 * that path stays bounded instead of growing for the process lifetime.
 */
const pendingPayloads = new Map()
/** Most payloads held at once before the oldest is dropped. */
const PENDING_CAP = 8

/** Stash a payload for the imminent presentationMeta call. */
function stashPayload(key, payload) {
  pendingPayloads.set(key, payload)
  while (pendingPayloads.size > PENDING_CAP) {
    const oldest = pendingPayloads.keys().next().value
    pendingPayloads.delete(oldest)
  }
}

/**
 * JSON Schema for the tool's arguments — kept terse on purpose. The schema
 * ships with every request, so a sentence of prose here is a permanent tax;
 * anything the parameter name already conveys carries no description at all.
 * Deliberately permissive too: a bad column name is a card-level warning the
 * user fixes with a dropdown, not a reason to reject the call.
 */
const PARAMETERS = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    note: { type: 'string' },
    file: { type: 'string', description: '工作区数据文件（json/ndjson/jsonl/csv/tsv）。首选：不进上下文。' },
    pick: { type: 'string', description: 'JSON 内点分路径，如 "result.series"。' },
    rows: { type: 'array', items: { type: 'object' }, description: '内联行，仅限几十行；大数据用 file。' },
    url: { type: 'string', description: 'host 端抓取的 JSON 接口。' },
    recipe: { type: 'string', description: '工作区 JS 功能代码路径，加自定义控件与本地处理。' },
    chart: {
      type: 'object',
      description: '初始视图，用户可改。',
      properties: {
        type: { type: 'string', enum: CHART_TYPES },
        x: { type: 'string', description: '维度列' },
        y: { type: 'array', items: { type: 'string' }, description: '指标列' },
        agg: { type: 'string', enum: AGGREGATIONS },
        group: { type: 'string', description: '拆系列的列' },
        topN: { type: 'number' },
        sort: { type: 'string', enum: ['none', 'asc', 'desc'] },
        stack: { type: 'boolean' },
        xName: { type: 'string', description: '横轴标题，默认取维度列名' },
        yName: { type: 'string', description: '纵轴标题，默认取指标列名' },
        unit: { type: 'string', description: '纵轴单位，如 "吨"。列名写成 "产量(吨)" 时自动识别' },
      },
    },
  },
  additionalProperties: false,
}

/** The canonical value: compact by construction, because it lands in the log. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    key: { type: 'string' },
    title: { type: 'string' },
    rowCount: { type: 'number' },
    columns: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' },
    sampled: { type: 'boolean' },
    recipe: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok'],
  additionalProperties: true,
}

/**
 * Score a column's fitness as the default dimension. An id-like column with
 * one distinct value per row makes a useless bar chart, and so does a
 * constant one, so both lose to a mid-cardinality category.
 */
function dimensionScore(column, rowCount) {
  if (column.kind === 'number' || column.kind === 'empty') return -1
  if (column.distinct <= 1) return 0
  if (column.kind === 'time') return 100
  if (column.distinct >= rowCount) return 1
  if (column.distinct <= 40) return 50 - Math.abs(12 - column.distinct)
  return 5
}

/** Normalize the caller's `chart` block against the inferred columns. */
function normalizeChart(chart, columns, rowCount) {
  const names = new Set(columns.map(c => c.name))
  const numeric = columns.filter(c => c.kind === 'number').map(c => c.name)
  const ranked = columns
    .map(column => ({ name: column.name, score: dimensionScore(column, rowCount) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
  const raw = chart !== null && typeof chart === 'object' ? chart : {}
  const y = Array.isArray(raw.y) ? raw.y.filter(name => names.has(name)) : []
  const metrics = y.length > 0 ? y : numeric.slice(0, 1)
  return {
    type: CHART_TYPES.includes(raw.type) ? raw.type : 'bar',
    x: names.has(raw.x) ? raw.x : (ranked[0]?.name ?? columns[0]?.name ?? ''),
    y: metrics,
    // With no numeric column to fold there is nothing to sum: counting rows
    // per category is the only reading that means anything.
    agg: AGGREGATIONS.includes(raw.agg) ? raw.agg : (metrics.length === 0 ? 'count' : 'sum'),
    group: names.has(raw.group) ? raw.group : '',
    topN: Number.isFinite(raw.topN) && raw.topN > 0 ? Math.floor(raw.topN) : 0,
    sort: ['none', 'asc', 'desc'].includes(raw.sort) ? raw.sort : 'none',
    stack: raw.stack === true,
    // Axis captions: empty means "derive from the selected columns in the
    // card", which keeps them correct after the user switches dimension or
    // metric locally.
    xName: typeof raw.xName === 'string' ? raw.xName : '',
    yName: typeof raw.yName === 'string' ? raw.yName : '',
    unit: typeof raw.unit === 'string' ? raw.unit : '',
  }
}

/** Fetch a JSON document host-side. Kept minimal on purpose: the host has
 * network access, the browser card does not need it, and nothing about the
 * response reaches the model. */
async function fetchRows(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('url 必须是 http/https：' + url)
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('抓取失败 HTTP ' + response.status + '：' + url)
  const doc = await response.json()
  if (Array.isArray(doc)) return doc
  for (const key of ['rows', 'data', 'items', 'records', 'list', 'result']) {
    if (Array.isArray(doc?.[key])) return doc[key]
  }
  return [doc]
}

/**
 * Build the tool definition.
 * @param {() => string} workspaceRoot - resolves the current workspace root.
 * @returns {object} a plain ToolDefinition (the shape `defineTool` returns).
 */
export function createChartLabTool(workspaceRoot) {
  return {
    name: 'chart_lab',
    description:
      '渲染可交互 ECharts 数据卡片。优先用 file 从工作区读数据——数据不进你的上下文。'
      + '卡片渲染后，图表类型/维度/指标/聚合/筛选/Top-N/排序/导出均由用户在浏览器本地操作，'
      + '不产生工具调用也不通知你：别说"点一下我再改"，也别为这类调整重复调用。'
      + '需要项目专属处理逻辑或额外控件时用 recipe。你只负责选对数据源和初始视图。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      /** The model-facing projection: one line, never the data. */
      render(_args, value) {
        if (value?.ok !== true) {
          return [{ type: 'text', text: 'chart_lab 失败：' + (value?.error ?? '未知错误') }]
        }
        const bits = [
          '已渲染图表卡片「' + value.title + '」',
          value.rowCount + ' 行 × ' + (value.columns?.length ?? 0) + ' 列',
          '来源 ' + value.source,
        ]
        if (value.sampled === true) bits.push('已抽样到 ' + value.rowCount + ' 行')
        if (typeof value.recipe === 'string' && value.recipe !== '') bits.push('功能代码 ' + value.recipe)
        return [{
          type: 'text',
          text: bits.join('；') + '。卡片在用户侧完全可交互（换图表/换维度/筛选/聚合/导出），这些操作不会通知你，无需追问。',
        }]
      },
      /** The card-facing projection: the whole payload, model never sees it. */
      presentationMeta(_args, value) {
        if (value?.ok !== true) {
          return { v: 1, error: value?.error ?? '加载失败', title: value?.title ?? 'chart_lab' }
        }
        const payload = pendingPayloads.get(value.key)
        pendingPayloads.delete(value.key)
        if (payload === undefined) {
          // Only reachable if the harness reordered the two projections; the
          // card then shows a reload hint instead of a blank frame.
          return { v: 1, error: '数据载荷已过期，请重新运行 chart_lab。', title: value.title }
        }
        // Mark the settled result as an artifact: an output, not work detail.
        // The chat keeps artifact results outside the folded turn process and
        // outside collapsed step groups.
        return payload !== null && typeof payload === 'object' && payload.error === undefined
          ? { ...payload, artifact: true }
          : payload
      },
    },
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {}
      const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : '数据卡片'
      const root = workspaceRoot()
      try {
        let rows
        let sourceLabel
        let bytes = 0
        if (typeof input.file === 'string' && input.file !== '') {
          const loaded = loadDatasetFile(input.file, root, input.pick)
          rows = loaded.rows
          bytes = loaded.bytes
          sourceLabel = input.file
        } else if (Array.isArray(input.rows)) {
          rows = input.rows.map(r => (r !== null && typeof r === 'object' && !Array.isArray(r) ? r : { value: r }))
          sourceLabel = '内联数据'
        } else if (typeof input.url === 'string' && input.url !== '') {
          rows = await fetchRows(input.url)
          sourceLabel = input.url
        } else {
          throw new Error('必须提供 file、rows 或 url 之一')
        }
        if (rows.length === 0) throw new Error('数据集为空：' + sourceLabel)

        const capped = sampleRows(rows, MAX_ROWS)
        const columns = inferColumns(capped.rows)
        const chart = normalizeChart(input.chart, columns, capped.rows.length)

        let recipe = null
        if (typeof input.recipe === 'string' && input.recipe !== '') {
          const loaded = loadRecipeFile(input.recipe, root)
          recipe = { path: input.recipe, code: loaded.code }
        }

        const key = 'cl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
        stashPayload(key, {
          v: 1,
          title,
          note: typeof input.note === 'string' ? input.note : '',
          source: { label: sourceLabel, bytes, total: rows.length, sampled: capped.sampled },
          columns,
          rows: capped.rows,
          chart,
          recipe,
        })
        return {
          ok: true,
          key,
          title,
          rowCount: capped.rows.length,
          columns: columns.map(c => c.name),
          source: sourceLabel,
          sampled: capped.sampled,
          recipe: recipe === null ? '' : recipe.path,
        }
      } catch (error) {
        return { ok: false, title, error: error instanceof Error ? error.message : String(error) }
      }
    },
    presentCall(args) {
      const title = typeof args?.title === 'string' ? args.title : undefined
      return title === undefined ? undefined : { card: 'generic', title, kind: 'other' }
    },
    presentResult(args) {
      const title = typeof args?.title === 'string' ? args.title : undefined
      return title === undefined ? undefined : { card: 'generic', title }
    },
  }
}

export { CHART_TYPES, AGGREGATIONS }
