import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const expectedTools = new Set(['shipcheck_run', 'shipcheck_baseline', 'shipcheck_history'])
const home = mkdtempSync(join(tmpdir(), 'dsh-shipcheck-host-'))
const previousHome = process.env.DSH_HOME
const registeredTools = new Map()
const registeredRoutes = []
const effects = []

function check(label, condition) {
  assert.ok(condition, label)
  console.log(`PASS  ${label}`)
}

function context() {
  return {
    tools: { register(definition) { registeredTools.set(definition.name, definition); return () => registeredTools.delete(definition.name) } },
    webServer: { register(route) { registeredRoutes.push(route); return () => { const at = registeredRoutes.indexOf(route); if (at >= 0) registeredRoutes.splice(at, 1) } } },
    effect(factory, label) { const dispose = factory(); effects.push({ dispose, label }); return dispose },
  }
}

async function request(route, url, remoteAddress, method = 'GET') {
  let status
  let headers
  let body = ''
  await route.handler({ url, method, socket: { remoteAddress } }, { writeHead(code, value) { status = code; headers = value }, end(value = '') { body += value } })
  return { status, headers, body: JSON.parse(body) }
}

try {
  process.env.DSH_HOME = home
  const { apply, inject, name } = await import('../lib/index.js')
  check('host metadata is correct', name === 'dsh-shipcheck' && JSON.stringify(inject) === JSON.stringify(['webServer', 'tools']))
  apply(context())
  check('registers the three release-check tools', registeredTools.size === 3 && [...expectedTools].every(tool => registeredTools.has(tool)))
  check('tool definitions are DSH-compatible', [...registeredTools.values()].every(def => def.timeoutMs === 120000 && typeof def.execute === 'function' && typeof def.output?.render === 'function'))
  check('registers loopback prefix route', registeredRoutes.length === 1 && registeredRoutes[0].path === '/dsh-shipcheck')
  const history = await registeredTools.get('shipcheck_history').execute({ limit: 12 })
  check('history tool starts empty and is safe', Array.isArray(history) && history.length === 0)
  const state = await request(registeredRoutes[0], '/dsh-shipcheck/state', '127.0.0.1')
  check('state route returns local JSON', state.status === 200 && Array.isArray(state.body.history))
  const remote = await request(registeredRoutes[0], '/dsh-shipcheck/state', '203.0.113.10')
  check('route rejects remote callers', remote.status === 403 && remote.body.error === 'loopback only')
} finally {
  for (const effect of effects.reverse()) effect.dispose?.()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
}
check('registrations dispose cleanly', registeredTools.size === 0 && registeredRoutes.length === 0)
console.log('\nALL PASS')
