#!/usr/bin/env node
/**
 * claim-gate —— 公开发言前的自证闸门（命令行）。
 *
 * 它不只是“拦”：拦截时会给出**为什么错、可以怎么改**，并要求第二次提交带一句回执。
 * 同一件事试满次数就停下，交回给人——继续试只会变成在猜判据。
 *
 * 用法：
 *   claim-gate check   --text "……" -e "https://…|<原文>" [--level reported]
 *   claim-gate explain --text "……"                    只看诊断，不记账
 *   claim-gate fix     --text "……"
 *   claim-gate guard   [闸门参数] -- node tools/bili.mjs comment --message "……"
 *
 * 退出码：0 通过；2 拦截/需人工；3 用法错误。
 *
 * @module claim-gate/bin
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { check, fix, summarize } from '../lib/gate.mjs'
import { renderBrief, validateAck } from '../lib/coach.mjs'
import { defaultLedgerPath, readAttempts, recordAttempt } from '../lib/ledger.mjs'

const EXIT_PASS = 0
const EXIT_BLOCK = 2
const EXIT_USAGE = 3

const HELP = `claim-gate —— 发出去之前，先自证

用法：
  claim-gate check   --text <正文> [-e "<url>|<引文>"]... [选项]
  claim-gate explain --text <正文> [-e ...] [选项]
  claim-gate fix     --text <正文>
  claim-gate guard   [选项] -- <命令> [参数...]

选项：
  -e, --evidence <url|引文>   证据；可重复。引文至少要 8 字
      --level <级别>          verified | first-party | reported | unverified（默认 unverified）
      --kind <类型>           claim | opinion（默认自动判断）
      --ack <一句话>          回执：上一版错在哪、这次改了什么（第二次提交必填）
      --key <标识>            尝试记账用的话题键（默认从 --oid/--bvid 推断）
      --max-attempts <n>      同一话题最多试几次（默认 3）
      --window-minutes <n>    记账窗口（默认 15 分钟）
      --ledger <文件>         覆盖账本路径
      --min-score <0-100>     及格线（默认 70；观点 60）
      --strict                任何警告都不放行
      --disclose              要求正文能看出是 AI 在说
      --policy <文件.json>    读取策略文件
      --json                  机器可读输出
  -h, --help                  显示帮助

例子：
  claim-gate guard -e "https://…|…" --level reported -- \\
    node tools/bili.mjs comment --oid 1 --message "……" --go
`

/** 取参数值：支持 `--x v` 与 `--x=v`。 */
function take(argv, index) {
  const arg = argv[index]
  const eq = arg.indexOf('=')
  if (eq > 0) return { value: arg.slice(eq + 1), next: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) return { value: '', next: index }
  return { value, next: index + 1 }
}

/** 解析闸门参数。 */
function parseOptions(argv) {
  const options = {
    text: '',
    evidence: [],
    level: undefined,
    kind: undefined,
    ack: '',
    key: '',
    maxAttempts: 3,
    windowMinutes: 15,
    ledger: '',
    minScore: undefined,
    json: false,
    strict: false,
    disclose: false,
    policyFile: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--text' || arg.startsWith('--text=')) {
      const taken = take(argv, i)
      options.text = taken.value
      i = taken.next
    } else if (arg === '-e' || arg === '--evidence' || arg.startsWith('--evidence=')) {
      const taken = take(argv, i)
      if (taken.value !== '') options.evidence.push(taken.value)
      i = taken.next
    } else if (arg === '--level' || arg.startsWith('--level=')) {
      const taken = take(argv, i)
      options.level = taken.value
      i = taken.next
    } else if (arg === '--kind' || arg.startsWith('--kind=')) {
      const taken = take(argv, i)
      options.kind = taken.value
      i = taken.next
    } else if (arg === '--ack' || arg.startsWith('--ack=')) {
      const taken = take(argv, i)
      options.ack = taken.value
      i = taken.next
    } else if (arg === '--key' || arg.startsWith('--key=')) {
      const taken = take(argv, i)
      options.key = taken.value
      i = taken.next
    } else if (arg === '--max-attempts' || arg.startsWith('--max-attempts=')) {
      const taken = take(argv, i)
      const value = Number(taken.value)
      if (Number.isInteger(value) && value > 0) options.maxAttempts = value
      i = taken.next
    } else if (arg === '--window-minutes' || arg.startsWith('--window-minutes=')) {
      const taken = take(argv, i)
      const value = Number(taken.value)
      if (Number.isFinite(value) && value > 0) options.windowMinutes = value
      i = taken.next
    } else if (arg === '--ledger' || arg.startsWith('--ledger=')) {
      const taken = take(argv, i)
      options.ledger = taken.value
      i = taken.next
    } else if (arg === '--min-score' || arg.startsWith('--min-score=')) {
      const taken = take(argv, i)
      const value = Number(taken.value)
      if (Number.isFinite(value)) options.minScore = value
      i = taken.next
    } else if (arg === '--policy' || arg.startsWith('--policy=')) {
      const taken = take(argv, i)
      options.policyFile = taken.value
      i = taken.next
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--strict') {
      options.strict = true
    } else if (arg === '--disclose') {
      options.disclose = true
    }
  }

  return options
}

