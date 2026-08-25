import { createHash } from 'node:crypto'

const STATUS = new Set(['pass', 'fail', 'warn'])

function result(id, category, status, message, evidence = {}) {
  if (!STATUS.has(status)) throw new Error(`shipcheck: invalid check status ${status}`)
  return { id, category, status, message, evidence }
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function listOf(values, max = 20) {
  if (!Array.isArray(values)) return []
  return values.filter(value => typeof value === 'string' && value.trim().length > 0).map(value => value.trim()).slice(0, max)
}

function recordList(values, max = 40) {
  if (!Array.isArray(values)) return []
  return values.filter(value => value && typeof value === 'object').slice(0, max).map(value => {
    const record = {}
    for (const key of ['source', 'type', 'message', 'url', 'method', 'status', 'status_text', 'line', 'column', 'error', 'resource_type']) {
      if (value[key] === undefined || value[key] === null || value[key] === '') continue
      record[key] = typeof value[key] === 'string' ? value[key].slice(0, 1000) : value[key]
    }
    return record
  })
}

/**
 * Turn one real browser evaluation into a stable, serializable evidence record.
 * Dynamic body text is retained for humans but only its length/digest enters a
 * baseline, keeping the first version useful without pretending pixels are
 * deterministic across machines.
 */
export function buildEvidence({ url, title, snapshot, page, runtime, screenshotPath = null, capturedAt = new Date().toISOString() }) {
  const bodyText = normalizeText(snapshot?.text)
  const evidence = {
    captured_at: capturedAt,
    url: String(url ?? snapshot?.url ?? ''),
    title: String(title ?? snapshot?.title ?? ''),
    body_text: bodyText.slice(0, 6000),
    body_text_length: bodyText.length,
    screenshot_path: screenshotPath,
    snapshot: {
      links: Number(snapshot?.links?.length ?? 0),
      buttons: Number(snapshot?.buttons ?? 0),
      inputs: Number(snapshot?.inputs ?? 0),
      elements: Number(snapshot?.elements?.length ?? 0),
    },
    page: {
      h1: listOf(page?.h1),
      h2_count: Number(page?.h2_count ?? 0),
      images: Number(page?.images ?? 0),
      images_missing_alt: listOf(page?.images_missing_alt),
      unlabeled_controls: listOf(page?.unlabeled_controls),
      links_missing_name: listOf(page?.links_missing_name),
      horizontal_overflow: Boolean(page?.horizontal_overflow),
      viewport: page?.viewport ?? null,
      resource_count: Number(page?.resource_count ?? 0),
      resource_urls: listOf(page?.resource_urls, 40),
      selectors: listOf(page?.selectors, 40),
    },
    runtime: {
      telemetry_available: runtime?.telemetry_available ?? null,
      console_errors: recordList(runtime?.console_errors),
      console_warnings: recordList(runtime?.console_warnings),
      exceptions: recordList(runtime?.exceptions),
      network_failures: recordList(runtime?.network_failures),
    },
  }
  evidence.fingerprint = digest({
    title: evidence.title,
    h1: evidence.page.h1,
    snapshot: evidence.snapshot,
    a11y: {
      images_missing_alt: evidence.page.images_missing_alt,
      unlabeled_controls: evidence.page.unlabeled_controls,
      links_missing_name: evidence.page.links_missing_name,
    },
    horizontal_overflow: evidence.page.horizontal_overflow,
  })
  return evidence
}

function compareBaseline(evidence, baseline) {
  if (!baseline) return result('baseline', 'regression', 'warn', 'No baseline exists; capture one after reviewing this result.', { action: 'shipcheck_baseline' })
  const before = baseline.evidence ?? baseline
  const checks = []
  if (before.title !== evidence.title) {
    checks.push(result('baseline.title', 'regression', 'fail', 'Page title changed from the saved baseline.', { before: before.title, after: evidence.title }))
  }
  const beforeH1 = before.page?.h1 ?? []
  if (JSON.stringify(beforeH1) !== JSON.stringify(evidence.page.h1)) {
    checks.push(result('baseline.h1', 'regression', 'fail', 'Primary heading changed from the saved baseline.', { before: beforeH1, after: evidence.page.h1 }))
  }
  const beforeLength = Number(before.body_text_length ?? 0)
  const drift = beforeLength > 40 ? Math.abs(evidence.body_text_length - beforeLength) / beforeLength : 0
  if (drift > 0.35) {
    checks.push(result('baseline.body', 'regression', 'warn', 'Visible text length moved more than 35%; inspect the attached screenshot and report.', { before: beforeLength, after: evidence.body_text_length, drift: Math.round(drift * 100) / 100 }))
  }
  if (before.page?.horizontal_overflow === false && evidence.page.horizontal_overflow) {
    checks.push(result('baseline.overflow', 'regression', 'fail', 'The page now overflows horizontally at the captured viewport.', { viewport: evidence.page.viewport }))
  }
  if (checks.length === 0) checks.push(result('baseline.fingerprint', 'regression', 'pass', 'No structural regression detected against the saved baseline.', { baseline: baseline.name ?? null, fingerprint: evidence.fingerprint }))
  return checks
}

/** Deterministic checks: every failure points to page evidence, not a model opinion. */
export function evaluateChecks(evidence, options = {}, baseline = null) {
  const checks = []
  const requiredText = listOf(options.required_text)
  const forbiddenText = listOf(options.forbidden_text)
  const requiredSelectors = listOf(options.required_selectors)
  const body = evidence.body_text
  checks.push(evidence.title
    ? result('page.title', 'content', 'pass', 'The page has a document title.', { title: evidence.title })
    : result('page.title', 'content', 'fail', 'The page has no document title.', {}))
  checks.push(body.length > 0
    ? result('page.body', 'content', 'pass', 'The page rendered visible text.', { characters: body.length })
    : result('page.body', 'content', 'fail', 'The page rendered no visible body text.', {}))
  checks.push(evidence.page.h1.length === 1
    ? result('content.h1', 'content', 'pass', 'The page has exactly one primary heading.', { h1: evidence.page.h1 })
    : result('content.h1', 'content', evidence.page.h1.length === 0 ? 'warn' : 'warn', `Expected one primary heading; found ${evidence.page.h1.length}.`, { h1: evidence.page.h1 }))
  checks.push(evidence.page.images_missing_alt.length === 0
    ? result('a11y.image-alt', 'accessibility', 'pass', 'All inspected images have alternative text.', { images: evidence.page.images })
    : result('a11y.image-alt', 'accessibility', 'fail', `${evidence.page.images_missing_alt.length} image(s) are missing alternative text.`, { images: evidence.page.images_missing_alt }))
  checks.push(evidence.page.unlabeled_controls.length === 0
    ? result('a11y.controls', 'accessibility', 'pass', 'Interactive controls have accessible names.', {})
    : result('a11y.controls', 'accessibility', 'fail', `${evidence.page.unlabeled_controls.length} control(s) have no accessible name.`, { controls: evidence.page.unlabeled_controls }))
  checks.push(evidence.page.links_missing_name.length === 0
    ? result('a11y.links', 'accessibility', 'pass', 'Links have accessible names.', {})
    : result('a11y.links', 'accessibility', 'fail', `${evidence.page.links_missing_name.length} link(s) have no accessible name.`, { links: evidence.page.links_missing_name }))
  checks.push(evidence.page.horizontal_overflow
    ? result('layout.horizontal-overflow', 'layout', 'fail', 'The document is wider than the captured viewport.', { viewport: evidence.page.viewport })
    : result('layout.horizontal-overflow', 'layout', 'pass', 'No horizontal overflow detected at the captured viewport.', { viewport: evidence.page.viewport }))
  const runtime = evidence.runtime ?? {}
  if (runtime.telemetry_available === false) {
    checks.push(result('runtime.telemetry', 'runtime', 'warn', 'Runtime console and network telemetry was unavailable; browser checks are incomplete.', {}))
  }
  checks.push(runtime.console_errors?.length
    ? result('runtime.console-errors', 'runtime', 'fail', `${runtime.console_errors.length} console error(s) were emitted while loading the page.`, { errors: runtime.console_errors })
    : result('runtime.console-errors', 'runtime', 'pass', 'No console errors were emitted while loading the page.', {}))
  checks.push(runtime.exceptions?.length
    ? result('runtime.exceptions', 'runtime', 'fail', `${runtime.exceptions.length} uncaught runtime exception(s) were observed.`, { exceptions: runtime.exceptions })
    : result('runtime.exceptions', 'runtime', 'pass', 'No uncaught runtime exceptions were observed.', {}))
  checks.push(runtime.network_failures?.length
    ? result('runtime.network-failures', 'runtime', 'fail', `${runtime.network_failures.length} network request(s) failed or returned HTTP 4xx/5xx.`, { failures: runtime.network_failures })
    : result('runtime.network-failures', 'runtime', 'pass', 'No failed network requests or HTTP 4xx/5xx responses were observed.', {}))
  if (runtime.console_warnings?.length) {
    checks.push(result('runtime.console-warnings', 'runtime', 'warn', `${runtime.console_warnings.length} console warning(s) were emitted while loading the page.`, { warnings: runtime.console_warnings }))
  }
  for (const text of requiredText) checks.push(body.toLocaleLowerCase().includes(text.toLocaleLowerCase())
    ? result(`expect.text:${text}`, 'contract', 'pass', `Required text is present: “${text}”.`, { text })
    : result(`expect.text:${text}`, 'contract', 'fail', `Required text is missing: “${text}”.`, { text }))
  for (const text of forbiddenText) checks.push(body.toLocaleLowerCase().includes(text.toLocaleLowerCase())
    ? result(`forbid.text:${text}`, 'contract', 'fail', `Forbidden text is present: “${text}”.`, { text })
    : result(`forbid.text:${text}`, 'contract', 'pass', `Forbidden text is absent: “${text}”.`, { text }))
  for (const selector of requiredSelectors) checks.push((evidence.page.selectors ?? []).includes(selector)
    ? result(`expect.selector:${selector}`, 'contract', 'pass', `Required selector is present: ${selector}.`, { selector })
    : result(`expect.selector:${selector}`, 'contract', 'fail', `Required selector is missing: ${selector}.`, { selector }))
  if (baseline !== null || options.baseline_requested) {
    const baselineChecks = compareBaseline(evidence, baseline)
    checks.push(...(Array.isArray(baselineChecks) ? baselineChecks : [baselineChecks]))
  }
  const failed = checks.filter(check => check.status === 'fail')
  return {
    status: failed.length === 0 ? 'passed' : 'failed',
    passed: failed.length === 0,
    checks,
    summary: { total: checks.length, passed: checks.filter(check => check.status === 'pass').length, warnings: checks.filter(check => check.status === 'warn').length, failed: failed.length },
  }
}

export function pageInspectionExpression() {
  return `(() => {
    const nameOf = el => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || el.value || '').trim().slice(0, 160)
    const labelled = el => Boolean(nameOf(el) || el.getAttribute('aria-labelledby') || el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'))
    const controls = Array.from(document.querySelectorAll('button,input,textarea,select,[role="button"],[role="textbox"],[role="checkbox"],[role="combobox"]'))
    const links = Array.from(document.querySelectorAll('a'))
    const images = Array.from(document.querySelectorAll('img'))
    const selectors = ['main','header','nav','footer','form','table','[data-testid]'].filter(selector => document.querySelector(selector))
    return {
      h1: Array.from(document.querySelectorAll('h1')).map(nameOf).filter(Boolean).slice(0, 10),
      h2_count: document.querySelectorAll('h2').length,
      images: images.length,
      images_missing_alt: images.filter(image => !image.hasAttribute('alt')).map(image => image.src || '<inline image>').slice(0, 20),
      unlabeled_controls: controls.filter(control => !labelled(control)).map(control => '<' + control.tagName.toLowerCase() + '> ' + (control.outerHTML || '').slice(0, 140)).slice(0, 20),
      links_missing_name: links.filter(link => !labelled(link)).map(link => link.href || '<link>').slice(0, 20),
      horizontal_overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      viewport: { width: window.innerWidth, height: window.innerHeight, scroll_width: document.documentElement.scrollWidth },
      resource_count: performance.getEntriesByType('resource').length,
      resource_urls: performance.getEntriesByType('resource').map(entry => entry.name).slice(0, 40),
      selectors,
    }
  })()`
}

export function renderCheckSummary(report) {
  if (!report) return 'No shipcheck report yet.'
  const icon = report.status === 'passed' ? 'PASS' : 'FAIL'
  return `${icon} ${report.summary.failed} failed, ${report.summary.warnings} warnings, ${report.summary.passed} passed — ${report.url}`
}
