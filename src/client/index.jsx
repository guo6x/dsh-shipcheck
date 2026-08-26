/** dsh-shipcheck client: a small, evidence-first release panel. */
import React, { useEffect, useState } from 'react'

export const name = 'dsh-shipcheck'
export const inject = ['slots']

const panelStyle = {
  // Dock beside the pilot cockpit by default; the palate panel docks below
  // the cockpit. This keeps all release controls reachable when the panels
  // are opened together.
  position: 'fixed', top: '4.5rem', right: '1rem', zIndex: 1200, width: 380,
  maxHeight: 'calc(100vh - 7rem)', overflow: 'auto', borderRadius: 12,
  background: 'rgba(24, 26, 32, 0.97)', border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.45)', color: '#e8eaf0',
  fontFamily: 'system-ui, sans-serif', fontSize: 12,
}
const buttonStyle = { background: 'rgba(255,255,255,0.12)', color: '#e8eaf0', border: 'none', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12 }
const inputStyle = { flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.08)', color: '#e8eaf0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 8px', fontSize: 12 }
const textareaStyle = { ...inputStyle, minHeight: 72, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }

const store = { open: false, listeners: new Set() }
function setOpen(open) { store.open = open; for (const listener of store.listeners) listener() }
function useOpen() {
  const [open, setOpenState] = useState(store.open)
  useEffect(() => { const listener = () => setOpenState(store.open); store.listeners.add(listener); return () => store.listeners.delete(listener) }, [])
  return [open, setOpen]
}

async function getState() {
  const response = await fetch('/dsh-shipcheck/state', { cache: 'no-store' })
  if (!response.ok) throw new Error(`shipcheck: http ${response.status}`)
  return response.json()
}

