/**
 * Dataset loading and shaping for the `chart_lab` tool — the HOST half.
 *
 * Everything here runs in the dsh node process, never in the model's
 * context: `execute()` reads the file, parses it, infers the column types
 * and hands the rows to `presentationMeta`, which ships them straight to the
 * browser card. The model only ever sees the one-line summary that
 * `output.render` produces, so a 100k-row file costs zero prompt tokens.
 * @module dsh-chart-lab/dataset
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath, relative, extname } from 'node:path'

/** Hard ceiling on rows handed to one card; beyond this the payload is sampled. */
export const MAX_ROWS = 200000
/** Hard ceiling on the recipe source size (project-local JS, not model output). */
export const MAX_RECIPE_BYTES = 256 * 1024
/** Values scanned per column when inferring its type. */
const TYPE_SAMPLE = 200
/** Distinct values collected per column before the scan gives up. */
const DISTINCT_CAP = 500
/** Distinct-value ceiling under which a category column offers filter chips. */
const FILTER_VALUE_CAP = 60

/**
 * Resolve a caller-supplied path against the workspace root, refusing to
 * escape it. The model names files; a traversal out of the workspace is
 * always a mistake, never a legitimate chart source.
 * @param {string} candidate - path as written by the caller.
 * @param {string} root - workspace root (the directory dsh was booted from).
 * @returns {string} absolute path inside the root.
 */
