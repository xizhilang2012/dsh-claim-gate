/**
 * 尝试账本：记住“同一件事试过几次”。
 *
 * 没有账本，闸门就只是个可以无限重试的提示框——试到过为止，
 * 那就变成了在猜判据，而不是在核实事实。
 *
 * 存储是一行一条 JSON 的追加文件，坏了也不影响闸门放行（fail-soft）。
 *
 * @module claim-gate/lib/ledger
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const MAX_BYTES = 256 * 1024
const KEEP_ENTRIES = 400

/** profile 私有状态目录（与 goal-autostart 同一套解析顺序）。 */
export function stateRoot() {
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile === 'string' && profile !== '') return profile
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') return home
  return join(homedir(), '.dsh')
}

/** 默认账本路径。 */
export function defaultLedgerPath() {
  return join(stateRoot(), 'state', 'claim-gate', 'attempts.jsonl')
}

/** 内容指纹：同一段草稿反复提交时能认出来。 */
export function fingerprint(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16)
}

/**
 * 读取账本，返回窗口内、同一 key 的记录。
 *
 * @param {{path?: string, key?: string, windowMinutes?: number, now?: number}} [options]
 */
export function readAttempts(options = {}) {
  const path = options.path ?? defaultLedgerPath()
  const key = options.key ?? 'default'
  const windowMs = (options.windowMinutes ?? 15) * 60_000
  const now = options.now ?? Date.now()

  if (!existsSync(path)) return []

  const entries = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const entry = JSON.parse(trimmed)
      if (entry?.key !== key) continue
      const at = Number(entry.at)
      if (!Number.isFinite(at) || now - at > windowMs) continue
      entries.push(entry)
    } catch {
      // 坏行直接跳过：账本不该因为一行写坏就锁死人。
    }
  }
  return entries
}

/**
 * 追加一次尝试。
 *
 * @param {{key: string, verdict: string, score: number, level: string, text: string, evidenceCount: number, ack?: string}} entry
 * @param {string} [path]
 */
export function recordAttempt(entry, path = defaultLedgerPath()) {
  const record = {
    at: Date.now(),
    key: entry.key ?? 'default',
    verdict: entry.verdict,
    score: entry.score,
    level: entry.level,
    fp: fingerprint(entry.text),
    evidenceCount: entry.evidenceCount ?? 0,
    ...(entry.ack === undefined || entry.ack === '' ? {} : { ack: String(entry.ack).slice(0, 200) }),
  }

  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
    compact(path)
  } catch {
    // 写不进账本不该阻止任何决定：最坏情况是失去次数记忆。
  }
  return record
}

/** 账本太大时只留最近的若干条，避免无限增长。 */
function compact(path) {
  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.length <= MAX_BYTES) return
    const lines = raw.split('\n').filter((line) => line.trim() !== '')
    writeFileSync(path, `${lines.slice(-KEEP_ENTRIES).join('\n')}\n`, 'utf8')
  } catch {
    // 忽略：下一次追加会再试。
  }
}