async function post(path, body) {
  const response = await fetch(`/dsh-shipcheck/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `shipcheck: http ${response.status}`)
  return value
}

function statusColor(status) { return status === 'passed' || status === 'pass' ? '#8be28b' : status === 'warn' ? '#f2c879' : '#ff9494' }

function ShipcheckPanel() {
  const [open, close] = useOpen()
  const [state, setState] = useState({ history: [] })
  const [url, setUrl] = useState('http://127.0.0.1:3000')
  const [matrixMode, setMatrixMode] = useState(false)
  const [matrixName, setMatrixName] = useState('release-matrix')
  const [urlsText, setUrlsText] = useState('http://127.0.0.1:3000\nhttp://127.0.0.1:3000/login')
  const [flowMode, setFlowMode] = useState(false)
  const [flowName, setFlowName] = useState('release-flow')
  const [flowText, setFlowText] = useState('[\n  { "action": "wait_for", "selector": "main", "timeout_ms": 5000 },\n  { "action": "assert", "selector": "main" }\n]')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    let alive = true
    const load = async () => { try { const next = await getState(); if (alive) setState(next) } catch {} }
    load(); const timer = setInterval(load, 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [open])
  if (!open) return null
  const last = state.last ?? state.history?.[0]
  const isMatrix = last?.evidence?.type === 'matrix'
  const isFlow = last?.evidence?.type === 'flow'
  const historyNodes = (state.history ?? []).slice(0, 8).map(report => React.createElement('div', { key: report.id, style: { borderTop: '1px solid rgba(255,255,255,0.08)', padding: '7px 0', display: 'flex', gap: 8 } },
    React.createElement('span', { style: { color: statusColor(report.status), fontWeight: 700 } }, report.status === 'passed' ? 'PASS' : 'FAIL'),
    React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, report.name),
    React.createElement('span', { style: { opacity: 0.65 } }, `${report.summary?.failed ?? 0} fail`)))
  const run = async () => {
    const urls = matrixMode ? urlsText.split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean) : [url.trim()]
    if (!urls.length || urls.some(value => !/^https?:\/\//.test(value))) {
      setState(current => ({ ...current, error: matrixMode ? '请输入每行一个 http(s) 地址。' : '请输入 http(s) 地址。' }))
      return
    }
    let flowSteps = null
    if (flowMode) {
      try {
        flowSteps = JSON.parse(flowText)
        if (!Array.isArray(flowSteps)) throw new Error('流程步骤必须是 JSON 数组。')
      } catch (error) {
        setState(current => ({ ...current, error: `流程 JSON 无法解析：${error.message}` }))
        return
      }
    }
    setBusy(true)
    try {
      const report = flowMode
        ? await post('flow', { url: urls[0], name: flowName.trim() || 'release-flow', steps: flowSteps })
        : matrixMode
          ? await post('matrix', { urls, name: matrixName.trim() || 'release-matrix' })
          : await post('run', { url: urls[0] })
      setState(current => ({ ...current, error: null, last: report, history: [report, ...(current.history ?? [])].slice(0, 8) }))
    } catch (error) { setState(current => ({ ...current, error: error.message })) } finally { setBusy(false) }
  }
  return React.createElement('div', { style: panelStyle },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', position: 'sticky', top: 0, background: 'rgba(32,34,42,0.98)', zIndex: 1 } },
      React.createElement('span', { style: { fontSize: 16 } }, '🚢'),
      React.createElement('strong', { style: { flex: 1 } }, 'dsh-shipcheck'),
      React.createElement('button', { style: buttonStyle, onClick: () => close(false) }, '×')),
    React.createElement('div', { style: { padding: '0 12px 12px' } },
      React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 7 } },
        React.createElement('button', { style: buttonStyle, onClick: () => { setMatrixMode(false); setFlowMode(false) }, disabled: !matrixMode && !flowMode }, '单页'),
        React.createElement('button', { style: buttonStyle, onClick: () => { setMatrixMode(true); setFlowMode(false) }, disabled: matrixMode }, '多路由'),
        React.createElement('button', { style: buttonStyle, onClick: () => { setMatrixMode(false); setFlowMode(true) }, disabled: flowMode }, '流程')),
      React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 10 } },
        matrixMode
          ? React.createElement('textarea', { style: textareaStyle, value: urlsText, onChange: event => setUrlsText(event.target.value), placeholder: '每行一个 http(s) 地址' })
          : React.createElement('input', { style: inputStyle, value: url, onChange: event => setUrl(event.target.value), onKeyDown: event => { if (event.key === 'Enter') run() }, placeholder: 'http://localhost:3000' }),
        React.createElement('button', { style: buttonStyle, disabled: busy, onClick: run }, busy ? '检查中…' : '验收')),
      matrixMode ? React.createElement('input', { style: { ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 8 }, value: matrixName, onChange: event => setMatrixName(event.target.value), placeholder: '矩阵名，例如 checkout-release' }) : null,
      flowMode ? React.createElement('input', { style: { ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 8 }, value: flowName, onChange: event => setFlowName(event.target.value), placeholder: '流程名，例如 checkout-flow' }) : null,
      flowMode ? React.createElement('textarea', { style: { ...textareaStyle, width: '100%', boxSizing: 'border-box', minHeight: 130, marginBottom: 8 }, value: flowText, onChange: event => setFlowText(event.target.value), spellCheck: false, placeholder: 'JSON 步骤数组，例如 [{"action":"assert","selector":"main"}]' }) : null,
      state.error ? React.createElement('div', { style: { color: '#ff9494', marginBottom: 8 } }, state.error) : null,
      last ? React.createElement('div', { style: { border: `1px solid ${statusColor(last.status)}`, borderRadius: 8, padding: 9, marginBottom: 10 } },
        React.createElement('div', { style: { color: statusColor(last.status), fontWeight: 700, marginBottom: 4 } }, last.status === 'passed' ? 'PASS · 可以继续人工验收' : 'FAIL · 需要修复后再交付'),
        React.createElement('div', { style: { opacity: 0.8, wordBreak: 'break-all' } }, isMatrix ? `${last.route_summary?.passed ?? 0}/${last.route_summary?.total ?? 0} 路由通过` : isFlow ? `${last.evidence?.flow?.executed_steps ?? 0}/${last.evidence?.flow?.requested_steps ?? 0} 步骤完成` : last.url),
        React.createElement('div', { style: { marginTop: 5 } }, `${last.summary?.passed ?? 0} passed · ${last.summary?.warnings ?? 0} warnings · ${last.summary?.failed ?? 0} failed`),
        isMatrix
          ? React.createElement('div', { style: { marginTop: 8, display: 'grid', gap: 6 } }, (last.evidence?.routes ?? []).map(route => React.createElement('div', { key: route.report_id ?? route.route, style: { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 } },
              React.createElement('div', { style: { color: statusColor(route.status), fontWeight: 700 } }, `${route.status === 'passed' ? 'PASS' : 'FAIL'} · ${route.route}`),
              React.createElement('div', { style: { opacity: 0.7, wordBreak: 'break-all' } }, route.url),
              (route.failed_checks ?? []).slice(0, 2).map(check => React.createElement('div', { key: check.id, style: { color: statusColor(check.status), marginTop: 3 } }, `[${check.status}] ${check.message}`)),
              route.screenshot_path ? React.createElement('div', { style: { opacity: 0.6, marginTop: 3, wordBreak: 'break-all' } }, `证据：${route.screenshot_path}`) : null,
            )))
          : isFlow
            ? React.createElement('div', { style: { marginTop: 8, display: 'grid', gap: 6 } }, (last.evidence?.steps ?? []).map(step => React.createElement('div', { key: step.index, style: { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 } },
                React.createElement('div', { style: { color: statusColor(step.status === 'passed' ? 'passed' : 'failed'), fontWeight: 700 } }, `${step.status === 'passed' ? 'PASS' : 'FAIL'} · ${step.index}. ${step.action}`),
                step.error ? React.createElement('div', { style: { color: '#ff9494', marginTop: 3 } }, step.error) : null,
                step.screenshot_path ? React.createElement('div', { style: { opacity: 0.6, marginTop: 3, wordBreak: 'break-all' } }, `证据：${step.screenshot_path}`) : null,
              )))
            : React.createElement('div', { style: { marginTop: 8, display: 'grid', gap: 4 } }, (last.checks ?? []).filter(check => check.status !== 'pass').slice(0, 6).map(check => React.createElement('div', { key: check.id, style: { color: statusColor(check.status) } }, `[${check.status}] ${check.message}`))),
        !isMatrix && !isFlow && last.evidence?.screenshot_path ? React.createElement('div', { style: { opacity: 0.65, marginTop: 7, wordBreak: 'break-all' } }, `证据：${last.evidence.screenshot_path}`) : null,
      ) : React.createElement('div', { style: { opacity: 0.65, marginBottom: 10 } }, '还没有验收报告。先输入本地开发地址，点击“验收”。'),
      React.createElement('strong', { style: { display: 'block', marginBottom: 5 } }, '最近报告'),
      historyNodes,
    ))
}

function ShipcheckButton() {
  const [open] = useOpen()
  return React.createElement('button', { title: '前端交付验收', style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: 4 }, onClick: () => setOpen(!open) }, open ? '🚢' : '⚓')
}

export function apply(ctx) {
  const slots = ctx.slots
  if (slots === undefined) return
  slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'dsh-shipcheck', order: 890, label: '前端交付验收' }, () => React.createElement(ShipcheckButton)))
  slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'dsh-shipcheck-panel', order: 190, label: '前端交付验收' }, () => React.createElement(ShipcheckPanel)))
}
