/**
 * 闸门的行为测试：正例必须过，反例必须拦。
 *
 * 这些用例的作用不是“覆盖率”，是把闸门的判断标准钉死——
 * 以后调阈值时，先看这些用例还认不认。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { check, fix, summarize } from '../lib/gate.mjs'
import { renderBrief, validateAck } from '../lib/coach.mjs'
import { classify, findNumbers, overlapRatio, splitTokens } from '../lib/text.mjs'

const HERE = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(HERE, 'bin', 'claim-gate.mjs')

/**
 * 跑一次 CLI。
 *
 * 子进程的 stdout 走文件描述符而不是管道：DSH 的沙箱不允许子进程打开命名管道，
 * `stdio: 'pipe'` 会直接 EPERM。写文件既绕开这一点，也保留了输出。
 */
function runCli(args) {
  const dir = mkdtempSync(join(tmpdir(), 'claim-gate-cli-'))
  const out = join(dir, 'stdout.txt')
  const err = join(dir, 'stderr.txt')
  const outFd = openSync(out, 'w')
  const errFd = openSync(err, 'w')
  try {
    const result = spawnSync(process.execPath, [CLI, ...args], { stdio: ['ignore', outFd, errFd] })
    return {
      status: result.status,
      stdout: readFileSync(out, 'utf8'),
      stderr: readFileSync(err, 'utf8'),
    }
  } finally {
    closeSync(outFd)
    closeSync(errFd)
    rmSync(dir, { recursive: true, force: true })
  }
}

const GROUNDED = {
  text: '据当地媒体报道，该厂 9 月已确认裁员 300 人，可能涉及三个部门。',
  evidence: ['https://news.example.com/a|该厂 9 月确认裁员 300 人，涉及三个部门'],
  level: 'reported',
}

test('一条有出处、有保留的断言可以通过', () => {
  const result = check(GROUNDED)
  assert.equal(result.verdict, 'pass', JSON.stringify(result.issues, null, 2))
  assert.equal(result.kind, 'claim')
  assert.equal(result.level, 'reported')
  assert.ok(result.score >= 70, `score=${result.score}`)
})

test('断言没有任何出处 → 拦', () => {
  const result = check({ text: '这家公司下个月要裁掉一半的人，内部都定了。', evidence: [] })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'evidence.missing'))
})

test('链接不是 http(s) → 拦', () => {
  const result = check({
    text: '该厂 9 月已确认裁员 300 人。',
    evidence: ['见附件|该厂 9 月确认裁员 300 人，涉及三个部门'],
    level: 'reported',
  })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'evidence.url'))
})

test('引文太短等于没引 → 拦', () => {
  const result = check({
    text: '该厂已裁员三百人。',
    evidence: ['https://news.example.com/a|裁员'],
    level: 'reported',
  })
  assert.ok(result.issues.some((issue) => issue.id === 'evidence.quote-short'))
})

test('贴了链接但引文与正文无关 → 拦（防装饰性引用）', () => {
  const result = check({
    text: '某地 9 月发生大规模停电，影响 12 万户。',
    evidence: ['https://example.com/x|今天天气很好，适合去公园散步，顺便买点水果'],
    level: 'reported',
  })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'evidence.unanchored'))
})

test('二手来源却用绝对化措辞 → 拦', () => {
  const result = check({
    text: '据传该厂一定会裁员 300 人，所有人都要走。',
    evidence: ['https://news.example.com/a|该厂 9 月确认裁员 300 人，涉及三个部门'],
    level: 'reported',
  })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'claim.absolute'))
})

test('数字在引文里落不了地 → 拦', () => {
  const result = check({
    text: '该厂裁员 300 人，占全厂 40%。',
    evidence: ['https://news.example.com/a|该厂近日进行了人员调整，具体人数未披露'],
    level: 'reported',
  })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'claim.number-unverified'))
})

test('数字用“约”软化后可以放行', () => {
  const result = check({
    text: '据当地媒体报道，该厂 9 月裁员约 300 人。',
    evidence: ['https://news.example.com/a|该厂 9 月确认裁员 300 人，涉及三个部门'],
    level: 'reported',
  })
  assert.equal(result.verdict, 'pass', JSON.stringify(result.issues, null, 2))
})

test('标 verified 但只有单一来源 → 降级为 reported，并要求保留语气', () => {
  const result = check({ ...GROUNDED, level: 'verified' })
  assert.equal(result.level, 'reported')
  assert.ok(result.issues.some((issue) => issue.id === 'evidence.single-source'))
})

test('二手来源、没有保留语气 → 拦', () => {
  const result = check({
    text: '该厂 9 月已确认裁员 300 人。',
    evidence: ['https://news.example.com/a|该厂 9 月确认裁员 300 人，涉及三个部门'],
    level: 'reported',
  })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'claim.missing-hedge'))
})