/** 组装策略：文件 → 命令行覆盖。 */
function buildPolicy(options) {
  const policy = {}
  const file = options.policyFile || process.env.CLAIM_GATE_POLICY || ''
  if (file !== '') {
    try {
      Object.assign(policy, JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      fail(`读不懂策略文件 ${file}：${error.message}`)
    }
  }
  if (options.strict) policy.blockOnWarn = true
  if (options.disclose) policy.requireDisclosure = true
  if (options.minScore !== undefined) {
    policy.minScore = options.minScore
    policy.opinionMinScore = Math.min(policy.opinionMinScore ?? 60, options.minScore)
  }
  return policy
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(EXIT_USAGE)
}

/** 已失败的尝试数 → 这是第几次。 */
function attemptOf(options, key) {
  const path = options.ledger || defaultLedgerPath()
  const history = readAttempts({ path, key, windowMinutes: options.windowMinutes })
  const failures = history.filter((entry) => entry.verdict !== 'pass')
  return { attempt: failures.length + 1, failures, path }
}

/** 从命令参数里推断记账键：同一条视频/同一个动态算同一件事。 */
function deriveKey(options, command) {
  if (options.key !== '') return options.key
  if (command === undefined) return 'default'
  const valueOf = (flag) => {
    const index = command.indexOf(flag)
    return index >= 0 ? command[index + 1] : undefined
  }
  const bvid = valueOf('--bvid')
  if (typeof bvid === 'string' && bvid !== '') return `bvid:${bvid}`
  const oid = valueOf('--oid')
  if (typeof oid === 'string' && oid !== '') return `oid:${oid}`
  return 'default'
}

function runCheck(argv) {
  const options = parseOptions(argv)
  if (options.text.trim() === '') fail('缺少 --text（要检查的正文）')
  const result = check(
    { text: options.text, evidence: options.evidence, level: options.level, kind: options.kind },
    buildPolicy(options),
  )
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.verdict === 'pass') {
    process.stdout.write(`[claim-gate] ${summarize(result)}\n`)
  } else {
    process.stdout.write(`${renderBrief(result, { attempt: 1, maxAttempts: options.maxAttempts })}\n`)
  }
  process.exit(result.verdict === 'pass' ? EXIT_PASS : EXIT_BLOCK)
}

/** 只看诊断：读账本但不记账，适合人排查。 */
function runExplain(argv) {
  const options = parseOptions(argv)
  if (options.text.trim() === '') fail('缺少 --text（要诊断的正文）')
  const key = deriveKey(options, undefined)
  const { attempt } = attemptOf(options, key)
  const result = check(
    { text: options.text, evidence: options.evidence, level: options.level, kind: options.kind },
    buildPolicy(options),
  )
  process.stdout.write(
    `${renderBrief(result, { attempt, maxAttempts: options.maxAttempts, ackRequired: attempt > 1 })}\n`,
  )
  process.exit(result.verdict === 'pass' ? EXIT_PASS : EXIT_BLOCK)
}

function runFix(argv) {
  const options = parseOptions(argv)
  if (options.text.trim() === '') fail('缺少 --text（要改写正文）')
  const result = fix(options.text, buildPolicy(options))
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`${result.text}\n`)
    if (result.changes.length > 0) {
      const list = result.changes.map((change) => `${change.from || '（补披露）'}→${change.to}`).join('，')
      process.stderr.write(`已改写 ${result.changes.length} 处：${list}\n`)
    } else {
      process.stderr.write('没有需要改写的地方\n')
    }
  }
  process.exit(EXIT_PASS)
}

