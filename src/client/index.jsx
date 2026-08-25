/** dsh-shipcheck client: a small, evidence-first release panel. */
import React, { useEffect, useState } from 'react'

export const name = 'dsh-shipcheck'
export const inject = ['slots']

const panelStyle = {
  position: 'fixed', top: '4.5rem', left: '21rem', zIndex: 1200, width: 380,
  maxHeight: 'calc(100vh - 7rem)', overflow: 'auto', borderRadius: 12,
  background: 'rgba(24, 26, 32, 0.97)', border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.45)', color: '#e8eaf0',
  fontFamily: 'system-ui, sans-serif', fontSize: 12,
}
const buttonStyle = { background: 'rgba(255,255,255,0.12)', color: '#e8eaf0', border: 'none', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12 }
const inputStyle = { flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.08)', color: '#e8eaf0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 8px', fontSize: 12 }

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
  const historyNodes = (state.history ?? []).slice(0, 8).map(report => React.createElement('div', { key: report.id, style: { borderTop: '1px solid rgba(255,255,255,0.08)', padding: '7px 0', display: 'flex', gap: 8 } },
    React.createElement('span', { style: { color: statusColor(report.status), fontWeight: 700 } }, report.status === 'passed' ? 'PASS' : 'FAIL'),
    React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, report.name),
    React.createElement('span', { style: { opacity: 0.65 } }, `${report.summary?.failed ?? 0} fail`)))
  const run = async () => {
    if (!/^https?:\/\//.test(url)) return
    setBusy(true)
    try { const report = await post('run', { url }); setState(current => ({ ...current, last: report, history: [report, ...(current.history ?? [])].slice(0, 8) })) } catch (error) { setState(current => ({ ...current, error: error.message })) } finally { setBusy(false) }
  }
  return React.createElement('div', { style: panelStyle },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', position: 'sticky', top: 0, background: 'rgba(32,34,42,0.98)', zIndex: 1 } },
      React.createElement('span', { style: { fontSize: 16 } }, '🚢'),
      React.createElement('strong', { style: { flex: 1 } }, 'dsh-shipcheck'),
      React.createElement('button', { style: buttonStyle, onClick: () => close(false) }, '×')),
    React.createElement('div', { style: { padding: '0 12px 12px' } },
      React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 10 } },
        React.createElement('input', { style: inputStyle, value: url, onChange: event => setUrl(event.target.value), onKeyDown: event => { if (event.key === 'Enter') run() }, placeholder: 'http://localhost:3000' }),
        React.createElement('button', { style: buttonStyle, disabled: busy, onClick: run }, busy ? '检查中…' : '验收')),
      state.error ? React.createElement('div', { style: { color: '#ff9494', marginBottom: 8 } }, state.error) : null,
      last ? React.createElement('div', { style: { border: `1px solid ${statusColor(last.status)}`, borderRadius: 8, padding: 9, marginBottom: 10 } },
        React.createElement('div', { style: { color: statusColor(last.status), fontWeight: 700, marginBottom: 4 } }, last.status === 'passed' ? 'PASS · 可以继续人工验收' : 'FAIL · 需要修复后再交付'),
        React.createElement('div', { style: { opacity: 0.8, wordBreak: 'break-all' } }, last.url),
        React.createElement('div', { style: { marginTop: 5 } }, `${last.summary?.passed ?? 0} passed · ${last.summary?.warnings ?? 0} warnings · ${last.summary?.failed ?? 0} failed`),
        React.createElement('div', { style: { marginTop: 8, display: 'grid', gap: 4 } }, (last.checks ?? []).filter(check => check.status !== 'pass').slice(0, 6).map(check => React.createElement('div', { key: check.id, style: { color: statusColor(check.status) } }, `[${check.status}] ${check.message}`))),
        last.evidence?.screenshot_path ? React.createElement('div', { style: { opacity: 0.65, marginTop: 7, wordBreak: 'break-all' } }, `证据：${last.evidence.screenshot_path}`) : null,
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
