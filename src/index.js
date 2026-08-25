/**
 * dsh-shipcheck — evidence-first frontend release checks.
 *
 * It reuses dsh-pilot's real browser engine, then owns the durable part:
 * deterministic checks, named baselines, screenshots, and reproducible JSON
 * reports. It deliberately does not auto-fix pages or send external requests.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { PilotPool, saveScreenshot } from 'dsh-pilot'
import { buildEvidence, evaluateChecks, pageInspectionExpression, renderCheckSummary } from './checks.js'
import { ShipcheckStore } from './store.js'

export const name = 'dsh-shipcheck'
export const inject = ['webServer', 'tools']

const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > 65536) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function object(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

const string = description => ({ type: 'string', description })
const strings = description => ({ type: 'array', items: { type: 'string' }, description })

export class ShipcheckRuntime {
  constructor({ store = new ShipcheckStore(join(dshHome(), 'shipcheck')) } = {}) {
    this.pool = new PilotPool()
    this.store = store
    this.last = null
  }

  async run(args = {}, exec = {}) {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!/^https?:\/\//.test(url)) throw new Error('shipcheck: url must be an http(s) URL')
    const nameValue = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : new URL(url).hostname
    const pilot = this.pool.for(exec.agent?.session?.id ?? 'shipcheck')
    const started = Date.now()
    let snapshot
    let page
    let screenshotPath = null
    let navigationError = null
    try {
      snapshot = await pilot.withOp(() => pilot.navigate(url))
      if (args.wait_ms) await pilot.withOp(() => pilot.wait(args.wait_ms))
      snapshot = await pilot.withOp(() => pilot.snapshot())
      const inspected = await pilot.withOp(() => pilot.evalJs(pageInspectionExpression()))
      if (!inspected.ok) throw new Error(inspected.error ?? 'page inspection failed')
      page = inspected.value
      const artifactDir = join(dshHome(), 'shipcheck', 'artifacts')
      await mkdir(artifactDir, { recursive: true })
      const shot = await saveScreenshot(pilot, join(artifactDir, `${Date.now()}-${nameValue.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)}.png`))
      screenshotPath = shot.path
    } catch (error) {
      navigationError = String(error.message ?? error)
    }
    const baseline = await this.store.getBaseline(args.baseline ?? nameValue)
    const evidence = navigationError === null
      ? buildEvidence({ url, title: snapshot?.title, snapshot, page, screenshotPath })
      : buildEvidence({ url, title: '', snapshot: { text: '', links: [], buttons: 0, inputs: 0 }, page: {}, screenshotPath })
    const checks = navigationError === null
      ? evaluateChecks(evidence, { ...args, baseline_requested: Boolean(args.baseline ?? nameValue) }, baseline)
      : { status: 'failed', passed: false, checks: [{ id: 'browser.navigate', category: 'availability', status: 'fail', message: `Browser could not load the page: ${navigationError}`, evidence: { url } }], summary: { total: 1, passed: 0, warnings: 0, failed: 1 } }
    const report = await this.store.saveReport({
      name: nameValue,
      url,
      baseline: baseline ? (args.baseline ?? nameValue) : null,
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      status: checks.status,
      summary: checks.summary,
      checks: checks.checks,
      evidence,
    })
    this.last = report
    return report
  }

  async baseline(args = {}, exec = {}) {
    const report = await this.run({ ...args, baseline: null }, exec)
    const baseline = await this.store.saveBaseline(args.name ?? new URL(args.url).hostname, report.evidence)
    return { ...baseline, report_id: report.id, status: report.status, summary: report.summary }
  }

  async history(limit) {
    return this.store.history(limit)
  }

  async dispose() {
    await this.pool.disposeAll()
  }
}

export function apply(ctx) {
  const runtime = new ShipcheckRuntime()
  const tools = ctx.tools
  if (tools !== undefined) {
    const define = (toolName, description, parameters, execute, render) => ({
      name: toolName,
      description,
      parameters,
      timeoutMs: 120000,
      output: { schema: { type: 'object' }, render(_args, value) { return [{ type: 'text', text: render(value) }] } },
      async execute(args, exec) { if (exec?.signal?.aborted) throw new Error('aborted'); return execute(args, exec) },
    })
    const defs = [
      define('shipcheck_run', 'Run evidence-first frontend acceptance checks in a real browser. Captures a screenshot, checks content/accessibility/layout/contracts, compares a named baseline when present, and saves a reproducible JSON report. It never edits the project.', object({
        url: string('Full http(s) URL to inspect.'),
        name: string('Optional project/baseline name; defaults to the URL hostname.'),
        baseline: string('Optional named baseline; defaults to the project name.'),
        wait_ms: { type: 'number', description: 'Optional settle time from 0 to 30000 ms.' },
        required_text: strings('Optional visible strings that must be present.'),
        forbidden_text: strings('Optional visible strings that must be absent.'),
        required_selectors: strings('Optional CSS selectors that must exist.'),
      }, ['url']), args => runtime.run(args), value => `${renderCheckSummary(value)}\nReport: ${value.id}\nScreenshot: ${value.evidence.screenshot_path}\n${value.checks.filter(check => check.status !== 'pass').slice(0, 8).map(check => `[${check.status}] ${check.message}`).join('\n')}`),
      define('shipcheck_baseline', 'Capture a reviewed page as a named shipcheck baseline. Future shipcheck_run calls compare structural evidence and report regressions; this is an explicit write and never modifies the inspected page.', object({
        url: string('Full http(s) URL to inspect.'),
        name: string('Stable project/baseline name.'),
        wait_ms: { type: 'number', description: 'Optional settle time from 0 to 30000 ms.' },
      }, ['url', 'name']), args => runtime.baseline(args), value => `Baseline saved: ${value.name}\nInitial run: ${value.report_id} (${value.status})`),
      define('shipcheck_history', 'List recent shipcheck reports with their pass/fail summary and evidence paths.', object({ limit: { type: 'number', description: 'Number of recent reports, 1-50; default 12.' } }), args => runtime.history(args.limit), value => value.length ? value.map(report => `${report.status.toUpperCase()} ${report.name} — ${report.summary.failed} failed / ${report.summary.warnings} warnings — ${report.url}`).join('\n') : 'No shipcheck reports yet.'),
    ]
    for (const def of defs) ctx.effect(() => tools.register(def), `dsh-shipcheck: tool ${def.name}`)
  }

  const webServer = ctx.webServer
  if (webServer !== undefined) ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/dsh-shipcheck',
    handler: async (req, res) => {
      if (!LOOPBACKS.has(req.socket.remoteAddress ?? '')) return sendJson(res, 403, { error: 'loopback only' })
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const suffix = pathname.slice('/dsh-shipcheck'.length) || '/'
      try {
        if (req.method === 'GET' && suffix === '/state') return sendJson(res, 200, { last: runtime.last, history: await runtime.history(8) })
        if (req.method === 'GET' && suffix === '/history') return sendJson(res, 200, await runtime.history(20))
        if (req.method === 'POST' && suffix === '/run') return sendJson(res, 200, await runtime.run(JSON.parse(await readBody(req) || '{}'), { agent: { session: { id: 'shipcheck-panel' } } }))
        if (req.method === 'POST' && suffix === '/baseline') return sendJson(res, 200, await runtime.baseline(JSON.parse(await readBody(req) || '{}'), { agent: { session: { id: 'shipcheck-panel' } } }))
        return sendJson(res, 404, { error: 'no such endpoint' })
      } catch (error) { return sendJson(res, 400, { error: String(error.message ?? error) }) }
    },
  }), 'dsh-shipcheck: web routes')
  ctx.effect(() => () => runtime.dispose(), 'dsh-shipcheck: runtime cleanup')
}
