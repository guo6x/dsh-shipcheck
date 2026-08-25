import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

  async saveBaseline(name, evidence) {
    await this.init()
    const baseline = { name, saved_at: new Date().toISOString(), evidence }
    await writeFile(join(this.baselinesDir, `${this.slug(name)}.json`), JSON.stringify(baseline, null, 2) + '\n', 'utf8')
    return baseline
  }

  async getBaseline(name) {
    if (!name) return null
    try { return JSON.parse(await readFile(join(this.baselinesDir, `${this.slug(name)}.json`), 'utf8')) } catch { return null }
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