/**
 * guard：过闸才执行后面的命令。
 *
 * 顺序是刻意的——先算次数、再校验回执、最后才看内容。
 * 这样“重试”本身也有成本，不会退化成反复试探阈值。
 */
function runGuard(argv) {
  const split = argv.indexOf('--')
  if (split < 0) fail('guard 需要 `--` 分隔：claim-gate guard [选项] -- <命令>')
  const gateArgv = argv.slice(0, split)
  const command = argv.slice(split + 1)
  if (command.length === 0) fail('`--` 后面没有命令')

  const options = parseOptions(gateArgv)
  const policy = buildPolicy(options)
  const message = messageOf(command)

  if (message === undefined) {
    process.stderr.write('[claim-gate] 这条命令没有 --message，不像是公开发言 → 直接放行\n')
    process.exit(spawnCommand(command))
  }

  const key = deriveKey(options, command)
  const { attempt, path } = attemptOf(options, key)
  const result = check(
    { text: message, evidence: options.evidence, level: options.level, kind: options.kind },
    policy,
  )

  let verdict = result.verdict
  let ackRequired = attempt > 1

  // ① 次数用尽：不再判内容，直接交回给人。
  if (attempt > options.maxAttempts) {
    result.issues.push({
      id: 'attempt.exhausted',
      level: 'block',
      message: `同一话题已失败 ${attempt - 1} 次，超过上限 ${options.maxAttempts}`,
    })
    result.verdict = 'escalate'
    verdict = 'escalate'
  }

  // ② 第二次起必须带回执：改了字不等于知道错在哪。
  if (result.verdict !== 'escalate' && ackRequired) {
    const ack = validateAck(options.ack, result)
    if (ack.ok !== true) {
      result.issues.push({ id: ack.id, level: 'block', message: ack.message })
      result.verdict = 'block'
      verdict = 'block'
    } else if (result.verdict === 'pass') {
      // 能过闸、且交代清楚了，才算这次真的改对。
      verdict = 'pass'
    }
  }

  if (!options.json) {
    if (result.verdict === 'pass') {
      process.stderr.write(`[claim-gate] 通过（自证分 ${result.score}）→ 执行\n`)
    } else {
      process.stderr.write(
        `${renderBrief(result, { attempt, maxAttempts: options.maxAttempts, ackRequired })}\n`,
      )
      if (result.verdict === 'escalate') {
        process.stderr.write('[claim-gate] 停在这里，交给人。后面的命令未执行。\n')
      } else {
        process.stderr.write('[claim-gate] 未执行后面的命令（fail-closed）\n')
      }
    }
  } else {
    process.stdout.write(
      `${JSON.stringify(
        {
          verdict: result.verdict,
          score: result.score,
          attempt,
          maxAttempts: options.maxAttempts,
          ackRequired,
          issues: result.issues,
        },
        null,
        2,
      )}\n`,
    )
  }

  if (path !== undefined) {
    recordAttempt(
      {
        key,
        verdict,
        score: result.score,
        level: result.level,
        text: message,
        evidenceCount: options.evidence.length,
        ack: options.ack,
      },
      path,
    )
  }

  if (result.verdict !== 'pass') process.exit(EXIT_BLOCK)
  process.exit(spawnCommand(command))
}

/** 从命令参数里取出要发出去的正文。 */
function messageOf(command) {
  for (let i = 0; i < command.length; i += 1) {
    const arg = command[i]
    if (arg === '--message' || arg === '-m') {
      const value = command[i + 1]
      if (typeof value === 'string' && value !== '') return value
      return ''
    }
    if (arg.startsWith('--message=')) return arg.slice('--message='.length)
  }
  return undefined
}

function spawnCommand(command) {
  const [file, ...args] = command
  const result = spawnSync(file, args, { stdio: 'inherit', env: process.env })
  if (result.error !== undefined) {
    process.stderr.write(`[claim-gate] 无法执行 ${file}：${result.error.message}\n`)
    return 127
  }
  return result.status ?? 0
}

const argv = process.argv.slice(2)
const command = argv[0]

if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
  process.stdout.write(HELP)
  process.exit(command === undefined ? EXIT_USAGE : EXIT_PASS)
} else if (command === 'check') {
  runCheck(argv.slice(1))
} else if (command === 'explain') {
  runExplain(argv.slice(1))
} else if (command === 'fix') {
  runFix(argv.slice(1))
} else if (command === 'guard') {
  runGuard(argv.slice(1))
} else {
  fail(`不认识子命令 ${command}\n\n${HELP}`)
}
