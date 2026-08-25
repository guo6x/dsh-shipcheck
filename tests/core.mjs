import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShipcheckStore } from '../src/store.js'
import { buildEvidence, evaluateChecks, pageInspectionExpression } from '../src/checks.js'

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
  screenshotPath: 'C:/tmp/shipcheck.png',
})
const report = evaluateChecks(evidence, { required_text: ['Release ready'], required_selectors: ['main'] })
check('checks: healthy page passes', report.passed && report.summary.failed === 0, JSON.stringify(report.summary))
check('checks: accessibility evidence retained', report.checks.some(item => item.id === 'a11y.image-alt' && item.status === 'pass'))
const bad = buildEvidence({ url: evidence.url, title: '', snapshot: { text: 'broken', links: [], buttons: 0, inputs: 0, elements: [] }, page: { h1: [], images: 1, images_missing_alt: ['hero.png'], unlabeled_controls: ['<button>'], links_missing_name: ['http://localhost/'], horizontal_overflow: true, viewport: { width: 375, height: 667, scroll_width: 920 }, selectors: [] } })
const badReport = evaluateChecks(bad, { required_text: ['Release ready'] })
check('checks: broken page fails', !badReport.passed && badReport.summary.failed >= 6, JSON.stringify(badReport.summary))
check('checks: report identifies concrete missing image', badReport.checks.find(item => item.id === 'a11y.image-alt')?.evidence.images[0] === 'hero.png')
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

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURES`}`)
process.exit(failed === 0 ? 0 : 1)