export function resolveInWorkspace(candidate, root) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('路径为空')
  }
  const abs = isAbsolute(candidate) ? candidate : resolvePath(root, candidate)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越出工作区：${candidate}（工作区 ${root}）`)
  }
  return abs
}

/** Split one CSV line, honouring double-quoted fields and "" escapes. */
function splitCsvLine(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch !== '"') { field += ch; continue }
      if (line[i + 1] === '"') { field += '"'; i += 1; continue }
      quoted = false
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { out.push(field); field = ''; continue }
    field += ch
  }
  out.push(field)
  return out
}

/** Coerce a CSV cell to number/boolean/null when it unambiguously is one. */
function coerceCell(raw) {
  const text = raw.trim()
  if (text === '') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === 'NULL') return null
  // Only plain decimal forms convert; "007" and "1e5" stay strings so ids
  // and codes never silently lose their leading zeros or change shape.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) {
    const n = Number(text)
    if (Number.isFinite(n)) return n
  }
  return text
}

/** Parse CSV text (first line = header) into row records. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]).map((name, i) => (name.trim() === '' ? 'col' + (i + 1) : name.trim()))
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i])
    const row = {}
    for (let c = 0; c < header.length; c += 1) row[header[c]] = coerceCell(cells[c] ?? '')
    rows.push(row)
  }
  return rows
}

/** Parse newline-delimited JSON, skipping blank lines. */
function parseNdjson(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    rows.push(JSON.parse(trimmed))
  }
  return rows
}

/**
 * Walk a dotted path into a parsed JSON document, so a file shaped like
 * `{ "result": { "series": [...] } }` needs no pre-processing step.
 */
function pickPath(doc, path) {
  if (path === undefined || path === '') return doc
  let cursor = doc
  for (const segment of String(path).split('.')) {
    if (cursor === null || typeof cursor !== 'object') {
      throw new Error('pick 路径 "' + path + '" 在 "' + segment + '" 处断开')
    }
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment]
  }
  return cursor
}

/**
 * Turn an arbitrary parsed document into a row array. Accepts the array
 * form, the `{ rows|data|items|records: [...] }` wrappers, and a
 * column-oriented `{ a: [...], b: [...] }` table.
 */
function toRows(doc, path) {
  const picked = pickPath(doc, path)
  if (Array.isArray(picked)) {
    return picked.map(entry => (entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry : { value: entry }))
  }
  if (picked === null || typeof picked !== 'object') {
    throw new Error('数据既不是数组也不是对象，无法作为表格读取')
  }
  for (const key of ['rows', 'data', 'items', 'records', 'list', 'result']) {
    if (Array.isArray(picked[key])) return toRows(picked[key], undefined)
  }
  // Column-oriented fallback: every value an equal-length array.
  const keys = Object.keys(picked).filter(k => Array.isArray(picked[k]))
  if (keys.length > 0) {
    const length = Math.max(...keys.map(k => picked[k].length))
    const rows = []
    for (let i = 0; i < length; i += 1) {
      const row = {}
      for (const k of keys) row[k] = picked[k][i] ?? null
      rows.push(row)
    }
    return rows
  }
  // Single record: a one-row table is still a legitimate (if dull) chart.
  return [picked]
}

/**
 * Read one dataset file from the workspace.
 * @param {string} file - workspace-relative or absolute path.
 * @param {string} root - workspace root.
 * @param {string|undefined} pick - dotted path into the parsed document.
 * @returns {{rows: object[], bytes: number, path: string}}
 */
export function loadDatasetFile(file, root, pick) {
  const abs = resolveInWorkspace(file, root)
  const text = readFileSync(abs, 'utf8')
  const ext = extname(abs).toLowerCase()
  let rows
  if (ext === '.csv') rows = parseCsv(text)
  else if (ext === '.tsv') rows = parseCsv(text.replace(/\t/g, ','))
  else if (ext === '.ndjson' || ext === '.jsonl') rows = parseNdjson(text)
  else rows = toRows(JSON.parse(text), pick)
  return { rows, bytes: Buffer.byteLength(text), path: abs }
}

/** Read a project-local recipe module's source text (never evaluated here). */
export function loadRecipeFile(file, root) {
  const abs = resolveInWorkspace(file, root)
  const code = readFileSync(abs, 'utf8')
  if (Buffer.byteLength(code) > MAX_RECIPE_BYTES) {
    throw new Error('功能代码超过 ' + Math.round(MAX_RECIPE_BYTES / 1024) + 'KB：' + file)
  }
  return { code, path: abs }
}

/** Classify one column from a sample of its values. */
function classify(values) {
  let numbers = 0
  let dates = 0
  let seen = 0
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    seen += 1
    if (typeof value === 'number' && Number.isFinite(value)) { numbers += 1; continue }
    if (typeof value === 'string') {
      // ISO-ish date/time prefixes only — a loose Date.parse would happily
      // swallow ordinary labels and mislabel every category column.
      if (/^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2})?/.test(value)) { dates += 1; continue }
      if (Number.isFinite(Number(value))) { numbers += 1 }
    }
  }
  if (seen === 0) return 'empty'
  if (dates / seen > 0.8) return 'time'
  if (numbers / seen > 0.8) return 'number'
  return 'category'
}

/**
 * Infer the column set of a row array: name, inferred kind, distinct-value
 * count (capped) and, for low-cardinality categories, the value list the
 * card's filter controls offer.
 * @param {object[]} rows
 * @returns {Array<{name:string,kind:string,distinct:number,values?:Array}>}
 */
export function inferColumns(rows) {
  const names = []
  const seenNames = new Set()
  for (const row of rows.slice(0, TYPE_SAMPLE)) {
    for (const key of Object.keys(row)) {
      if (seenNames.has(key)) continue
      seenNames.add(key)
      names.push(key)
    }
  }
  const sample = rows.slice(0, TYPE_SAMPLE)
  return names.map((name) => {
    const kind = classify(sample.map(row => row[name]))
    const distinct = new Set()
    for (const row of rows) {
      const value = row[name]
      if (value === null || value === undefined) continue
      distinct.add(typeof value === 'object' ? JSON.stringify(value) : value)
      if (distinct.size > DISTINCT_CAP) break
    }
    const column = { name, kind, distinct: distinct.size }
    // Only low-cardinality categories get a value list: it powers the card's
    // filter chips, and a 500-entry dropdown helps nobody.
    if (kind !== 'number' && distinct.size <= FILTER_VALUE_CAP) {
      column.values = [...distinct].map(v => (typeof v === 'boolean' ? String(v) : v)).sort()
    }
    return column
  })
}

/** Evenly sample an oversized row array down to `limit` rows. */
export function sampleRows(rows, limit) {
  if (rows.length <= limit) return { rows, sampled: false }
  const step = rows.length / limit
  const out = []
  for (let i = 0; i < limit; i += 1) out.push(rows[Math.floor(i * step)])
  return { rows: out, sampled: true }
}
