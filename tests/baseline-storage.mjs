import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { ShipcheckStore } from '../src/store.js'
import { ShipcheckRuntime } from '../lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-shipcheck-baselines-'))
const previousHome = process.env.DSH_HOME
const check = (label, condition) => {
  assert.ok(condition, label)
  console.log(`PASS  ${label}`)
}

async function exerciseStore(store, label) {
  await store.init()
  const pairs = [
    ['登录页', '结算页'],
    ['checkout/login', 'checkout-login'],
    ['Checkout', 'checkout'],
    ['ＡＢＣ', 'ABC'],
    ['\ud800', '\ud801'],
    [`${'release'.repeat(15)}/01-login`, `${'release'.repeat(15)}/02-checkout`],
  ]
  for (const [first, second] of pairs) {
    await store.saveBaseline(first, { title: 'First page' })
    await store.saveBaseline(second, { title: 'Second page' })
    assert.equal((await store.getBaseline(first))?.evidence.title, 'First page')
    assert.equal((await store.getBaseline(second))?.evidence.title, 'Second page')
  }
  check(`${label}: Unicode, lone surrogates, punctuation, case, normalization and long names stay independent`, true)
  check(`${label}: every distinct name has a separate file`, (await readdir(store.baselinesDir)).length === pairs.length * 2)

  await store.saveBaseline(pairs[0][0], { title: 'Reviewed update' })
  check(`${label}: explicit recapture updates only the requested baseline`,
    (await store.getBaseline(pairs[0][0]))?.evidence.title === 'Reviewed update' &&
    (await store.getBaseline(pairs[0][1]))?.evidence.title === 'Second page')

  const unsafeName = '../outside/../../baseline'
  await store.saveBaseline(unsafeName, { title: 'Contained' })
  const path = store.baselineFile(unsafeName)
  check(`${label}: path-like names remain inside the baseline directory`, relative(store.baselinesDir, path) === basename(path))
  assert.equal((await store.getBaseline(unsafeName))?.evidence.title, 'Contained')

  // A digest-looking old baseline must not share the new storage namespace.
  const shortName = 'a'
  const digestLikeName = basename(store.baselineFile(shortName), '.json')
  const digestLikeFile = join(store.baselinesDir, `${store.slug(digestLikeName)}.json`)
  const digestLikeBytes = JSON.stringify({ name: digestLikeName, evidence: { title: 'Old named page' } })
  await writeFile(digestLikeFile, digestLikeBytes, 'utf8')
  await store.saveBaseline(shortName, { title: 'New short name' })
  assert.equal(await readFile(digestLikeFile, 'utf8'), digestLikeBytes)
  assert.equal((await store.getBaseline(digestLikeName))?.evidence.title, 'Old named page')
  check(`${label}: new captures cannot overwrite digest-looking legacy filenames`, true)

  const legacyName = 'legacy/login'
  const legacyFile = join(store.baselinesDir, `${store.slug(legacyName)}.json`)
  const legacyBytes = JSON.stringify({ name: legacyName, evidence: { title: 'Legacy page' } })
  await writeFile(legacyFile, legacyBytes, 'utf8')
  const filesBefore = await readdir(store.baselinesDir)
  check(`${label}: a matching legacy baseline is still readable`, (await store.getBaseline(legacyName))?.evidence.title === 'Legacy page')
  check(`${label}: legacy slug collisions are not accepted as another page`, await store.getBaseline('legacy-login') === null)
  assert.deepEqual(await readdir(store.baselinesDir), filesBefore)
  assert.equal(await readFile(legacyFile, 'utf8'), legacyBytes)
  check(`${label}: legacy reads never rewrite or migrate reviewed evidence`, true)

  await store.saveBaseline(legacyName, { title: 'New review' })
  check(`${label}: an explicit new capture takes precedence over the legacy file`, (await store.getBaseline(legacyName))?.evidence.title === 'New review')
  assert.equal(await readFile(legacyFile, 'utf8'), legacyBytes)
  await writeFile(store.baselineFile(legacyName), '{invalid JSON', 'utf8')
  check(`${label}: a damaged new baseline does not silently restore stale evidence`, await store.getBaseline(legacyName) === null)
  await writeFile(store.baselineFile(legacyName), JSON.stringify({ name: 'wrong page', evidence: {} }), 'utf8')
  check(`${label}: a mismatched embedded name is rejected`, await store.getBaseline(legacyName) === null)
  check(`${label}: a missing baseline remains missing`, await store.getBaseline('never-reviewed') === null)
}

try {
  await exerciseStore(new ShipcheckStore(join(root, 'source')), 'source')
  process.env.DSH_HOME = join(root, 'bundle')
  const runtime = new ShipcheckRuntime()
  await exerciseStore(runtime.store, 'published bundle')
  await runtime.dispose()
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true })
}

console.log('\nALL PASS')
