// src/index.js
import { join as join2 } from "node:path";
import { homedir } from "node:os";
import { mkdir as mkdir2 } from "node:fs/promises";
import { PilotPool, saveScreenshot } from "dsh-pilot";

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
function buildEvidence({ url, title, snapshot, page, screenshotPath = null, capturedAt = (/* @__PURE__ */ new Date()).toISOString() }) {
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
function object(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
var string = (description) => ({ type: "string", description });
var strings = (description) => ({ type: "array", items: { type: "string" }, description });
var ShipcheckRuntime = class {
  constructor({ store = new ShipcheckStore(join2(dshHome(), "shipcheck")) } = {}) {
    this.pool = new PilotPool();
    this.store = store;
    this.last = null;
  }
  async run(args = {}, exec = {}) {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!/^https?:\/\//.test(url)) throw new Error("shipcheck: url must be an http(s) URL");
    const nameValue = typeof args.name === "string" && args.name.trim() ? args.name.trim() : new URL(url).hostname;
    const pilot = this.pool.for(exec.agent?.session?.id ?? "shipcheck");
    const started = Date.now();
    let snapshot;
    let page;
    let screenshotPath = null;
    let navigationError = null;
    try {
      snapshot = await pilot.withOp(() => pilot.navigate(url));
      if (args.wait_ms) await pilot.withOp(() => pilot.wait(args.wait_ms));
      snapshot = await pilot.withOp(() => pilot.snapshot());
      const inspected = await pilot.withOp(() => pilot.evalJs(pageInspectionExpression()));
      if (!inspected.ok) throw new Error(inspected.error ?? "page inspection failed");
      page = inspected.value;
      const artifactDir = join2(dshHome(), "shipcheck", "artifacts");
      await mkdir2(artifactDir, { recursive: true });
      const shot = await saveScreenshot(pilot, join2(artifactDir, `${Date.now()}-${nameValue.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48)}.png`));
      screenshotPath = shot.path;
    } catch (error) {
      navigationError = String(error.message ?? error);
    }
    const baseline = await this.store.getBaseline(args.baseline ?? nameValue);
    const evidence = navigationError === null ? buildEvidence({ url, title: snapshot?.title, snapshot, page, screenshotPath }) : buildEvidence({ url, title: "", snapshot: { text: "", links: [], buttons: 0, inputs: 0 }, page: {}, screenshotPath });
    const checks = navigationError === null ? evaluateChecks(evidence, { ...args, baseline_requested: Boolean(args.baseline ?? nameValue) }, baseline) : { status: "failed", passed: false, checks: [{ id: "browser.navigate", category: "availability", status: "fail", message: `Browser could not load the page: ${navigationError}`, evidence: { url } }], summary: { total: 1, passed: 0, warnings: 0, failed: 1 } };
    const report = await this.store.saveReport({
      name: nameValue,
      url,
      baseline: baseline ? args.baseline ?? nameValue : null,
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      status: checks.status,
      summary: checks.summary,
      checks: checks.checks,
      evidence
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
    await this.pool.disposeAll();
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
      define("shipcheck_run", "Run evidence-first frontend acceptance checks in a real browser. Captures a screenshot, checks content/accessibility/layout/contracts, compares a named baseline when present, and saves a reproducible JSON report. It never edits the project.", object({
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
      define("shipcheck_baseline", "Capture a reviewed page as a named shipcheck baseline. Future shipcheck_run calls compare structural evidence and report regressions; this is an explicit write and never modifies the inspected page.", object({
        url: string("Full http(s) URL to inspect."),
        name: string("Stable project/baseline name."),
        wait_ms: { type: "number", description: "Optional settle time from 0 to 30000 ms." }
      }, ["url", "name"]), (args) => runtime.baseline(args), (value) => `Baseline saved: ${value.name}
Initial run: ${value.report_id} (${value.status})`),
      define("shipcheck_history", "List recent shipcheck reports with their pass/fail summary and evidence paths.", object({ limit: { type: "number", description: "Number of recent reports, 1-50; default 12." } }), (args) => runtime.history(args.limit), (value) => value.length ? value.map((report) => `${report.status.toUpperCase()} ${report.name} \u2014 ${report.summary.failed} failed / ${report.summary.warnings} warnings \u2014 ${report.url}`).join("\n") : "No shipcheck reports yet.")
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