test('观点不需要证据（"这个镜头真好看"）', () => {
  const result = check({ text: '这个镜头真好看，收尾那下绝了。' })
  assert.equal(result.kind, 'opinion')
  assert.equal(result.verdict, 'pass', JSON.stringify(result.issues, null, 2))
})

test('自我背书代替证据 → 拦', () => {
  const result = check({ text: '我查过了，这事就是他们干的。', evidence: [] })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'claim.self-endorsement'))
})

test('开启披露要求后，缺标记会扣分并给出警告', () => {
  const result = check({
    ...GROUNDED,
    text: '据当地媒体报道，该厂 9 月已确认裁员 300 人。',
  }, { requireDisclosure: true })
  assert.ok(result.issues.some((issue) => issue.id === 'disclosure.missing'))
  assert.ok(result.score < 100)
})

test('“据<媒体>报道”算转述语气（固定词表会漏）', () => {
  const result = check({
    text: '据新京报报道，该厂 9 月裁员 300 人，占全厂 40%。',
    evidence: ['https://news.example.com/a|该厂 9 月确认裁员 300 人，占全厂员工 40%'],
    level: 'reported',
  })
  assert.equal(result.verdict, 'pass', JSON.stringify(result.issues, null, 2))
  assert.ok(result.stats.hedges.length > 0)
})

test('一手数据：单一内部来源即可，允许绝对判断', () => {
  const result = check({
    text: '本周接口失败率从 0.8% 降到 0.2%，重试策略改完所有接口都回落了。',
    evidence: ['https://internal.example.com/board|接口失败率 0.8% → 0.2%，改动来自重试策略'],
    level: 'first-party',
  })
  assert.equal(result.level, 'first-party')
  assert.equal(result.verdict, 'pass', JSON.stringify(result.issues, null, 2))
})

test('一手数据也不能没有出处', () => {
  const result = check({ text: '本周接口失败率降到 0.2%。', evidence: [], level: 'first-party' })
  assert.equal(result.verdict, 'block')
  assert.ok(result.issues.some((issue) => issue.id === 'evidence.missing'))
})

test('fix 会软化绝对词、补上披露，并逐条回执', () => {
  const result = fix('这一定是所有人的问题，绝对没错。', { requireDisclosure: true })
  assert.ok(!result.text.includes('一定'))
  assert.ok(!result.text.includes('绝对'))
  assert.ok(result.text.startsWith('（AI）'))
  assert.ok(result.changes.length >= 3)
})

test('文本工具：重叠度、数字、分类', () => {
  assert.ok(overlapRatio('裁员 300 人', '该厂确认裁员 300 人') > 0.5)
  assert.equal(overlapRatio('裁员', '今天天气很好'), 0)
  assert.deepEqual(
    findNumbers('9 月裁员 300 人，占 40%').map((item) => item.raw),
    ['9 月', '300 人', '40%'],
  )
  assert.equal(classify('这个镜头真好看'), 'opinion')
  assert.equal(classify('已有 12 万人受影响'), 'claim')
  assert.ok(splitTokens('裁员 300 人').includes('裁员'))
})

test('summarize 给出可读的一行', () => {
  assert.match(summarize(check(GROUNDED)), /^通过/)
  assert.match(summarize(check({ text: '一定是这样', evidence: [] })), /^拦截/)
})

test('CLI check：不通过时退出码 2', () => {
  const run = runCli(['check', '--text', '这家公司一定会倒'])
  assert.equal(run.status, 2, run.stderr)
  assert.match(run.stdout + run.stderr, /拦截|claim\.absolute/)
})

test('CLI check：通过时退出码 0，--json 可解析', () => {
  const run = runCli([
    'check', '--json', '--text', GROUNDED.text, '-e', GROUNDED.evidence[0], '--level', 'reported',
  ])
  assert.equal(run.status, 0, run.stderr)
  const parsed = JSON.parse(run.stdout)
  assert.equal(parsed.verdict, 'pass')
})

