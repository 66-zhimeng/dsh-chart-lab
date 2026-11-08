#!/usr/bin/env node
/**
 * DSH chat patch: keep artifact tool results out of folded work details.
 *
 * A tool result whose presentation meta carries `artifact: true` is an output,
 * so the chat must not fold it into the completed Turn's work details, and must
 * not swallow it into a collapsed step group. `dsh` ships this behaviour in the
 * browser bundle of `@deepseek-ai/dsh-client-ui-chat`; until the contract lands
 * upstream, this script patches the installed copy in place.
 *
 *   node patches/artifact-results.mjs              # apply
 *   node patches/artifact-results.mjs --revert     # restore the backup
 *   node patches/artifact-results.mjs --check      # report only
 *   node patches/artifact-results.mjs --dsh /path/to/dsh
 *
 * The first apply writes `<bundle>.orig` beside the patched file. An upgraded
 * `dsh` replaces the bundle wholesale, so re-run the script after upgrading.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHAT_PACKAGE = join('node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js')

/** Resolve the installed dsh package root from `which dsh`, when possible. */
function detectDsh() {
  try {
    const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
    let dir = dirname(realpathSync(bin))
    for (let depth = 0; depth < 6; depth += 1) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
        if (pkg.name === '@deepseek-ai/dsh') return dir
      }
      dir = dirname(dir)
    }
  } catch {
    // Fall through to the explicit --dsh argument.
  }
  return undefined
}

function parseArgs(argv) {
  const options = { revert: false, check: false, dsh: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--revert') options.revert = true
    else if (arg === '--check') options.check = true
    else if (arg === '--dsh') options.dsh = argv[++index]
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

const HELPER_PROCESS = `\t\t/**
\t\t* Whether a settled Tool result declared itself an artifact (meta.artifact).
\t\t* Artifacts are outputs, so they stay outside the folded work-details window.
\t\t* @param node - routed chat node.
\t\t* @returns true when the call result carries the artifact marker.
\t\t*/
\t\tfunction isArtifactNode(node) {
\t\t\tif (node === void 0 || node === null || node.kind !== "tool-call") return false;
\t\t\tconst data = node.data;
\t\t\tconst root = data === void 0 || data === null ? void 0 : data.root;
\t\t\tconst meta = root === void 0 || root === null ? void 0 : root.meta;
\t\t\treturn meta !== void 0 && meta !== null && typeof meta === "object" && meta.artifact === true;
\t\t}

`

const HELPER_GROUP = `\t\t/**
\t\t* Whether a Tool node is an artifact (its result meta carries artifact: true).
\t\t* Artifacts are outputs: they sit outside a step group instead of inside it.
\t\t* @param node - chat node.
\t\t* @returns true for artifact tool results.
\t\t*/
\t\tfunction isArtifactChatNode(node) {
\t\t\tif (node === void 0 || node === null || node.kind !== "tool-call") return false;
\t\t\tconst data = node.data;
\t\t\tconst root = data === void 0 || data === null ? void 0 : data.root;
\t\t\tconst meta = root === void 0 || root === null ? void 0 : root.meta;
\t\t\treturn meta !== void 0 && meta !== null && typeof meta === "object" && meta.artifact === true;
\t\t}

`

const PROCESS_ANCHOR = '\t\tfunction hasAssistantReplyContent(blocks) {'
const PROCESS_BEFORE = 'const processMember = routedNode !== void 0 && processWindowReady && !replyRow && !isAtOrOutside(routedNode, "turn")'
const PROCESS_AFTER = 'const processMember = routedNode !== void 0 && processWindowReady && !replyRow && !isArtifactNode(routedNode) && !isAtOrOutside(routedNode, "turn")'
const GROUP_ANCHOR = '\t\tvar TurnGroups = class {'
const GROUP_BEFORE = 'if (isAtOrOutside(node, "process")) {'
const GROUP_AFTER = 'if (isAtOrOutside(node, "process") || isArtifactChatNode(node)) {'

function main() {
  const options = parseArgs(process.argv.slice(2))
  const dsh = options.dsh ?? detectDsh()
  if (dsh === undefined) {
    console.error('cannot locate the installed dsh package; pass --dsh <path>')
    process.exit(2)
  }
  const bundle = join(dsh, CHAT_PACKAGE)
  if (!existsSync(bundle)) {
    console.error(`chat bundle not found: ${bundle}`)
    process.exit(2)
  }
  const backup = `${bundle}.orig`
  const current = readFileSync(bundle, 'utf8')
  const applied = current.includes('isArtifactNode') && current.includes('isArtifactChatNode')

  if (options.check) {
    console.log(`${applied ? 'applied' : 'not applied'}: ${bundle}`)
    return
  }
  if (options.revert) {
    if (!existsSync(backup)) {
      console.error(`no backup to restore: ${backup}`)
      process.exit(1)
    }
    writeFileSync(bundle, readFileSync(backup))
    console.log(`restored ${bundle}`)
    return
  }
  if (applied) {
    console.log(`already applied: ${bundle}`)
    return
  }

  if (!existsSync(backup)) writeFileSync(backup, current)
  let next = current.replace(PROCESS_ANCHOR, HELPER_PROCESS + PROCESS_ANCHOR)
  if (next === current) throw new Error('process anchor missing')
  const body = next
  if (!body.includes(PROCESS_BEFORE) && !body.includes(PROCESS_AFTER)) throw new Error('process member anchor missing')
  next = body.replace(PROCESS_BEFORE, PROCESS_AFTER)
  next = next.replace(GROUP_ANCHOR, HELPER_GROUP + GROUP_ANCHOR)
  const groupStart = next.indexOf(GROUP_ANCHOR)
  const groupAt = next.indexOf(GROUP_BEFORE, groupStart)
  if (groupAt === -1) throw new Error('group membership anchor missing')
  next = next.slice(0, groupAt) + GROUP_AFTER + next.slice(groupAt + GROUP_BEFORE.length)
  writeFileSync(bundle, next)
  console.log(`patched ${bundle}\nbackup: ${backup}\nrefresh the page to load the new bundle.`)
}

const invoked = process.argv[1] === undefined ? '' : fileURLToPath(new URL(`file://${process.argv[1]}`))
if (invoked !== '' && fileURLToPath(import.meta.url) === invoked) main()
