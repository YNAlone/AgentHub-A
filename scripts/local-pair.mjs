import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'

const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve('.agenthub-data')
const file = path.join(dataDir, 'local-auth.json')
try {
  if (process.argv.includes('--rotate')) {
    // Rotation replaces the signing key as well as the pairing code, revoking existing sessions.
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ key: randomBytes(32).toString('hex'), pairingCode: randomBytes(24).toString('hex') }), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  }
  const credentials = JSON.parse(readFileSync(file, 'utf8'))
  console.info(`本机浏览器配对码：${credentials.pairingCode}`)
} catch {
  console.error('请先启动 AgentHub，并确认 AGENTHUB_DATA_DIR 指向当前应用的数据目录。')
  process.exitCode = 1
}
