// src/index.js
import { join as join2 } from "node:path";
import { homedir } from "node:os";
import { mkdir as mkdir2 } from "node:fs/promises";

// src/checks.js
import { createHash } from "node:crypto";
var STATUS = /* @__PURE__ */ new Set(["pass", "fail", "warn"]);
function result(id, category, status, message, evidence = {}) {
  if (!STATUS.has(status)) throw new Error(`shipcheck: invalid check status ${status}`);
  return { id, category, status, message, evidence };
}
function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function listOf(values, max = 20) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()).slice(0, max);
}
function recordList(values, max = 40) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => value && typeof value === "object").slice(0, max).map((value) => {
    const record = {};
    for (const key of ["source", "type", "message", "url", "method", "status", "status_text", "line", "column", "error", "resource_type"]) {
      if (value[key] === void 0 || value[key] === null || value[key] === "") continue;
      record[key] = typeof value[key] === "string" ? value[key].slice(0, 1e3) : value[key];
    }
    return record;
  });
}
function buildEvidence({ url, title, snapshot, page, runtime, screenshotPath = null, capturedAt = (/* @__PURE__ */ new Date()).toISOString() }) {
  const bodyText = normalizeText(snapshot?.text);
  const evidence = {
    captured_at: capturedAt,
    url: String(url ?? snapshot?.url ?? ""),
    title: String(title ?? snapshot?.title ?? ""),
    body_text: bodyText.slice(0, 6e3),
    body_text_length: bodyText.length,
    screenshot_path: screenshotPath,
    snapshot: {
      links: Number(snapshot?.links?.length ?? 0),
      buttons: Number(snapshot?.buttons ?? 0),
      inputs: Number(snapshot?.inputs ?? 0),
      elements: Number(snapshot?.elements?.length ?? 0)
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
      selectors: listOf(page?.selectors, 40)
    },
    runtime: {
      telemetry_available: runtime?.telemetry_available ?? null,
      console_errors: recordList(runtime?.console_errors),
      console_warnings: recordList(runtime?.console_warnings),
      exceptions: recordList(runtime?.exceptions),
      network_failures: recordList(runtime?.network_failures)
    }
  };
  evidence.fingerprint = digest({
    title: evidence.title,
    h1: evidence.page.h1,
    snapshot: evidence.snapshot,
    a11y: {
      images_missing_alt: evidence.page.images_missing_alt,
      unlabeled_controls: evidence.page.unlabeled_controls,
      links_missing_name: evidence.page.links_missing_name
    },
    horizontal_overflow: evidence.page.horizontal_overflow
  });
  return evidence;
}
function compareBaseline(evidence, baseline) {
  if (!baseline) return result("baseline", "regression", "warn", "No baseline exists; capture one after reviewing this result.", { action: "shipcheck_baseline" });
  const before = baseline.evidence ?? baseline;
  const checks = [];
  if (before.title !== evidence.title) {
    checks.push(result("baseline.title", "regression", "fail", "Page title changed from the saved baseline.", { before: before.title, after: evidence.title }));
  }
  const beforeH1 = before.page?.h1 ?? [];
  if (JSON.stringify(beforeH1) !== JSON.stringify(evidence.page.h1)) {
    checks.push(result("baseline.h1", "regression", "fail", "Primary heading changed from the saved baseline.", { before: beforeH1, after: evidence.page.h1 }));
  }
  const beforeLength = Number(before.body_text_length ?? 0);
  const drift = beforeLength > 40 ? Math.abs(evidence.body_text_length - beforeLength) / beforeLength : 0;
  if (drift > 0.35) {
    checks.push(result("baseline.body", "regression", "warn", "Visible text length moved more than 35%; inspect the attached screenshot and report.", { before: beforeLength, after: evidence.body_text_length, drift: Math.round(drift * 100) / 100 }));
  }
  if (before.page?.horizontal_overflow === false && evidence.page.horizontal_overflow) {
    checks.push(result("baseline.overflow", "regression", "fail", "The page now overflows horizontally at the captured viewport.", { viewport: evidence.page.viewport }));
  }
  if (checks.length === 0) checks.push(result("baseline.fingerprint", "regression", "pass", "No structural regression detected against the saved baseline.", { baseline: baseline.name ?? null, fingerprint: evidence.fingerprint }));
  return checks;
}
function evaluateChecks(evidence, options = {}, baseline = null) {
  const checks = [];
  const requiredText = listOf(options.required_text);
  const forbiddenText = listOf(options.forbidden_text);
  const requiredSelectors = listOf(options.required_selectors);
  const body = evidence.body_text;
  checks.push(evidence.title ? result("page.title", "content", "pass", "The page has a document title.", { title: evidence.title }) : result("page.title", "content", "fail", "The page has no document title.", {}));
  checks.push(body.length > 0 ? result("page.body", "content", "pass", "The page rendered visible text.", { characters: body.length }) : result("page.body", "content", "fail", "The page rendered no visible body text.", {}));
  checks.push(evidence.page.h1.length === 1 ? result("content.h1", "content", "pass", "The page has exactly one primary heading.", { h1: evidence.page.h1 }) : result("content.h1", "content", evidence.page.h1.length === 0 ? "warn" : "warn", `Expected one primary heading; found ${evidence.page.h1.length}.`, { h1: evidence.page.h1 }));
  checks.push(evidence.page.images_missing_alt.length === 0 ? result("a11y.image-alt", "accessibility", "pass", "All inspected images have alternative text.", { images: evidence.page.images }) : result("a11y.image-alt", "accessibility", "fail", `${evidence.page.images_missing_alt.length} image(s) are missing alternative text.`, { images: evidence.page.images_missing_alt }));
  checks.push(evidence.page.unlabeled_controls.length === 0 ? result("a11y.controls", "accessibility", "pass", "Interactive controls have accessible names.", {}) : result("a11y.controls", "accessibility", "fail", `${evidence.page.unlabeled_controls.length} control(s) have no accessible name.`, { controls: evidence.page.unlabeled_controls }));
  checks.push(evidence.page.links_missing_name.length === 0 ? result("a11y.links", "accessibility", "pass", "Links have accessible names.", {}) : result("a11y.links", "accessibility", "fail", `${evidence.page.links_missing_name.length} link(s) have no accessible name.`, { links: evidence.page.links_missing_name }));
  checks.push(evidence.page.horizontal_overflow ? result("layout.horizontal-overflow", "layout", "fail", "The document is wider than the captured viewport.", { viewport: evidence.page.viewport }) : result("layout.horizontal-overflow", "layout", "pass", "No horizontal overflow detected at the captured viewport.", { viewport: evidence.page.viewport }));
  const runtime = evidence.runtime ?? {};
  if (runtime.telemetry_available === false) {
    checks.push(result("runtime.telemetry", "runtime", "warn", "Runtime console and network telemetry was unavailable; browser checks are incomplete.", {}));
  }
  checks.push(runtime.console_errors?.length ? result("runtime.console-errors", "runtime", "fail", `${runtime.console_errors.length} console error(s) were emitted while loading the page.`, { errors: runtime.console_errors }) : result("runtime.console-errors", "runtime", "pass", "No console errors were emitted while loading the page.", {}));
  checks.push(runtime.exceptions?.length ? result("runtime.exceptions", "runtime", "fail", `${runtime.exceptions.length} uncaught runtime exception(s) were observed.`, { exceptions: runtime.exceptions }) : result("runtime.exceptions", "runtime", "pass", "No uncaught runtime exceptions were observed.", {}));
  checks.push(runtime.network_failures?.length ? result("runtime.network-failures", "runtime", "fail", `${runtime.network_failures.length} network request(s) failed or returned HTTP 4xx/5xx.`, { failures: runtime.network_failures }) : result("runtime.network-failures", "runtime", "pass", "No failed network requests or HTTP 4xx/5xx responses were observed.", {}));
  if (runtime.console_warnings?.length) {
    checks.push(result("runtime.console-warnings", "runtime", "warn", `${runtime.console_warnings.length} console warning(s) were emitted while loading the page.`, { warnings: runtime.console_warnings }));
  }
  for (const text of requiredText) checks.push(body.toLocaleLowerCase().includes(text.toLocaleLowerCase()) ? result(`expect.text:${text}`, "contract", "pass", `Required text is present: \u201C${text}\u201D.`, { text }) : result(`expect.text:${text}`, "contract", "fail", `Required text is missing: \u201C${text}\u201D.`, { text }));
  for (const text of forbiddenText) checks.push(body.toLocaleLowerCase().includes(text.toLocaleLowerCase()) ? result(`forbid.text:${text}`, "contract", "fail", `Forbidden text is present: \u201C${text}\u201D.`, { text }) : result(`forbid.text:${text}`, "contract", "pass", `Forbidden text is absent: \u201C${text}\u201D.`, { text }));
  for (const selector of requiredSelectors) checks.push((evidence.page.selectors ?? []).includes(selector) ? result(`expect.selector:${selector}`, "contract", "pass", `Required selector is present: ${selector}.`, { selector }) : result(`expect.selector:${selector}`, "contract", "fail", `Required selector is missing: ${selector}.`, { selector }));
  if (baseline !== null || options.baseline_requested) {
    const baselineChecks = compareBaseline(evidence, baseline);
    checks.push(...Array.isArray(baselineChecks) ? baselineChecks : [baselineChecks]);
  }
  const failed = checks.filter((check) => check.status === "fail");
  return {
    status: failed.length === 0 ? "passed" : "failed",
    passed: failed.length === 0,
    checks,
    summary: { total: checks.length, passed: checks.filter((check) => check.status === "pass").length, warnings: checks.filter((check) => check.status === "warn").length, failed: failed.length }
  };
}
function pageInspectionExpression() {
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
  })()`;
}
function renderCheckSummary(report) {
  if (!report) return "No shipcheck report yet.";
  const icon = report.status === "passed" ? "PASS" : "FAIL";
  return `${icon} ${report.summary.failed} failed, ${report.summary.warnings} warnings, ${report.summary.passed} passed \u2014 ${report.url}`;
}

// src/store.js
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
var MAX_HISTORY = 100;
var ShipcheckStore = class {
  constructor(dir) {
    this.dir = dir;
    this.baselinesDir = join(dir, "baselines");
    this.reportsDir = join(dir, "reports");
  }
  async init() {
    await mkdir(this.baselinesDir, { recursive: true });
    await mkdir(this.reportsDir, { recursive: true });
  }
  slug(value) {
    const slug = String(value ?? "default").normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    return slug || "default";
  }
  async saveBaseline(name2, evidence) {
    await this.init();
    const baseline = { name: name2, saved_at: (/* @__PURE__ */ new Date()).toISOString(), evidence };
    await writeFile(join(this.baselinesDir, `${this.slug(name2)}.json`), JSON.stringify(baseline, null, 2) + "\n", "utf8");
    return baseline;
  }
  async getBaseline(name2) {
    if (!name2) return null;
    try {
      return JSON.parse(await readFile(join(this.baselinesDir, `${this.slug(name2)}.json`), "utf8"));
    } catch {
      return null;
    }
  }
  async saveReport(report) {
    await this.init();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const saved = { id, ...report };
    await writeFile(join(this.reportsDir, `${id}.json`), JSON.stringify(saved, null, 2) + "\n", "utf8");
    const names = (await readdir(this.reportsDir)).filter((name2) => name2.endsWith(".json")).sort().reverse();
    for (const stale of names.slice(MAX_HISTORY)) {
      try {
        await (await import("node:fs/promises")).rm(join(this.reportsDir, stale), { force: true });
      } catch {
      }
    }
    return saved;
  }
  async history(limit = 12) {
    await this.init();
    const names = (await readdir(this.reportsDir)).filter((name2) => name2.endsWith(".json")).sort().reverse().slice(0, Math.max(1, Math.min(50, Number(limit) || 12)));
    const reports = [];
    for (const name2 of names) {
      try {
        reports.push(JSON.parse(await readFile(join(this.reportsDir, name2), "utf8")));
      } catch {
      }
    }
    return reports;
  }
};

// src/index.js
var name = "dsh-shipcheck";
var inject = ["webServer", "tools"];
var LOOPBACKS = /* @__PURE__ */ new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function dshHome() {
  return process.env.DSH_HOME ?? join2(homedir(), ".dsh");
}
async function loadPilot() {
  try {
    return await import("dsh-pilot");
  } catch {
    throw new Error("shipcheck: dsh-pilot is required for a real browser run; install github:guo6x/dsh-pilot in the same DSH profile");
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
var TELEMETRY_LIMIT = 40;
function pushTelemetry(list, value) {
  if (list.length >= TELEMETRY_LIMIT || value === void 0 || value === null) return;
  const serialized = JSON.stringify(value);
  if (list.some((item) => JSON.stringify(item) === serialized)) return;
  list.push(value);
}
function cdpListener(cdp, method, listener) {
  if (!(cdp?.events instanceof Map)) return () => {
  };
  const listeners = cdp.events.get(method) ?? [];
  listeners.push(listener);
  cdp.events.set(method, listeners);
  return () => {
    const current = cdp.events.get(method) ?? [];
    const index = current.indexOf(listener);
    if (index >= 0) current.splice(index, 1);
    if (current.length === 0) cdp.events.delete(method);
  };
}
function remoteArgumentText(argument) {
  if (argument?.value !== void 0) {
    if (typeof argument.value === "string") return argument.value;
    try {
      return JSON.stringify(argument.value);
    } catch {
      return String(argument.value);
    }
  }
  return argument?.description ?? argument?.unserializableValue ?? argument?.type ?? "";
}
function telemetryRecord({ source, type, message, url, line, column, method, status, status_text, error, resource_type }) {
  const record = { source, type, message: String(message ?? "").slice(0, 1e3) };
  for (const [key, value] of Object.entries({ url, line, column, method, status, status_text, error, resource_type })) {
    if (value !== void 0 && value !== null && value !== "") record[key] = typeof value === "string" ? value.slice(0, 1e3) : value;
  }
  return record;
}
async function startTelemetry(pilot) {
  const telemetry = {
    telemetry_available: false,
    console_errors: [],
    console_warnings: [],
    exceptions: [],
    network_failures: []
  };
  const cdp = pilot?.cdp;
  if (typeof cdp?.call !== "function" || !(cdp.events instanceof Map)) return { telemetry, stop() {
  } };
  try {
    await cdp.call("Runtime.enable");
    await cdp.call("Network.enable");
    try {
      await cdp.call("Log.enable");
    } catch {
    }
    telemetry.telemetry_available = true;
  } catch {
    return { telemetry, stop() {
    } };
  }
  const requestInfo = /* @__PURE__ */ new Map();
  const detach = [];
  detach.push(cdpListener(cdp, "Runtime.consoleAPICalled", (params) => {
    const type = String(params?.type ?? "");
    if (type !== "error" && type !== "warning") return;
    const frame = params?.stackTrace?.callFrames?.[0];
    const record = telemetryRecord({
      source: "console",
      type,
      message: (params?.args ?? []).map(remoteArgumentText).filter(Boolean).join(" "),
      url: frame?.url,
      line: typeof frame?.lineNumber === "number" ? frame.lineNumber + 1 : void 0,
      column: typeof frame?.columnNumber === "number" ? frame.columnNumber + 1 : void 0
    });
    pushTelemetry(type === "error" ? telemetry.console_errors : telemetry.console_warnings, record);
  }));
  detach.push(cdpListener(cdp, "Runtime.exceptionThrown", (params) => {
    const details = params?.exceptionDetails ?? {};
    const exception = details.exception ?? {};
    pushTelemetry(telemetry.exceptions, telemetryRecord({
      source: "runtime",
      type: "exception",
      message: exception.description ?? details.text ?? "Uncaught runtime exception",
      url: details.url,
      line: typeof details.lineNumber === "number" ? details.lineNumber + 1 : void 0,
      column: typeof details.columnNumber === "number" ? details.columnNumber + 1 : void 0
    }));
  }));
  detach.push(cdpListener(cdp, "Network.requestWillBeSent", (params) => {
    if (params?.requestId === void 0) return;
    requestInfo.set(params.requestId, {
      url: params.request?.url,
      method: params.request?.method,
      resource_type: params.type
    });
  }));
  detach.push(cdpListener(cdp, "Network.responseReceived", (params) => {
    const status = Number(params?.response?.status);
    if (!Number.isFinite(status) || status < 400) return;
    const request = requestInfo.get(params?.requestId) ?? {};
    pushTelemetry(telemetry.network_failures, telemetryRecord({
      source: "network",
      type: "http",
      message: `HTTP ${status} ${params?.response?.statusText ?? ""}`.trim(),
      url: params?.response?.url ?? request.url,
      method: request.method,
      status,
      status_text: params?.response?.statusText,
      resource_type: params?.type ?? request.resource_type
    }));
  }));
  detach.push(cdpListener(cdp, "Network.loadingFailed", (params) => {
    if (params?.canceled || params?.blockedReason) return;
    const request = requestInfo.get(params?.requestId) ?? {};
    pushTelemetry(telemetry.network_failures, telemetryRecord({
      source: "network",
      type: "failed",
      message: params?.errorText ?? "Network request failed",
      url: request.url,
      method: request.method,
      error: params?.errorText,
      resource_type: params?.type ?? request.resource_type
    }));
  }));
  return { telemetry, stop() {
    for (const remove of detach) remove();
  } };
}
function object(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
var string = (description) => ({ type: "string", description });
var strings = (description) => ({ type: "array", items: { type: "string" }, description });
function matrixRouteKey(url, index) {
  const parsed = new URL(url);
  const host = parsed.host.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "host";
  const path = `${parsed.pathname === "/" ? "home" : parsed.pathname}${parsed.search}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 44) || "route";
  return `${String(index + 1).padStart(2, "0")}-${host}-${path}`;
}
function matrixUrls(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new Error("shipcheck: urls must contain between 1 and 20 http(s) URLs");
  }
  return value.map((value2, index) => {
    const url = typeof value2 === "string" ? value2.trim() : "";
    if (!/^https?:\/\//.test(url)) throw new Error(`shipcheck: urls[${index}] must be an http(s) URL`);
    try {
      new URL(url);
    } catch {
      throw new Error(`shipcheck: urls[${index}] must be a valid URL`);
    }
    return url;
  });
}
function renderMatrixSummary(report) {
  if (!report) return "No shipcheck matrix report yet.";
  const routes = report.evidence?.routes ?? [];
  const routeSummary = report.route_summary ?? { total: routes.length, passed: 0, failed: routes.length };
  const lines = [
    `${report.status === "passed" ? "PASS" : "FAIL"} ${routeSummary.passed}/${routeSummary.total} routes passed \u2014 ${report.name}`,
    `Report: ${report.id}`
  ];
  for (const route of routes) {
    const failures = (route.failed_checks ?? []).slice(0, 2).map((check) => `[${check.status}] ${check.message}`).join(" ");
    lines.push(`${route.status === "passed" ? "PASS" : "FAIL"} ${route.route} \u2014 ${route.url}${failures ? ` \u2014 ${failures}` : ""}`);
  }
  return lines.join("\n");
}
function renderHistoryLine(report) {
  if (report.kind === "matrix") {
    const routes = report.route_summary ?? { passed: 0, total: 0 };
    return `${report.status.toUpperCase()} ${report.name} \u2014 ${routes.passed}/${routes.total} routes passed \u2014 ${report.summary.failed} failed / ${report.summary.warnings} warnings`;
  }
  if (report.kind === "flow") {
    const flow = report.evidence?.flow ?? { executed_steps: 0, requested_steps: 0 };
    return `${report.status.toUpperCase()} ${report.name} \u2014 ${flow.executed_steps}/${flow.requested_steps} steps completed \u2014 ${report.summary.failed} failed / ${report.summary.warnings} warnings`;
  }
  return `${report.status.toUpperCase()} ${report.name} \u2014 ${report.summary.failed} failed / ${report.summary.warnings} warnings \u2014 ${report.url}`;
}
function renderFlowSummary(report) {
  if (!report) return "No shipcheck flow report yet.";
  const flow = report.evidence?.flow ?? { executed_steps: 0, requested_steps: 0 };
  const lines = [
    `${report.status === "passed" ? "PASS" : "FAIL"} ${flow.executed_steps}/${flow.requested_steps} steps completed \u2014 ${report.name}`,
    `Report: ${report.id}`
  ];
  for (const step of report.evidence?.steps ?? []) {
    if (step.status === "passed") continue;
    lines.push(`FAIL step ${step.index} ${step.action}: ${step.error ?? "step failed"}${step.screenshot_path ? ` \u2014 ${step.screenshot_path}` : ""}`);
  }
  if (report.evidence?.final?.screenshot_path) lines.push(`Final screenshot: ${report.evidence.final.screenshot_path}`);
  return lines.join("\n");
}
function validHttpUrl(value, label) {
  const url = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\//.test(url)) throw new Error(`shipcheck: ${label} must be an http(s) URL`);
  try {
    new URL(url);
  } catch {
    throw new Error(`shipcheck: ${label} must be a valid URL`);
  }
  return url;
}
function normalizeFlowSteps(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) {
    throw new Error("shipcheck: steps must contain between 1 and 30 flow steps");
  }
  return value.map((raw, index) => {
    const label = `steps[${index}]`;
    const action = typeof raw?.action === "string" ? raw.action.trim().toLowerCase() : "";
    if (!["navigate", "click", "fill", "press", "wait", "wait_for", "assert"].includes(action)) {
      throw new Error(`shipcheck: ${label}.action must be navigate, click, fill, press, wait, wait_for, or assert`);
    }
    if (action === "navigate") return { action, url: validHttpUrl(raw.url, `${label}.url`) };
    if (action === "click") {
      const ref = typeof raw.ref === "number" && Number.isInteger(raw.ref) && raw.ref > 0 ? raw.ref : void 0;
      const selector2 = typeof raw.selector === "string" && raw.selector.trim() ? raw.selector.trim() : void 0;
      if (ref === void 0 && selector2 === void 0) throw new Error(`shipcheck: ${label} needs ref or selector`);
      return ref === void 0 ? { action, selector: selector2 } : { action, ref };
    }
    if (action === "fill") {
      if (!Array.isArray(raw.fields) || raw.fields.length < 1 || raw.fields.length > 20) throw new Error(`shipcheck: ${label}.fields must contain between 1 and 20 fields`);
      const fields = raw.fields.map((field, fieldIndex) => {
        if (typeof field?.label !== "string" || !field.label.trim() || typeof field.value !== "string") throw new Error(`shipcheck: ${label}.fields[${fieldIndex}] needs label and string value`);
        return { label: field.label.trim(), value: field.value };
      });
      return { action, fields };
    }
    if (action === "press") {
      if (typeof raw.key !== "string" || !raw.key.trim()) throw new Error(`shipcheck: ${label}.key is required`);
      return { action, key: raw.key.trim() };
    }
    if (action === "wait") {
      const ms = Number(raw.ms ?? 1e3);
      if (!Number.isFinite(ms) || ms < 0 || ms > 3e4) throw new Error(`shipcheck: ${label}.ms must be between 0 and 30000`);
      return { action, ms: Math.round(ms) };
    }
    const text = typeof raw.text === "string" && raw.text.length > 0 ? raw.text : void 0;
    const selector = typeof raw.selector === "string" && raw.selector.trim() ? raw.selector.trim() : void 0;
    const urlIncludes = typeof raw.url_includes === "string" && raw.url_includes.length > 0 ? raw.url_includes : void 0;
    if (text === void 0 && selector === void 0 && urlIncludes === void 0) throw new Error(`shipcheck: ${label} needs text, selector, or url_includes`);
    const timeoutMs = raw.timeout_ms === void 0 ? void 0 : Number(raw.timeout_ms);
    if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 3e4)) throw new Error(`shipcheck: ${label}.timeout_ms must be between 0 and 30000`);
    return { action, ...text === void 0 ? {} : { text }, ...selector === void 0 ? {} : { selector }, ...urlIncludes === void 0 ? {} : { url_includes: urlIncludes }, ...timeoutMs === void 0 ? {} : { timeout_ms: Math.round(timeoutMs) } };
  });
}
function safeFlowStep(step) {
  if (step.action === "fill") return { action: step.action, fields: step.fields.map((field) => ({ label: field.label, value: "[redacted]" })) };
  return { ...step };
}
function safeFlowResult(value) {
  if (value === null || value === void 0 || typeof value !== "object") return value;
  const allowed = ["ok", "error", "ref", "tag", "text", "url", "title", "waited", "textMatched", "selectorMatched", "urlMatched", "filled", "failed"];
  const output = {};
  for (const key of allowed) if (value[key] !== void 0) output[key] = value[key];
  if (Array.isArray(output.filled)) output.filled = output.filled.map((field) => ({ label: field.label, tag: field.tag, type: field.type }));
  if (Array.isArray(output.failed)) output.failed = output.failed.map((field) => ({ label: field.label, error: field.error }));
  return output;
}
function flowStepSchema() {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["navigate", "click", "fill", "press", "wait", "wait_for", "assert"], description: "Step action." },
      url: string("URL for navigate."),
      ref: { type: "number", description: "Current snapshot element ref for click." },
      selector: string("CSS selector for click or a visible condition."),
      fields: { type: "array", items: { type: "object", properties: { label: string("Field label, placeholder, name, or id."), value: string("Value to enter; never saved in the report.") }, required: ["label", "value"], additionalProperties: false }, description: "Fields for fill." },
      key: string("Keyboard key for press, such as Enter or Escape."),
      ms: { type: "number", description: "Milliseconds for wait, 0-30000." },
      text: string("Visible text condition for wait_for or assert."),
      url_includes: string("URL substring condition for wait_for or assert."),
      timeout_ms: { type: "number", description: "Condition timeout, 0-30000 ms." }
    },
    required: ["action"],
    additionalProperties: false
  };
}
var ShipcheckRuntime = class {
  constructor({ store = new ShipcheckStore(join2(dshHome(), "shipcheck")) } = {}) {
    this.pool = null;
    this.pilotModule = null;
    this.store = store;
    this.last = null;
  }
  async run(args = {}, exec = {}) {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!/^https?:\/\//.test(url)) throw new Error("shipcheck: url must be an http(s) URL");
    const nameValue = typeof args.name === "string" && args.name.trim() ? args.name.trim() : new URL(url).hostname;
    this.pilotModule ??= await loadPilot();
    this.pool ??= new this.pilotModule.PilotPool();
    const pilot = this.pool.for(exec.agent?.session?.id ?? "shipcheck");
    const started = Date.now();
    let snapshot;
    let page;
    let screenshotPath = null;
    let navigationError = null;
    let telemetry = { telemetry_available: false, console_errors: [], console_warnings: [], exceptions: [], network_failures: [] };
    let stopTelemetry = () => {
    };
    try {
      await pilot.withOp(() => pilot.ensure());
      const capture = await startTelemetry(pilot);
      telemetry = capture.telemetry;
      stopTelemetry = capture.stop;
      snapshot = await pilot.withOp(() => pilot.navigate(url));
      if (args.wait_ms) await pilot.withOp(() => pilot.wait(args.wait_ms));
      snapshot = await pilot.withOp(() => pilot.snapshot());
      const inspected = await pilot.withOp(() => pilot.evalJs(pageInspectionExpression()));
      if (!inspected.ok) throw new Error(inspected.error ?? "page inspection failed");
      page = inspected.value;
      const artifactDir = join2(dshHome(), "shipcheck", "artifacts");
      await mkdir2(artifactDir, { recursive: true });
      const shot = await this.pilotModule.saveScreenshot(pilot, join2(artifactDir, `${Date.now()}-${nameValue.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48)}.png`));
      screenshotPath = shot.path;
    } catch (error) {
      navigationError = String(error.message ?? error);
    } finally {
      stopTelemetry();
    }
    const baseline = await this.store.getBaseline(args.baseline ?? nameValue);
    const evidence = navigationError === null ? buildEvidence({ url, title: snapshot?.title, snapshot, page, runtime: telemetry, screenshotPath }) : buildEvidence({ url, title: "", snapshot: { text: "", links: [], buttons: 0, inputs: 0 }, page: {}, runtime: telemetry, screenshotPath });
    const checks = navigationError === null ? evaluateChecks(evidence, { ...args, baseline_requested: Boolean(args.baseline ?? nameValue) }, baseline) : { status: "failed", passed: false, checks: [{ id: "browser.navigate", category: "availability", status: "fail", message: `Browser could not load the page: ${navigationError}`, evidence: { url } }], summary: { total: 1, passed: 0, warnings: 0, failed: 1 } };
    const reportData = {
      name: nameValue,
      url,
      baseline: baseline ? args.baseline ?? nameValue : null,
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      status: checks.status,
      summary: checks.summary,
      checks: checks.checks,
      evidence
    };
    if (args.matrix !== void 0) reportData.matrix = args.matrix;
    const report = await this.store.saveReport(reportData);
    this.last = report;
    return report;
  }
  async flow(args = {}, exec = {}) {
    const startUrl = validHttpUrl(args.url, "url");
    const steps = normalizeFlowSteps(args.steps);
    const nameValue = typeof args.name === "string" && args.name.trim() ? args.name.trim() : `${new URL(startUrl).hostname}-flow`;
    this.pilotModule ??= await loadPilot();
    this.pool ??= new this.pilotModule.PilotPool();
    const pilot = this.pool.for(exec.agent?.session?.id ?? "shipcheck");
    const started = Date.now();
    const flowSteps = [{ action: "navigate", url: startUrl }, ...steps];
    const artifactDir = join2(dshHome(), "shipcheck", "artifacts");
    const flowSlug = nameValue.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48) || "flow";
    let telemetry = { telemetry_available: false, console_errors: [], console_warnings: [], exceptions: [], network_failures: [] };
    let stopTelemetry = () => {
    };
    const executed = [];
    let lastCapture = null;
    const capture = async (index) => {
      let snapshot = null;
      let page = {};
      let inspectionError = null;
      try {
        snapshot = await pilot.withOp(() => pilot.snapshot());
        const inspected = await pilot.withOp(() => pilot.evalJs(pageInspectionExpression()));
        if (!inspected.ok) throw new Error(inspected.error ?? "page inspection failed");
        page = inspected.value ?? {};
      } catch (error) {
        inspectionError = String(error?.message ?? error);
      }
      let screenshotPath = null;
      let screenshotError = null;
      try {
        await mkdir2(artifactDir, { recursive: true });
        const shot = await this.pilotModule.saveScreenshot(pilot, join2(artifactDir, `${Date.now()}-${flowSlug}-step-${String(index).padStart(2, "0")}.png`));
        screenshotPath = shot.path;
      } catch (error) {
        screenshotError = String(error?.message ?? error);
      }
      return { snapshot, page, inspectionError, screenshotPath, screenshotError };
    };
    try {
      await pilot.withOp(() => pilot.ensure());
      const captureTelemetry = await startTelemetry(pilot);
      telemetry = captureTelemetry.telemetry;
      stopTelemetry = captureTelemetry.stop;
      for (let index = 0; index < flowSteps.length; index++) {
        const step = flowSteps[index];
        const stepStarted = Date.now();
        let result2 = null;
        let error = null;
        try {
          result2 = await pilot.withOp(() => {
            if (step.action === "navigate") return pilot.navigate(step.url);
            if (step.action === "click") return pilot.click(step.ref ?? step.selector);
            if (step.action === "fill") return pilot.fill(step.fields);
            if (step.action === "press") return pilot.press(step.key);
            if (step.action === "wait") return pilot.wait(step.ms);
            if (step.action === "wait_for") return pilot.waitFor({ text: step.text, selector: step.selector, urlIncludes: step.url_includes, timeoutMs: step.timeout_ms });
            return pilot.assert({ text: step.text, selector: step.selector, urlIncludes: step.url_includes });
          });
          if (result2?.ok === false) error = result2.error ?? `${step.action} failed`;
        } catch (actionError) {
          error = String(actionError?.message ?? actionError);
        }
        const evidence = await capture(index + 1);
        lastCapture = evidence;
        if (error === null && evidence.inspectionError !== null) error = `page evidence failed: ${evidence.inspectionError}`;
        if (error === null && evidence.screenshotError !== null) error = `screenshot failed: ${evidence.screenshotError}`;
        const status = error === null ? "passed" : "failed";
        executed.push({
          index: index + 1,
          action: step.action,
          input: safeFlowStep(step),
          status,
          error,
          duration_ms: Date.now() - stepStarted,
          result: safeFlowResult(result2),
          url: evidence.snapshot?.url ?? pilot.url ?? startUrl,
          title: evidence.snapshot?.title ?? pilot.title ?? "",
          screenshot_path: evidence.screenshotPath,
          evidence: {
            url: evidence.snapshot?.url ?? pilot.url ?? startUrl,
            title: evidence.snapshot?.title ?? pilot.title ?? "",
            text: String(evidence.snapshot?.text ?? "").slice(0, 1200),
            h1: Array.isArray(evidence.page?.h1) ? evidence.page.h1 : [],
            screenshot_path: evidence.screenshotPath
          }
        });
        if (status === "failed") break;
      }
    } finally {
      stopTelemetry();
    }
    const finalStep = executed.at(-1);
    const finalEvidence = buildEvidence({ url: finalStep?.url ?? startUrl, title: finalStep?.title ?? "", snapshot: lastCapture?.snapshot, page: lastCapture?.page, runtime: telemetry, screenshotPath: finalStep?.screenshot_path });
    const finalChecks = evaluateChecks(finalEvidence, { ...args, baseline_requested: false }, null);
    const stepChecks = executed.map((step) => step.status === "passed" ? { id: `flow.step:${step.index}`, category: "flow", status: "pass", message: `Flow step ${step.index} (${step.action}) completed.`, evidence: { action: step.action, screenshot_path: step.screenshot_path, url: step.url } } : { id: `flow.step:${step.index}`, category: "flow", status: "fail", message: `Flow step ${step.index} (${step.action}) failed: ${step.error}.`, evidence: { action: step.action, screenshot_path: step.screenshot_path, url: step.url, result: step.result } });
    const checks = [...stepChecks, ...finalChecks.checks];
    const summary = {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: checks.filter((check) => check.status === "warn").length,
      failed: checks.filter((check) => check.status === "fail").length
    };
    const report = await this.store.saveReport({
      kind: "flow",
      name: nameValue,
      url: startUrl,
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      status: summary.failed === 0 ? "passed" : "failed",
      summary,
      checks,
      evidence: {
        type: "flow",
        flow: { requested_steps: flowSteps.length, executed_steps: executed.length, stopped_at: executed.find((step) => step.status === "failed")?.index ?? null },
        steps: executed,
        final: finalEvidence
      }
    });
    this.last = report;
    return report;
  }
  async matrix(args = {}, exec = {}) {
    const urls = matrixUrls(args.urls);
    const matrixName = typeof args.name === "string" && args.name.trim() ? args.name.trim() : new URL(urls[0]).hostname;
    const baselineRoot = typeof args.baseline === "string" && args.baseline.trim() ? args.baseline.trim() : matrixName;
    this.pilotModule ??= await loadPilot();
    this.pool ??= new this.pilotModule.PilotPool();
    const started = Date.now();
    const routes = [];
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index];
      const route = matrixRouteKey(url, index);
      const routeName = `${matrixName}/${route}`;
      const routeBaseline = `${baselineRoot}/${route}`;
      try {
        const report2 = await this.run({
          ...args,
          url,
          name: routeName,
          baseline: routeBaseline,
          matrix: { name: matrixName, index: index + 1, total: urls.length, route, baseline: routeBaseline }
        }, exec);
        routes.push({ report: report2, index: index + 1, route, name: routeName, baseline: routeBaseline, url });
      } catch (error) {
        const message = String(error?.message ?? error);
        routes.push({
          report: null,
          index: index + 1,
          route,
          name: routeName,
          baseline: routeBaseline,
          url,
          status: "failed",
          summary: { total: 1, passed: 0, warnings: 0, failed: 1 },
          failed_checks: [{ id: "matrix.route", category: "availability", status: "fail", message, evidence: { url } }]
        });
      }
    }
    const routeEvidence = routes.map((item) => {
      const report2 = item.report;
      return {
        index: item.index,
        route: item.route,
        name: item.name,
        baseline: item.baseline,
        url: item.url,
        report_id: report2?.id ?? null,
        status: report2?.status ?? item.status,
        summary: report2?.summary ?? item.summary,
        screenshot_path: report2?.evidence?.screenshot_path ?? null,
        failed_checks: report2 ? report2.checks.filter((check) => check.status !== "pass").slice(0, 8) : item.failed_checks
      };
    });
    const checks = routes.flatMap((item) => {
      const routeChecks = item.report?.checks ?? item.failed_checks ?? [];
      return routeChecks.map((check) => ({
        ...check,
        id: `route:${item.route}::${check.id}`,
        message: `[${item.route}] ${check.message}`,
        evidence: { ...check.evidence, route: item.route, url: item.url, report_id: item.report?.id ?? null }
      }));
    });
    const summary = {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: checks.filter((check) => check.status === "warn").length,
      failed: checks.filter((check) => check.status === "fail").length
    };
    const routeSummary = {
      total: routes.length,
      passed: routes.filter((item) => (item.report?.status ?? item.status) === "passed").length,
      failed: routes.filter((item) => (item.report?.status ?? item.status) !== "passed").length
    };
    const report = await this.store.saveReport({
      kind: "matrix",
      name: matrixName,
      url: `matrix://${matrixName}`,
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      status: routeSummary.failed === 0 ? "passed" : "failed",
      summary,
      route_summary: routeSummary,
      checks,
      evidence: { type: "matrix", name: matrixName, routes: routeEvidence }
    });
    this.last = report;
    return report;
  }
  async baseline(args = {}, exec = {}) {
    const report = await this.run({ ...args, baseline: null }, exec);
    const baseline = await this.store.saveBaseline(args.name ?? new URL(args.url).hostname, report.evidence);
    return { ...baseline, report_id: report.id, status: report.status, summary: report.summary };
  }
  async history(limit) {
    return this.store.history(limit);
  }
  async dispose() {
    if (this.pool !== null) await this.pool.disposeAll();
  }
};
function apply(ctx) {
  const runtime = new ShipcheckRuntime();
  const tools = ctx.tools;
  if (tools !== void 0) {
    const define = (toolName, description, parameters, execute, render) => ({
      name: toolName,
      description,
      parameters,
      timeoutMs: 12e4,
      output: { schema: { type: "object" }, render(_args, value) {
        return [{ type: "text", text: render(value) }];
      } },
      async execute(args, exec) {
        if (exec?.signal?.aborted) throw new Error("aborted");
        return execute(args, exec);
      }
    });
    const defs = [
      define("shipcheck_run", "Run evidence-first frontend acceptance checks in a real browser. Captures a screenshot, checks content/accessibility/layout/contracts and browser runtime failures, compares a named baseline when present, and saves a reproducible JSON report. It never edits the project.", object({
        url: string("Full http(s) URL to inspect."),
        name: string("Optional project/baseline name; defaults to the URL hostname."),
        baseline: string("Optional named baseline; defaults to the project name."),
        wait_ms: { type: "number", description: "Optional settle time from 0 to 30000 ms." },
        required_text: strings("Optional visible strings that must be present."),
        forbidden_text: strings("Optional visible strings that must be absent."),
        required_selectors: strings("Optional CSS selectors that must exist.")
      }, ["url"]), (args) => runtime.run(args), (value) => `${renderCheckSummary(value)}
Report: ${value.id}
Screenshot: ${value.evidence.screenshot_path}
${value.checks.filter((check) => check.status !== "pass").slice(0, 8).map((check) => `[${check.status}] ${check.message}`).join("\n")}`),
      define("shipcheck_matrix", "Run the same evidence-first release checks across 1-20 URLs in a real browser. Each route gets its own screenshot, JSON report, and namespaced baseline; the returned matrix report shows the overall gate and every route failure with evidence.", object({
        urls: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" }, description: "One to twenty full http(s) URLs to inspect in order." },
        name: string("Optional matrix name; defaults to the first URL hostname."),
        baseline: string("Optional baseline namespace; each route uses a separate generated baseline name."),
        wait_ms: { type: "number", description: "Optional settle time from 0 to 30000 ms, applied to every route." },
        required_text: strings("Optional visible strings that must be present on every route."),
        forbidden_text: strings("Optional visible strings that must be absent on every route."),
        required_selectors: strings("Optional CSS selectors that must exist on every route.")
      }, ["urls"]), (args) => runtime.matrix(args), renderMatrixSummary),
      define("shipcheck_flow", "Execute a bounded user journey in a real browser: navigate, click, fill, press, wait for conditions, and assert outcomes. Captures a screenshot and redacted step evidence after every action, records browser runtime failures across the journey, and saves one reproducible flow report. It never submits external data unless the supplied steps explicitly do so.", object({
        url: string("Starting full http(s) URL."),
        name: string("Optional flow name; defaults to the starting hostname plus -flow."),
        steps: { type: "array", minItems: 1, maxItems: 30, items: flowStepSchema(), description: "One to thirty ordered browser steps. Fill values are accepted for the live page but redacted in the saved report." },
        required_text: strings("Optional visible strings that must be present on the final page."),
        forbidden_text: strings("Optional visible strings that must be absent on the final page."),
        required_selectors: strings("Optional CSS selectors that must exist on the final page.")
      }, ["url", "steps"]), (args) => runtime.flow(args), renderFlowSummary),
      define("shipcheck_baseline", "Capture a reviewed page as a named shipcheck baseline. Future shipcheck_run calls compare structural evidence and report regressions; this is an explicit write and never modifies the inspected page.", object({
        url: string("Full http(s) URL to inspect."),
        name: string("Stable project/baseline name."),
        wait_ms: { type: "number", description: "Optional settle time from 0 to 30000 ms." }
      }, ["url", "name"]), (args) => runtime.baseline(args), (value) => `Baseline saved: ${value.name}
Initial run: ${value.report_id} (${value.status})`),
      define("shipcheck_history", "List recent shipcheck reports with their pass/fail summary and evidence paths.", object({ limit: { type: "number", description: "Number of recent reports, 1-50; default 12." } }), (args) => runtime.history(args.limit), (value) => value.length ? value.map(renderHistoryLine).join("\n") : "No shipcheck reports yet.")
    ];
    for (const def of defs) ctx.effect(() => tools.register(def), `dsh-shipcheck: tool ${def.name}`);
  }
  const webServer = ctx.webServer;
  if (webServer !== void 0) ctx.effect(() => webServer.register({
    kind: "prefix",
    path: "/dsh-shipcheck",
    handler: async (req, res) => {
      if (!LOOPBACKS.has(req.socket.remoteAddress ?? "")) return sendJson(res, 403, { error: "loopback only" });
      const pathname = new URL(req.url ?? "/", "http://x").pathname;
      const suffix = pathname.slice("/dsh-shipcheck".length) || "/";
      try {
        if (req.method === "GET" && suffix === "/state") return sendJson(res, 200, { last: runtime.last, history: await runtime.history(8) });
        if (req.method === "GET" && suffix === "/history") return sendJson(res, 200, await runtime.history(20));
        if (req.method === "POST" && suffix === "/run") return sendJson(res, 200, await runtime.run(JSON.parse(await readBody(req) || "{}"), { agent: { session: { id: "shipcheck-panel" } } }));
        if (req.method === "POST" && suffix === "/flow") return sendJson(res, 200, await runtime.flow(JSON.parse(await readBody(req) || "{}"), { agent: { session: { id: "shipcheck-panel" } } }));
        if (req.method === "POST" && suffix === "/matrix") return sendJson(res, 200, await runtime.matrix(JSON.parse(await readBody(req) || "{}"), { agent: { session: { id: "shipcheck-panel" } } }));
        if (req.method === "POST" && suffix === "/baseline") return sendJson(res, 200, await runtime.baseline(JSON.parse(await readBody(req) || "{}"), { agent: { session: { id: "shipcheck-panel" } } }));
        return sendJson(res, 404, { error: "no such endpoint" });
      } catch (error) {
        return sendJson(res, 400, { error: String(error.message ?? error) });
      }
    }
  }), "dsh-shipcheck: web routes");
  ctx.effect(() => () => runtime.dispose(), "dsh-shipcheck: runtime cleanup");
}
export {
  ShipcheckRuntime,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
