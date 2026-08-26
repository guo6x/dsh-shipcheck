import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const expectedTools = new Set(['shipcheck_run', 'shipcheck_matrix', 'shipcheck_flow', 'shipcheck_baseline', 'shipcheck_history'])
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
  const { apply, inject, name, ShipcheckRuntime } = await import('../lib/index.js')
  check('host metadata is correct', name === 'dsh-shipcheck' && JSON.stringify(inject) === JSON.stringify(['webServer', 'tools']))
  apply(context())
  check('registers the five release-check tools', registeredTools.size === 5 && [...expectedTools].every(tool => registeredTools.has(tool)))
  check('tool definitions are DSH-compatible', [...registeredTools.values()].every(def => def.timeoutMs === 120000 && typeof def.execute === 'function' && typeof def.output?.render === 'function'))
  check('matrix tool exposes bounded URL input', registeredTools.get('shipcheck_matrix').parameters.properties.urls.minItems === 1 && registeredTools.get('shipcheck_matrix').parameters.properties.urls.maxItems === 20)
  await assert.rejects(registeredTools.get('shipcheck_matrix').execute({ urls: [] }), /between 1 and 20/)
  check('matrix rejects an empty route list before browser startup', true)
  check('flow tool exposes bounded step input', registeredTools.get('shipcheck_flow').parameters.properties.steps.minItems === 1 && registeredTools.get('shipcheck_flow').parameters.properties.steps.maxItems === 30)
  await assert.rejects(registeredTools.get('shipcheck_flow').execute({ url: 'http://127.0.0.1:3000/', steps: [] }), /between 1 and 30/)
  check('flow rejects an empty step list before browser startup', true)
  check('registers loopback prefix route', registeredRoutes.length === 1 && registeredRoutes[0].path === '/dsh-shipcheck')
  const history = await registeredTools.get('shipcheck_history').execute({ limit: 12 })
  check('history tool starts empty and is safe', Array.isArray(history) && history.length === 0)
  const runtime = new ShipcheckRuntime()
  await assert.rejects(runtime.run({ url: 'http://127.0.0.1:1/' }), /dsh-pilot is required/)
  await runtime.dispose()
  check('missing browser companion fails with install guidance', true)
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
