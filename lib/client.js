window.__ModuleLoader__.load({ id: 'dsh-shipcheck', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);
var name = "dsh-shipcheck";
var inject = ["slots"];
var panelStyle = {
  position: "fixed",
  top: "4.5rem",
  left: "21rem",
  zIndex: 1200,
  width: 380,
  maxHeight: "calc(100vh - 7rem)",
  overflow: "auto",
  borderRadius: 12,
  background: "rgba(24, 26, 32, 0.97)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  color: "#e8eaf0",
  fontFamily: "system-ui, sans-serif",
  fontSize: 12
};
var buttonStyle = { background: "rgba(255,255,255,0.12)", color: "#e8eaf0", border: "none", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontSize: 12 };
var inputStyle = { flex: 1, minWidth: 0, background: "rgba(255,255,255,0.08)", color: "#e8eaf0", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "6px 8px", fontSize: 12 };
var textareaStyle = { ...inputStyle, minHeight: 72, resize: "vertical", fontFamily: "ui-monospace, monospace" };
var store = { open: false, listeners: /* @__PURE__ */ new Set() };
function setOpen(open) {
  store.open = open;
  for (const listener of store.listeners) listener();
}
function useOpen() {
  const [open, setOpenState] = (0, import_react.useState)(store.open);
  (0, import_react.useEffect)(() => {
    const listener = () => setOpenState(store.open);
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  }, []);
  return [open, setOpen];
}
async function getState() {
  const response = await fetch("/dsh-shipcheck/state", { cache: "no-store" });
  if (!response.ok) throw new Error(`shipcheck: http ${response.status}`);
  return response.json();
}
async function post(path, body) {
  const response = await fetch(`/dsh-shipcheck/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `shipcheck: http ${response.status}`);
  return value;
}
function statusColor(status) {
  return status === "passed" || status === "pass" ? "#8be28b" : status === "warn" ? "#f2c879" : "#ff9494";
}
function ShipcheckPanel() {
  const [open, close] = useOpen();
  const [state, setState] = (0, import_react.useState)({ history: [] });
  const [url, setUrl] = (0, import_react.useState)("http://127.0.0.1:3000");
  const [matrixMode, setMatrixMode] = (0, import_react.useState)(false);
  const [matrixName, setMatrixName] = (0, import_react.useState)("release-matrix");
  const [urlsText, setUrlsText] = (0, import_react.useState)("http://127.0.0.1:3000\nhttp://127.0.0.1:3000/login");
  const [busy, setBusy] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    if (!open) return void 0;
    let alive = true;
    const load = async () => {
      try {
        const next = await getState();
        if (alive) setState(next);
      } catch {
      }
    };
    load();
    const timer = setInterval(load, 4e3);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);
  if (!open) return null;
  const last = state.last ?? state.history?.[0];
  const isMatrix = last?.evidence?.type === "matrix";
  const historyNodes = (state.history ?? []).slice(0, 8).map((report) => import_react.default.createElement(
    "div",
    { key: report.id, style: { borderTop: "1px solid rgba(255,255,255,0.08)", padding: "7px 0", display: "flex", gap: 8 } },
    import_react.default.createElement("span", { style: { color: statusColor(report.status), fontWeight: 700 } }, report.status === "passed" ? "PASS" : "FAIL"),
    import_react.default.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, report.name),
    import_react.default.createElement("span", { style: { opacity: 0.65 } }, `${report.summary?.failed ?? 0} fail`)
  ));
  const run = async () => {
    const urls = matrixMode ? urlsText.split(/[\r\n,]+/).map((value) => value.trim()).filter(Boolean) : [url.trim()];
    if (!urls.length || urls.some((value) => !/^https?:\/\//.test(value))) {
      setState((current) => ({ ...current, error: matrixMode ? "\u8BF7\u8F93\u5165\u6BCF\u884C\u4E00\u4E2A http(s) \u5730\u5740\u3002" : "\u8BF7\u8F93\u5165 http(s) \u5730\u5740\u3002" }));
      return;
    }
    setBusy(true);
    try {
      const report = matrixMode ? await post("matrix", { urls, name: matrixName.trim() || "release-matrix" }) : await post("run", { url: urls[0] });
      setState((current) => ({ ...current, error: null, last: report, history: [report, ...current.history ?? []].slice(0, 8) }));
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusy(false);
    }
  };
  return import_react.default.createElement(
    "div",
    { style: panelStyle },
    import_react.default.createElement(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", position: "sticky", top: 0, background: "rgba(32,34,42,0.98)", zIndex: 1 } },
      import_react.default.createElement("span", { style: { fontSize: 16 } }, "\u{1F6A2}"),
      import_react.default.createElement("strong", { style: { flex: 1 } }, "dsh-shipcheck"),
      import_react.default.createElement("button", { style: buttonStyle, onClick: () => close(false) }, "\xD7")
    ),
    import_react.default.createElement(
      "div",
      { style: { padding: "0 12px 12px" } },
      import_react.default.createElement(
        "div",
        { style: { display: "flex", gap: 6, marginBottom: 7 } },
        import_react.default.createElement("button", { style: buttonStyle, onClick: () => setMatrixMode(false), disabled: !matrixMode }, "\u5355\u9875"),
        import_react.default.createElement("button", { style: buttonStyle, onClick: () => setMatrixMode(true), disabled: matrixMode }, "\u591A\u8DEF\u7531")
      ),
      import_react.default.createElement(
        "div",
        { style: { display: "flex", gap: 6, marginBottom: 10 } },
        matrixMode ? import_react.default.createElement("textarea", { style: textareaStyle, value: urlsText, onChange: (event) => setUrlsText(event.target.value), placeholder: "\u6BCF\u884C\u4E00\u4E2A http(s) \u5730\u5740" }) : import_react.default.createElement("input", { style: inputStyle, value: url, onChange: (event) => setUrl(event.target.value), onKeyDown: (event) => {
          if (event.key === "Enter") run();
        }, placeholder: "http://localhost:3000" }),
        import_react.default.createElement("button", { style: buttonStyle, disabled: busy, onClick: run }, busy ? "\u68C0\u67E5\u4E2D\u2026" : "\u9A8C\u6536")
      ),
      matrixMode ? import_react.default.createElement("input", { style: { ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 8 }, value: matrixName, onChange: (event) => setMatrixName(event.target.value), placeholder: "\u77E9\u9635\u540D\uFF0C\u4F8B\u5982 checkout-release" }) : null,
      state.error ? import_react.default.createElement("div", { style: { color: "#ff9494", marginBottom: 8 } }, state.error) : null,
      last ? import_react.default.createElement(
        "div",
        { style: { border: `1px solid ${statusColor(last.status)}`, borderRadius: 8, padding: 9, marginBottom: 10 } },
        import_react.default.createElement("div", { style: { color: statusColor(last.status), fontWeight: 700, marginBottom: 4 } }, last.status === "passed" ? "PASS \xB7 \u53EF\u4EE5\u7EE7\u7EED\u4EBA\u5DE5\u9A8C\u6536" : "FAIL \xB7 \u9700\u8981\u4FEE\u590D\u540E\u518D\u4EA4\u4ED8"),
        import_react.default.createElement("div", { style: { opacity: 0.8, wordBreak: "break-all" } }, isMatrix ? `${last.route_summary?.passed ?? 0}/${last.route_summary?.total ?? 0} \u8DEF\u7531\u901A\u8FC7` : last.url),
        import_react.default.createElement("div", { style: { marginTop: 5 } }, `${last.summary?.passed ?? 0} passed \xB7 ${last.summary?.warnings ?? 0} warnings \xB7 ${last.summary?.failed ?? 0} failed`),
        isMatrix ? import_react.default.createElement("div", { style: { marginTop: 8, display: "grid", gap: 6 } }, (last.evidence?.routes ?? []).map((route) => import_react.default.createElement(
          "div",
          { key: route.report_id ?? route.route, style: { borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6 } },
          import_react.default.createElement("div", { style: { color: statusColor(route.status), fontWeight: 700 } }, `${route.status === "passed" ? "PASS" : "FAIL"} \xB7 ${route.route}`),
          import_react.default.createElement("div", { style: { opacity: 0.7, wordBreak: "break-all" } }, route.url),
          (route.failed_checks ?? []).slice(0, 2).map((check) => import_react.default.createElement("div", { key: check.id, style: { color: statusColor(check.status), marginTop: 3 } }, `[${check.status}] ${check.message}`)),
          route.screenshot_path ? import_react.default.createElement("div", { style: { opacity: 0.6, marginTop: 3, wordBreak: "break-all" } }, `\u8BC1\u636E\uFF1A${route.screenshot_path}`) : null
        ))) : import_react.default.createElement("div", { style: { marginTop: 8, display: "grid", gap: 4 } }, (last.checks ?? []).filter((check) => check.status !== "pass").slice(0, 6).map((check) => import_react.default.createElement("div", { key: check.id, style: { color: statusColor(check.status) } }, `[${check.status}] ${check.message}`))),
        !isMatrix && last.evidence?.screenshot_path ? import_react.default.createElement("div", { style: { opacity: 0.65, marginTop: 7, wordBreak: "break-all" } }, `\u8BC1\u636E\uFF1A${last.evidence.screenshot_path}`) : null
      ) : import_react.default.createElement("div", { style: { opacity: 0.65, marginBottom: 10 } }, "\u8FD8\u6CA1\u6709\u9A8C\u6536\u62A5\u544A\u3002\u5148\u8F93\u5165\u672C\u5730\u5F00\u53D1\u5730\u5740\uFF0C\u70B9\u51FB\u201C\u9A8C\u6536\u201D\u3002"),
      import_react.default.createElement("strong", { style: { display: "block", marginBottom: 5 } }, "\u6700\u8FD1\u62A5\u544A"),
      historyNodes
    )
  );
}
function ShipcheckButton() {
  const [open] = useOpen();
  return import_react.default.createElement("button", { title: "\u524D\u7AEF\u4EA4\u4ED8\u9A8C\u6536", style: { background: "none", border: "none", cursor: "pointer", fontSize: 15, padding: 4 }, onClick: () => setOpen(!open) }, open ? "\u{1F6A2}" : "\u2693");
}
function apply(ctx) {
  const slots = ctx.slots;
  if (slots === void 0) return;
  slots.inject("sidebar.footer.action", () => slots.register({ name: "sidebar.footer.action", id: "dsh-shipcheck", order: 890, label: "\u524D\u7AEF\u4EA4\u4ED8\u9A8C\u6536" }, () => import_react.default.createElement(ShipcheckButton)));
  slots.inject("shell.overlay", () => slots.register({ name: "shell.overlay", id: "dsh-shipcheck-panel", order: 190, label: "\u524D\u7AEF\u4EA4\u4ED8\u9A8C\u6536" }, () => import_react.default.createElement(ShipcheckPanel)));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
