import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShipcheckStore } from '../src/store.js'
import { buildEvidence, evaluateChecks, pageInspectionExpression } from '../src/checks.js'
import { ShipcheckRuntime } from '../src/index.js'

let failed = 0
const check = (label, condition, extra = '') => {
  const ok = Boolean(condition)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}

const evidence = buildEvidence({
  url: 'http://localhost:3000/',
  title: 'Shipcheck demo',
  snapshot: { text: 'Shipcheck demo Release ready', links: [{}, {}], buttons: 2, inputs: 1, elements: [{}, {}] },
  page: { h1: ['Shipcheck demo'], h2_count: 2, images: 1, images_missing_alt: [], unlabeled_controls: [], links_missing_name: [], horizontal_overflow: false, viewport: { width: 1280, height: 720, scroll_width: 1280 }, resource_count: 3, resource_urls: ['http://localhost:3000/app.js'], selectors: ['main'] },
  runtime: { telemetry_available: true, console_errors: [], console_warnings: [], exceptions: [], network_failures: [] },
  screenshotPath: 'C:/tmp/shipcheck.png',
})
const report = evaluateChecks(evidence, { required_text: ['Release ready'], required_selectors: ['main'] })
check('checks: healthy page passes', report.passed && report.summary.failed === 0, JSON.stringify(report.summary))
check('checks: accessibility evidence retained', report.checks.some(item => item.id === 'a11y.image-alt' && item.status === 'pass'))
check('runtime: healthy page has clean browser telemetry', report.checks.some(item => item.id === 'runtime.console-errors' && item.status === 'pass') && report.checks.some(item => item.id === 'runtime.network-failures' && item.status === 'pass'))
const bad = buildEvidence({ url: evidence.url, title: '', snapshot: { text: 'broken', links: [], buttons: 0, inputs: 0, elements: [] }, page: { h1: [], images: 1, images_missing_alt: ['hero.png'], unlabeled_controls: ['<button>'], links_missing_name: ['http://localhost/'], horizontal_overflow: true, viewport: { width: 375, height: 667, scroll_width: 920 }, selectors: [] }, runtime: { telemetry_available: true, console_errors: [{ source: 'console', type: 'error', message: 'fetch failed' }], console_warnings: [], exceptions: [{ source: 'runtime', type: 'exception', message: 'boom' }], network_failures: [{ source: 'network', type: 'http', message: 'HTTP 500', status: 500, url: 'http://localhost/api' }] } })
const badReport = evaluateChecks(bad, { required_text: ['Release ready'] })
check('checks: broken page fails', !badReport.passed && badReport.summary.failed >= 6, JSON.stringify(badReport.summary))
check('checks: report identifies concrete missing image', badReport.checks.find(item => item.id === 'a11y.image-alt')?.evidence.images[0] === 'hero.png')
check('runtime: report identifies console, exception, and network failures', badReport.checks.some(item => item.id === 'runtime.console-errors' && item.status === 'fail') && badReport.checks.some(item => item.id === 'runtime.exceptions' && item.status === 'fail') && badReport.checks.some(item => item.id === 'runtime.network-failures' && item.status === 'fail'))
check('checks: browser expression is self-contained', pageInspectionExpression().includes('horizontal_overflow') && pageInspectionExpression().includes('images_missing_alt'))
const changed = evaluateChecks(evidence, { baseline_requested: true }, { name: 'demo', evidence: { ...evidence, title: 'Old title' } })
check('baseline: title regression is a failure', changed.status === 'failed' && changed.checks.some(item => item.id === 'baseline.title' && item.status === 'fail'))

const dir = mkdtempSync(join(tmpdir(), 'dsh-shipcheck-test-'))
const store = new ShipcheckStore(dir)
await store.init()
await store.saveBaseline('demo', evidence)
check('store: baseline survives round trip', (await store.getBaseline('demo'))?.evidence.fingerprint === evidence.fingerprint)
const saved = await store.saveReport({ name: 'demo', status: report.status, summary: report.summary, checks: report.checks, evidence })
check('store: report receives stable id', typeof saved.id === 'string' && saved.id.length > 8)
check('store: history returns report', (await store.history())[0]?.id === saved.id)

const matrixDir = mkdtempSync(join(tmpdir(), 'dsh-shipcheck-matrix-'))
const matrixRuntime = new ShipcheckRuntime({ store: new ShipcheckStore(matrixDir) })
let currentUrl = ''
const fakePilot = {
  cdp: { events: new Map(), async call() {} },
  async withOp(operation) { return operation() },
  async ensure() {},
  async navigate(url) {
    currentUrl = url
    return { title: url.endsWith('/broken') ? 'Broken route' : 'Healthy route', text: url.endsWith('/broken') ? 'broken' : 'Release ready', links: [], buttons: 0, inputs: 0, elements: [] }
  },
  async wait() {},
  async snapshot() {
    return { title: currentUrl.endsWith('/broken') ? 'Broken route' : 'Healthy route', text: currentUrl.endsWith('/broken') ? 'broken' : 'Release ready', links: [], buttons: 0, inputs: 0, elements: [] }
  },
  async evalJs() {
    const broken = currentUrl.endsWith('/broken')
    return { ok: true, value: { h1: broken ? [] : ['Release ready'], h2_count: 0, images: 0, images_missing_alt: [], unlabeled_controls: [], links_missing_name: [], horizontal_overflow: false, viewport: { width: 1280, height: 720, scroll_width: 1280 }, resource_count: 0, resource_urls: [], selectors: broken ? [] : ['main'] } }
  },
}
matrixRuntime.pilotModule = {
  PilotPool: class {
    for() { return fakePilot }
    async disposeAll() {}
  },
  async saveScreenshot(_pilot, path) { return { path } },
}
const matrix = await matrixRuntime.matrix({ urls: ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000/broken'], name: 'checkout', required_text: ['Release ready'] })
check('matrix: aggregates independent route results', matrix.kind === 'matrix' && matrix.route_summary.total === 2 && matrix.route_summary.passed === 1 && matrix.route_summary.failed === 1 && matrix.status === 'failed')
check('matrix: preserves route reports, screenshots, and namespaced baselines', matrix.evidence.routes.every(route => typeof route.report_id === 'string' && typeof route.screenshot_path === 'string' && route.baseline.startsWith('checkout/')) && new Set(matrix.evidence.routes.map(route => route.baseline)).size === 2)
check('matrix: flattened checks retain route evidence', matrix.checks.some(check => check.id.startsWith('route:01-') && check.evidence.report_id) && matrix.checks.some(check => check.status === 'fail' && check.evidence.route.includes('broken')))
check('matrix: saves child reports plus aggregate history', (await matrixRuntime.history(10)).length === 3)
await matrixRuntime.dispose()

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURES`}`)
process.exit(failed === 0 ? 0 : 1)
