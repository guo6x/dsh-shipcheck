import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const MAX_HISTORY = 100

export class ShipcheckStore {
  constructor(dir) {
    this.dir = dir
    this.baselinesDir = join(dir, 'baselines')
    this.reportsDir = join(dir, 'reports')
  }

  async init() {
    await mkdir(this.baselinesDir, { recursive: true })
    await mkdir(this.reportsDir, { recursive: true })
  }

  slug(value) {
    const slug = String(value ?? 'default').normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
    return slug || 'default'
  }

  baselineFile(name) {
    // The readable slug is not an identity: punctuation, Unicode, case and
    // truncation can all make distinct reviewed pages share the same slug.
    const key = String(name ?? 'default')
    // JSON preserves lone UTF-16 surrogates instead of replacing them during
    // UTF-8 encoding. A dot keeps new names outside the legacy slug namespace.
    const hash = createHash('sha256').update(JSON.stringify(key)).digest('hex')
    return join(this.baselinesDir, `${this.slug(key).slice(0, 48)}.${hash}.json`)
  }

  async saveBaseline(name, evidence) {
    await this.init()
    const baseline = { name: String(name ?? 'default'), saved_at: new Date().toISOString(), evidence }
    await writeFile(this.baselineFile(baseline.name), JSON.stringify(baseline, null, 2) + '\n', 'utf8')
    return baseline
  }

  async getBaseline(name) {
    if (!name) return null
    const key = String(name)
    let content
    try {
      content = await readFile(this.baselineFile(key), 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') return null
      // Read old baselines without changing or deleting them. The embedded
      // name must match exactly so an old slug collision cannot be reused.
      try { content = await readFile(join(this.baselinesDir, `${this.slug(key)}.json`), 'utf8') } catch { return null }
    }
    try {
      const baseline = JSON.parse(content)
      return baseline?.name === key ? baseline : null
    } catch { return null }
  }

  async saveReport(report) {
    await this.init()
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const saved = { id, ...report }
    await writeFile(join(this.reportsDir, `${id}.json`), JSON.stringify(saved, null, 2) + '\n', 'utf8')
    const names = (await readdir(this.reportsDir)).filter(name => name.endsWith('.json')).sort().reverse()
    for (const stale of names.slice(MAX_HISTORY)) {
      try { await (await import('node:fs/promises')).rm(join(this.reportsDir, stale), { force: true }) } catch {}
    }
    return saved
  }

  async history(limit = 12) {
    await this.init()
    const names = (await readdir(this.reportsDir)).filter(name => name.endsWith('.json')).sort().reverse().slice(0, Math.max(1, Math.min(50, Number(limit) || 12)))
    const reports = []
    for (const name of names) {
      try { reports.push(JSON.parse(await readFile(join(this.reportsDir, name), 'utf8'))) } catch {}
    }
    return reports
  }
}
