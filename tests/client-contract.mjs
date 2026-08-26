import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/client/index.jsx', import.meta.url), 'utf8')
const built = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const check = (label, condition) => { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) process.exitCode = 1 }
check('client: exports web injection', source.includes("export const inject = ['slots']"))
check('client: registers sidebar and overlay', source.includes('sidebar.footer.action') && source.includes('shell.overlay'))
check('client: calls evidence routes', source.includes('/dsh-shipcheck/state') && source.includes("post('run'") && source.includes("post('matrix'") && source.includes("post('flow'"))
check('client: default dock avoids pilot overlap', source.includes("right: '1rem'") && !source.includes("left: '21rem'"))
check('client: build has module loader boundary', built.includes("id: 'dsh-shipcheck'"))
if (process.exitCode) process.exit(1)
console.log('ALL PASS')