test('CLI guard：不通过时后面的命令根本不会执行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claim-gate-'))
  const marker = join(dir, 'ran.txt')
  const script = join(dir, 'post.mjs')
  try {
    writeFileSync(script, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'x')\n`)
    const run = runCli(['guard', '--', process.execPath, script, '--message', '这家公司一定会倒'])
    assert.equal(run.status, 2, run.stderr)
    assert.equal(existsSync(marker), false, '被拦下的命令不应该执行')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI guard：通过时把命令原样放行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claim-gate-'))
  const marker = join(dir, 'ran.txt')
  const script = join(dir, 'post.mjs')
  try {
    writeFileSync(script, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'x')\n`)
    const run = runCli([
      'guard', '-e', GROUNDED.evidence[0], '--level', 'reported', '--',
      process.execPath, script, '--message', GROUNDED.text,
    ])
    assert.equal(run.status, 0, run.stderr)
    assert.equal(existsSync(marker), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('插件入口挂上预检接口，并能返回同样的判定', async () => {  const routes = new Map()
  const ctx = {
    logger: { info() {} },
    webServer: {
      register: (route) => {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
    effect: (fn) => fn(),
  }
  const { apply } = await import('../index.js')
  apply(ctx, { minScore: 70 })

  assert.ok(routes.has('/dsh-claim-gate/check'), '缺少 /dsh-claim-gate/check')
  assert.ok(routes.has('/dsh-claim-gate/policy'), '缺少 /dsh-claim-gate/policy')

  const request = Readable.from([Buffer.from(JSON.stringify({ text: '这家公司一定会倒' }))])
  request.method = 'POST'
  const response = {
    statusCode: 0,
    body: '',
    writeHead(code) { this.statusCode = code },
    end(text) { this.body = text },
  }
  await routes.get('/dsh-claim-gate/check')(request, response)
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(response.body).verdict, 'block')
})

// ---------------------------------------------------------------------------
// 纠错回路：不只是拦，还要让它在“错在哪”上花力气
// ---------------------------------------------------------------------------

test('拦截时给出的是解释和可选改法，不是错误码清单', () => {
  const result = check({ text: '这家公司一定会倒', evidence: [] })
  const text = renderBrief(result, { attempt: 1, maxAttempts: 3 })
  assert.match(text, /为什么会拦/)
  assert.match(text, /读者/)
  assert.match(text, /可以怎么改/)
  assert.match(text, /还有 2 次机会/)
})

test('回执校验：空的、笼统的、具体的', () => {
  const result = check({ text: '这家公司一定会倒', evidence: [] })
  assert.equal(validateAck('', result).id, 'ack.missing')
  assert.equal(validateAck('我错了', result).id, 'ack.vague')
  assert.equal(validateAck('我漏了出处，把“据传”写成了“一定”', result).ok, true)
})

test('第二次提交：改对了但没交代 → 仍然拦', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claim-gate-'))
  const ledger = join(dir, 'attempts.jsonl')
  const marker = join(dir, 'ran.txt')
  const script = join(dir, 'post.mjs')
  try {
    writeFileSync(script, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'x')\n`)

    // 第一次：没出处 → 拦，并记账
    const first = runCli(['guard', '--ledger', ledger, '--', process.execPath, script, '--message', '这家公司一定会倒'])
    assert.equal(first.status, 2, first.stderr)
    assert.match(first.stderr, /为什么会拦/)
    assert.equal(existsSync(marker), false)

    // 第二次：内容改对了，但没有 --ack → 还是不放行
    const second = runCli([
      'guard', '--ledger', ledger, '--',
      process.execPath, script, '--message', GROUNDED.text,
    ])
    assert.equal(second.status, 2, second.stderr)
    assert.match(second.stderr, /ack\.missing/)
    assert.equal(existsSync(marker), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('第二次提交：改对了并说清了 → 放行，命令真的执行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claim-gate-'))
  const ledger = join(dir, 'attempts.jsonl')
  const marker = join(dir, 'ran.txt')
  const script = join(dir, 'post.mjs')
  try {
    writeFileSync(script, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'x')\n`)

    runCli(['guard', '--ledger', ledger, '--', process.execPath, script, '--message', '这家公司一定会倒'])

    const second = runCli([
      'guard', '--ledger', ledger, '-e', GROUNDED.evidence[0], '--level', 'reported',
      '--ack', '我漏了出处：原话是“据当地媒体报道”，我写成了“一定会倒”',
      '--', process.execPath, script, '--message', GROUNDED.text,
    ])
    assert.equal(second.status, 0, second.stderr)
    assert.equal(existsSync(marker), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('试满次数后停下交给人，不再判内容', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claim-gate-'))
  const ledger = join(dir, 'attempts.jsonl')
  const script = join(dir, 'post.mjs')
  try {
    writeFileSync(script, 'process.exit(0)\n')
    const attempt = (message) =>
      runCli(['guard', '--ledger', ledger, '--max-attempts', '2', '--', process.execPath, script, '--message', message])

    const first = attempt('这家公司一定会倒')
    assert.match(first.stderr, /还有 1 次机会/)

    const second = attempt('这家公司一定会倒')
    assert.match(second.stderr, /次数用完了/)

    // 第三次哪怕内容改好了，也不再放行：试错预算用完。
    const third = attempt(GROUNDED.text)
    assert.equal(third.status, 2, third.stderr)
    assert.match(third.stderr, /交给人/)
    assert.match(third.stderr, /attempt\.exhausted/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('explain 只诊断，不消耗次数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claim-gate-'))
  const ledger = join(dir, 'attempts.jsonl')
  try {
    const first = runCli(['explain', '--ledger', ledger, '--text', '这家公司一定会倒'])
    assert.equal(first.status, 2)
    const second = runCli(['explain', '--ledger', ledger, '--text', '这家公司一定会倒'])
    assert.match(second.stdout, /第 1\/3 次/)
    assert.equal(existsSync(ledger), false, 'explain 不应该写账本')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
