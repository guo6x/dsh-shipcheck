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
import { buildEvidence, evaluateChecks, pageInspectionExpression, renderCheckSummary } from './checks.js'
import { ShipcheckStore } from './store.js'

export const name = 'dsh-shipcheck'
export const inject = ['webServer', 'tools']

const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

async function loadPilot() {
  try {
    return await import('dsh-pilot')
  } catch {
    throw new Error('shipcheck: dsh-pilot is required for a real browser run; install github:guo6x/dsh-pilot in the same DSH profile')
  }
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

const TELEMETRY_LIMIT = 40

function pushTelemetry(list, value) {
  if (list.length >= TELEMETRY_LIMIT || value === undefined || value === null) return
  const serialized = JSON.stringify(value)
  if (list.some(item => JSON.stringify(item) === serialized)) return
  list.push(value)
}

function cdpListener(cdp, method, listener) {
  if (!(cdp?.events instanceof Map)) return () => {}
  const listeners = cdp.events.get(method) ?? []
  listeners.push(listener)
  cdp.events.set(method, listeners)
  return () => {
    const current = cdp.events.get(method) ?? []
    const index = current.indexOf(listener)
    if (index >= 0) current.splice(index, 1)
    if (current.length === 0) cdp.events.delete(method)
  }
}

function remoteArgumentText(argument) {
  if (argument?.value !== undefined) {
    if (typeof argument.value === 'string') return argument.value
    try { return JSON.stringify(argument.value) } catch { return String(argument.value) }
  }
  return argument?.description ?? argument?.unserializableValue ?? argument?.type ?? ''
}

function telemetryRecord({ source, type, message, url, line, column, method, status, status_text, error, resource_type }) {
  const record = { source, type, message: String(message ?? '').slice(0, 1000) }
  for (const [key, value] of Object.entries({ url, line, column, method, status, status_text, error, resource_type })) {
    if (value !== undefined && value !== null && value !== '') record[key] = typeof value === 'string' ? value.slice(0, 1000) : value
  }
  return record
}

async function startTelemetry(pilot) {
  const telemetry = {
    telemetry_available: false,
    console_errors: [],
    console_warnings: [],
    exceptions: [],
    network_failures: [],
  }
  const cdp = pilot?.cdp
  if (typeof cdp?.call !== 'function' || !(cdp.events instanceof Map)) return { telemetry, stop() {} }
  try {
    await cdp.call('Runtime.enable')
    await cdp.call('Network.enable')
    try { await cdp.call('Log.enable') } catch {}
    telemetry.telemetry_available = true
  } catch {
    return { telemetry, stop() {} }
  }

  const requestInfo = new Map()
  const detach = []
  detach.push(cdpListener(cdp, 'Runtime.consoleAPICalled', params => {
    const type = String(params?.type ?? '')
    if (type !== 'error' && type !== 'warning') return
    const frame = params?.stackTrace?.callFrames?.[0]
    const record = telemetryRecord({
      source: 'console',
      type,
      message: (params?.args ?? []).map(remoteArgumentText).filter(Boolean).join(' '),
      url: frame?.url,
      line: typeof frame?.lineNumber === 'number' ? frame.lineNumber + 1 : undefined,
      column: typeof frame?.columnNumber === 'number' ? frame.columnNumber + 1 : undefined,
    })
    pushTelemetry(type === 'error' ? telemetry.console_errors : telemetry.console_warnings, record)
  }))
  detach.push(cdpListener(cdp, 'Runtime.exceptionThrown', params => {
    const details = params?.exceptionDetails ?? {}
    const exception = details.exception ?? {}
    pushTelemetry(telemetry.exceptions, telemetryRecord({
      source: 'runtime',
      type: 'exception',
      message: exception.description ?? details.text ?? 'Uncaught runtime exception',
      url: details.url,
      line: typeof details.lineNumber === 'number' ? details.lineNumber + 1 : undefined,
      column: typeof details.columnNumber === 'number' ? details.columnNumber + 1 : undefined,
    }))
  }))
  detach.push(cdpListener(cdp, 'Network.requestWillBeSent', params => {
    if (params?.requestId === undefined) return
    requestInfo.set(params.requestId, {
      url: params.request?.url,
      method: params.request?.method,
      resource_type: params.type,
    })
  }))
  detach.push(cdpListener(cdp, 'Network.responseReceived', params => {
    const status = Number(params?.response?.status)
    if (!Number.isFinite(status) || status < 400) return
    const request = requestInfo.get(params?.requestId) ?? {}
    pushTelemetry(telemetry.network_failures, telemetryRecord({
      source: 'network',
      type: 'http',
      message: `HTTP ${status} ${params?.response?.statusText ?? ''}`.trim(),
      url: params?.response?.url ?? request.url,
      method: request.method,
      status,
      status_text: params?.response?.statusText,
      resource_type: params?.type ?? request.resource_type,
    }))
  }))
  detach.push(cdpListener(cdp, 'Network.loadingFailed', params => {
    if (params?.canceled || params?.blockedReason) return
    const request = requestInfo.get(params?.requestId) ?? {}
    pushTelemetry(telemetry.network_failures, telemetryRecord({
      source: 'network',
      type: 'failed',
      message: params?.errorText ?? 'Network request failed',
      url: request.url,
      method: request.method,
      error: params?.errorText,
      resource_type: params?.type ?? request.resource_type,
    }))
  }))
  return { telemetry, stop() { for (const remove of detach) remove() } }
}

function object(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

const string = description => ({ type: 'string', description })
const strings = description => ({ type: 'array', items: { type: 'string' }, description })

function matrixRouteKey(url, index) {
  const parsed = new URL(url)
  const host = parsed.host.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'host'
  const path = `${parsed.pathname === '/' ? 'home' : parsed.pathname}${parsed.search}`
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44) || 'route'
  return `${String(index + 1).padStart(2, '0')}-${host}-${path}`
}

function matrixUrls(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new Error('shipcheck: urls must contain between 1 and 20 http(s) URLs')
  }
  return value.map((value, index) => {
    const url = typeof value === 'string' ? value.trim() : ''
    if (!/^https?:\/\//.test(url)) throw new Error(`shipcheck: urls[${index}] must be an http(s) URL`)
    try { new URL(url) } catch { throw new Error(`shipcheck: urls[${index}] must be a valid URL`) }
    return url
  })
}

function renderMatrixSummary(report) {
  if (!report) return 'No shipcheck matrix report yet.'
  const routes = report.evidence?.routes ?? []
  const routeSummary = report.route_summary ?? { total: routes.length, passed: 0, failed: routes.length }
  const lines = [
    `${report.status === 'passed' ? 'PASS' : 'FAIL'} ${routeSummary.passed}/${routeSummary.total} routes passed — ${report.name}`,
    `Report: ${report.id}`,
  ]
  for (const route of routes) {
    const failures = (route.failed_checks ?? []).slice(0, 2).map(check => `[${check.status}] ${check.message}`).join(' ')
    lines.push(`${route.status === 'passed' ? 'PASS' : 'FAIL'} ${route.route} — ${route.url}${failures ? ` — ${failures}` : ''}`)
  }
  return lines.join('\n')
}

function renderHistoryLine(report) {
  if (report.kind === 'matrix') {
    const routes = report.route_summary ?? { passed: 0, total: 0 }
    return `${report.status.toUpperCase()} ${report.name} — ${routes.passed}/${routes.total} routes passed — ${report.summary.failed} failed / ${report.summary.warnings} warnings`
  }
  return `${report.status.toUpperCase()} ${report.name} — ${report.summary.failed} failed / ${report.summary.warnings} warnings — ${report.url}`
}

export class ShipcheckRuntime {
  constructor({ store = new ShipcheckStore(join(dshHome(), 'shipcheck')) } = {}) {
    this.pool = null
    this.pilotModule = null
    this.store = store
    this.last = null
  }

  async run(args = {}, exec = {}) {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!/^https?:\/\//.test(url)) throw new Error('shipcheck: url must be an http(s) URL')
    const nameValue = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : new URL(url).hostname
    this.pilotModule ??= await loadPilot()
    this.pool ??= new this.pilotModule.PilotPool()
    const pilot = this.pool.for(exec.agent?.session?.id ?? 'shipcheck')
    const started = Date.now()
    let snapshot
    let page
    let screenshotPath = null
    let navigationError = null
    let telemetry = { telemetry_available: false, console_errors: [], console_warnings: [], exceptions: [], network_failures: [] }
    let stopTelemetry = () => {}
    try {
      await pilot.withOp(() => pilot.ensure())
      const capture = await startTelemetry(pilot)
      telemetry = capture.telemetry
      stopTelemetry = capture.stop
      snapshot = await pilot.withOp(() => pilot.navigate(url))
      if (args.wait_ms) await pilot.withOp(() => pilot.wait(args.wait_ms))
      snapshot = await pilot.withOp(() => pilot.snapshot())
      const inspected = await pilot.withOp(() => pilot.evalJs(pageInspectionExpression()))
      if (!inspected.ok) throw new Error(inspected.error ?? 'page inspection failed')
      page = inspected.value
      const artifactDir = join(dshHome(), 'shipcheck', 'artifacts')
      await mkdir(artifactDir, { recursive: true })
      const shot = await this.pilotModule.saveScreenshot(pilot, join(artifactDir, `${Date.now()}-${nameValue.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)}.png`))
      screenshotPath = shot.path
    } catch (error) {
      navigationError = String(error.message ?? error)
    } finally {
      stopTelemetry()
    }
    const baseline = await this.store.getBaseline(args.baseline ?? nameValue)
    const evidence = navigationError === null
      ? buildEvidence({ url, title: snapshot?.title, snapshot, page, runtime: telemetry, screenshotPath })
      : buildEvidence({ url, title: '', snapshot: { text: '', links: [], buttons: 0, inputs: 0 }, page: {}, runtime: telemetry, screenshotPath })
    const checks = navigationError === null
      ? evaluateChecks(evidence, { ...args, baseline_requested: Boolean(args.baseline ?? nameValue) }, baseline)
      : { status: 'failed', passed: false, checks: [{ id: 'browser.navigate', category: 'availability', status: 'fail', message: `Browser could not load the page: ${navigationError}`, evidence: { url } }], summary: { total: 1, passed: 0, warnings: 0, failed: 1 } }
    const reportData = {
      name: nameValue,
      url,
      baseline: baseline ? (args.baseline ?? nameValue) : null,
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      status: checks.status,
      summary: checks.summary,
      checks: checks.checks,
      evidence,
    }
    if (args.matrix !== undefined) reportData.matrix = args.matrix
    const report = await this.store.saveReport(reportData)
    this.last = report
    return report
  }

  async matrix(args = {}, exec = {}) {
    const urls = matrixUrls(args.urls)
    const matrixName = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : new URL(urls[0]).hostname
    const baselineRoot = typeof args.baseline === 'string' && args.baseline.trim() ? args.baseline.trim() : matrixName
    this.pilotModule ??= await loadPilot()
    this.pool ??= new this.pilotModule.PilotPool()
    const started = Date.now()
    const routes = []

    for (let index = 0; index < urls.length; index++) {
      const url = urls[index]
      const route = matrixRouteKey(url, index)
      const routeName = `${matrixName}/${route}`
      const routeBaseline = `${baselineRoot}/${route}`
      try {
        const report = await this.run({
          ...args,
          url,
          name: routeName,
          baseline: routeBaseline,
          matrix: { name: matrixName, index: index + 1, total: urls.length, route, baseline: routeBaseline },
        }, exec)
        routes.push({ report, index: index + 1, route, name: routeName, baseline: routeBaseline, url })
      } catch (error) {
        const message = String(error?.message ?? error)
        routes.push({
          report: null,
          index: index + 1,
          route,
          name: routeName,
          baseline: routeBaseline,
          url,
          status: 'failed',
          summary: { total: 1, passed: 0, warnings: 0, failed: 1 },
          failed_checks: [{ id: 'matrix.route', category: 'availability', status: 'fail', message, evidence: { url } }],
        })
      }
    }

    const routeEvidence = routes.map(item => {
      const report = item.report
      return {
        index: item.index,
        route: item.route,
        name: item.name,
        baseline: item.baseline,
        url: item.url,
        report_id: report?.id ?? null,
        status: report?.status ?? item.status,
        summary: report?.summary ?? item.summary,
        screenshot_path: report?.evidence?.screenshot_path ?? null,
        failed_checks: report
          ? report.checks.filter(check => check.status !== 'pass').slice(0, 8)
          : item.failed_checks,
      }
    })
    const checks = routes.flatMap(item => {
      const routeChecks = item.report?.checks ?? item.failed_checks ?? []
      return routeChecks.map(check => ({
        ...check,
        id: `route:${item.route}::${check.id}`,
        message: `[${item.route}] ${check.message}`,
        evidence: { ...check.evidence, route: item.route, url: item.url, report_id: item.report?.id ?? null },
      }))
    })
    const summary = {
      total: checks.length,
      passed: checks.filter(check => check.status === 'pass').length,
      warnings: checks.filter(check => check.status === 'warn').length,
      failed: checks.filter(check => check.status === 'fail').length,
    }
    const routeSummary = {
      total: routes.length,
      passed: routes.filter(item => (item.report?.status ?? item.status) === 'passed').length,
      failed: routes.filter(item => (item.report?.status ?? item.status) !== 'passed').length,
    }
    const report = await this.store.saveReport({
      kind: 'matrix',
      name: matrixName,
      url: `matrix://${matrixName}`,
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      status: routeSummary.failed === 0 ? 'passed' : 'failed',
      summary,
      route_summary: routeSummary,
      checks,
      evidence: { type: 'matrix', name: matrixName, routes: routeEvidence },
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
    if (this.pool !== null) await this.pool.disposeAll()
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
      define('shipcheck_run', 'Run evidence-first frontend acceptance checks in a real browser. Captures a screenshot, checks content/accessibility/layout/contracts and browser runtime failures, compares a named baseline when present, and saves a reproducible JSON report. It never edits the project.', object({
        url: string('Full http(s) URL to inspect.'),
        name: string('Optional project/baseline name; defaults to the URL hostname.'),
        baseline: string('Optional named baseline; defaults to the project name.'),
        wait_ms: { type: 'number', description: 'Optional settle time from 0 to 30000 ms.' },
        required_text: strings('Optional visible strings that must be present.'),
        forbidden_text: strings('Optional visible strings that must be absent.'),
        required_selectors: strings('Optional CSS selectors that must exist.'),
      }, ['url']), args => runtime.run(args), value => `${renderCheckSummary(value)}\nReport: ${value.id}\nScreenshot: ${value.evidence.screenshot_path}\n${value.checks.filter(check => check.status !== 'pass').slice(0, 8).map(check => `[${check.status}] ${check.message}`).join('\n')}`),
      define('shipcheck_matrix', 'Run the same evidence-first release checks across 1-20 URLs in a real browser. Each route gets its own screenshot, JSON report, and namespaced baseline; the returned matrix report shows the overall gate and every route failure with evidence.', object({
        urls: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' }, description: 'One to twenty full http(s) URLs to inspect in order.' },
        name: string('Optional matrix name; defaults to the first URL hostname.'),
        baseline: string('Optional baseline namespace; each route uses a separate generated baseline name.'),
        wait_ms: { type: 'number', description: 'Optional settle time from 0 to 30000 ms, applied to every route.' },
        required_text: strings('Optional visible strings that must be present on every route.'),
        forbidden_text: strings('Optional visible strings that must be absent on every route.'),
        required_selectors: strings('Optional CSS selectors that must exist on every route.'),
      }, ['urls']), args => runtime.matrix(args), renderMatrixSummary),
      define('shipcheck_baseline', 'Capture a reviewed page as a named shipcheck baseline. Future shipcheck_run calls compare structural evidence and report regressions; this is an explicit write and never modifies the inspected page.', object({
        url: string('Full http(s) URL to inspect.'),
        name: string('Stable project/baseline name.'),
        wait_ms: { type: 'number', description: 'Optional settle time from 0 to 30000 ms.' },
      }, ['url', 'name']), args => runtime.baseline(args), value => `Baseline saved: ${value.name}\nInitial run: ${value.report_id} (${value.status})`),
      define('shipcheck_history', 'List recent shipcheck reports with their pass/fail summary and evidence paths.', object({ limit: { type: 'number', description: 'Number of recent reports, 1-50; default 12.' } }), args => runtime.history(args.limit), value => value.length ? value.map(renderHistoryLine).join('\n') : 'No shipcheck reports yet.'),
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
        if (req.method === 'POST' && suffix === '/matrix') return sendJson(res, 200, await runtime.matrix(JSON.parse(await readBody(req) || '{}'), { agent: { session: { id: 'shipcheck-panel' } } }))
        if (req.method === 'POST' && suffix === '/baseline') return sendJson(res, 200, await runtime.baseline(JSON.parse(await readBody(req) || '{}'), { agent: { session: { id: 'shipcheck-panel' } } }))
        return sendJson(res, 404, { error: 'no such endpoint' })
      } catch (error) { return sendJson(res, 400, { error: String(error.message ?? error) }) }
    },
  }), 'dsh-shipcheck: web routes')
  ctx.effect(() => () => runtime.dispose(), 'dsh-shipcheck: runtime cleanup')
}
