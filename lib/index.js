/**
 * dsh-chart-lab, node half: registers the `chart_lab` tool, serves the
 * lazily-loaded ECharts bundle from this package's own directory, and adds
 * one short system-prompt section describing the project-local recipe
 * contract (the one thing the model cannot infer from the tool schema).
 *
 * Both service lookups are OPTIONAL probes rather than cordis `inject`
 * entries. This plugin injects only `systemPrompt`, so cordis starts it
 * early — before `tools` and `webServer` have bound. A one-shot lookup at
 * apply time would silently miss both on a real host, so each registration
 * probes immediately AND subscribes to `internal/service`, landing whenever
 * its service appears.
 * @module dsh-chart-lab
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createChartLabTool } from './tool.js'

/** Optional vendored assets directory inside this package. */
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets')

/**
 * Where each servable asset actually lives. `echarts.js` normally resolves
 * out of the installed `echarts` package, so the repository carries no
 * vendored copy of a 1 MB third-party bundle; a file dropped into
 * `lib/assets/` still wins, which keeps air-gapped installs working.
 */
const require = createRequire(import.meta.url)

function resolveAsset(file) {
  const vendored = join(ASSET_DIR, file)
  if (file !== 'echarts.js') return vendored
  try {
    return require.resolve('echarts/dist/echarts.min.js')
  } catch {
    return vendored
  }
}
/** Route prefix; longer than the generic `/plugins` bundle route, so it wins. */
const ASSET_ROUTE_PATH = '/plugins/dsh-chart-lab/assets'
/** Flat `.js` names only — no slashes, no traversal. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/
/** Convention: tool guidance sections use order 100–199. */
const SECTION_ORDER = 106

/**
 * The one thing the tool schema cannot express: the recipe file contract.
 * Everything else about `chart_lab` (when to use it, that the card is
 * self-service) lives in the tool description, which the model already
 * receives — repeating it here would be a per-request tax for nothing.
 */
const SECTION_TEXT = [
  '## chart_lab recipe',
  '',
  '`chart_lab` 的 `recipe` 参数指向工作区 JS 文件（惯例 `.dshviz/recipes/*.js`），为卡片追加自定义控件与本地处理逻辑。文件是函数体，`return` 一个对象；两个函数都在浏览器里跑，用户操作不会回到你这里：',
  '',
  '```js',
  'return {',
  '  controls: [',
  '    { id: "win", kind: "select", label: "窗口", options: ["7d","30d"], value: "7d" },',
  '    { id: "on",  kind: "toggle", label: "累计", value: false },',
  '    { id: "min", kind: "slider", label: "下限", min: 0, max: 100, value: 0 },',
  '  ],',
  '  transform({ rows, state, columns, h }) { return rows },  // 可选：改数据',
  '  option({ option, rows, view, state, h }) { return option }, // 可选：改 ECharts 配置',
  '}',
  '```',
  '',
  '`controls` 是本 recipe 控件的值；`state` 是内置视图状态（叠加了 controls）；`h` 提供 `groupBy/sum/avg/median/min/max/num/label/uniq/parseDate/fmt`。',
  '',
  '**控件 id 不得使用**：type / x / y / agg / group / topN / sort / stack / smooth / filters / view / height —— 这些是内置控件名，重名会让内置按钮失灵。',
  '切换图表类型、平滑、堆叠、筛选、Top-N、排序、聚合内置已有按钮，**不要**用 recipe 重复实现；recipe 只写内置没有的逻辑。',
].join('\n')

/** Serve one asset file from this package's `lib/assets` directory. */
async function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  if (!pathname.startsWith(ASSET_ROUTE_PATH + '/')) {
    res.writeHead(404)
    res.end()
    return
  }
  const file = pathname.slice(ASSET_ROUTE_PATH.length + 1)
  if (!ASSET_FILE_RE.test(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const body = await readFile(resolveAsset(file))
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'content-length': String(body.byteLength),
      'cache-control': 'no-cache',
    })
    if (req.method === 'HEAD') { res.end(); return }
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/**
 * Attach one optional service registration: probe now, and again whenever a
 * service binds, running `register` the first time the named service exists.
 * @param {object} ctx - cordis context.
 * @param {string} serviceName - service to wait for.
 * @param {(service: object) => void} register - runs at most once.
 */
function whenService(ctx, serviceName, register) {
  let done = false
  const attempt = (candidate) => {
    if (done) return
    const service = candidate ?? ctx.reflect.get(serviceName, false)
    if (service === undefined || service === null) return
    register(service)
    done = true
  }
  attempt(undefined)
  ctx.on('internal/service', (name, value) => {
    if (name === serviceName) attempt(value)
  })
}

export const inject = ['systemPrompt']

export function apply(ctx) {
  ctx.systemPrompt.section({ name: 'chart-lab', order: SECTION_ORDER, text: SECTION_TEXT })

  // The workspace root is the directory dsh was booted from; dataset paths
  // resolve against it and may not escape it.
  const workspaceRoot = () => process.cwd()

  whenService(ctx, 'tools', (tools) => {
    // Hot reload must not fail when an earlier activation left its registration
    // behind: these services have no context-scoped disposer of their own.
    try {
      tools.register(createChartLabTool(workspaceRoot))
    } catch (error) {
      if (!/duplicate|already/i.test(String(error && error.message))) throw error
    }
  })

  whenService(ctx, 'webServer', (webServer) => {
    try {
      webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: serveAsset })
    } catch (error) {
      if (!/duplicate|already/i.test(String(error && error.message))) throw error
    }
  })
}
