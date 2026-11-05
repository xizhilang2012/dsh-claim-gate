/**
 * 自证闸门：决定一段准备公开发出去的话，能不能发。
 *
 * 设计原则是 **fail-closed**：判不出来的时候不放行，让作者去补证据，
 * 而不是让一段“听起来很对”的话流进公共时间线。
 *
 * 三条判据，按重要性排：
 *   1. 断言必须带可核对的出处，且引文要真的和正文相关（防“贴个链接当背书”）。
 *   2. 数字必须能落回某条引文；落不回去就不许出现。
 *   3. 语气要配得上证据等级：只有二手消息时，不许用绝对化措辞。
 *
 * @module claim-gate/lib/gate
 */
import {
  classify,
  findAbsolutes,
  findHedges,
  findNumbers,
  findSelfEndorsements,
  hasRepeatedNgram,
  hasStutter,
  informationScore,
  looksReported,
  overlapRatio,
} from './text.mjs'
import { hostOf, isHttpUrl, normalizeEvidence, normalizeLevel, normalizePolicy } from './policy.mjs'

/** 分项权重：加起来 100，缺项按“不适用”重新归一。 */
const COMPONENTS = [
  { id: 'evidence', weight: 35 },
  { id: 'anchor', weight: 20 },
  { id: 'numbers', weight: 15 },
  { id: 'wording', weight: 10 },
  { id: 'hedge', weight: 5 },
  { id: 'disclosure', weight: 5 },
  { id: 'information', weight: 10 },
]

/** 公开内容里的“我是 AI”标记，命中任一即视为已披露。 */
const DISCLOSURE = /[\[（(【]\s*ai\s*[\]）)】]|ai\s*生成|由\s*ai|机器人|自动发言|非人类|数字生命/i

/** 语气软化表：`fix` 用。长词在前，避免“毫无疑问”被“不”先吃掉。 */
const SOFTEN = [
  ['毫无疑问', '大概率'],
  ['不容置疑', '大概率'],
  ['板上钉钉', '大概率'],
  ['显而易见', '看起来'],
  ['众所周知', '据我了解'],
  ['百分之百', '大概率'],
  ['100%', '大概率'],
  ['必然导致', '可能导致'],
  ['一定', '可能'],
  ['必然', '很可能'],
  ['绝对', '基本'],
  ['势必', '可能会'],
  ['注定', '可能会'],
  ['肯定', '大概率'],
  ['铁定', '大概率'],
  ['所有', '不少'],
  ['全部', '大部分'],
  ['全都', '大多数'],
  ['从来', '一直'],
  ['永远', '长期'],
  ['根本', '基本'],
  ['彻底', '大幅'],
  ['无一例外', '多数'],
]

/**
 * 检查一段待发内容。
 *
 * @param {{text: string, evidence?: unknown[], level?: string, kind?: string}} input
 * @param {object} [rawPolicy]
 */
export function check(input, rawPolicy) {
  const policy = normalizePolicy(rawPolicy)
  const text = String(input?.text ?? '').trim()
  const evidence = (Array.isArray(input?.evidence) ? input.evidence : [])
    .map(normalizeEvidence)
    .filter((item) => item !== undefined)
  const kind = input?.kind === 'claim' || input?.kind === 'opinion' ? input.kind : classify(text)
  const requestedLevel = normalizeLevel(input?.level)
  const issues = []
  const add = (id, level, message, hint) => {
    issues.push({ id, level, message, ...(hint === undefined ? {} : { hint }) })
  }

  if (text.length < policy.minTextChars) {
    add('text.too-short', 'block', `正文太短（${text.length} 字），不构成一次发言`)
  }
  if (text.length > policy.maxTextChars) {
    add('text.too-long', 'block', `正文 ${text.length} 字，超过平台上限 ${policy.maxTextChars}`)
  } else if (text.length > policy.warnTextChars) {
    add('text.verbose', 'warn', `正文 ${text.length} 字，评论区里偏长`)
  }

  for (const [index, item] of evidence.entries()) {
    if (!isHttpUrl(item.url)) {
      add('evidence.url', 'block', `第 ${index + 1} 条证据的链接不是合法 http(s) 地址：${item.url || '（空）'}`)
    }
    if (item.quote.length < policy.minQuoteChars) {
      add(
        'evidence.quote-short',
        'block',
        `第 ${index + 1} 条证据的引文只有 ${item.quote.length} 字，少于 ${policy.minQuoteChars} 字`,
        '引文要能独立看懂——至少要一整句原文。',
      )
    }
  }

  const hosts = new Set(evidence.map((item) => hostOf(item.url)).filter((host) => host !== ''))
  let level = requestedLevel
  if (requestedLevel === 'verified' && hosts.size < policy.verifiedMinSources) {
    level = 'reported'
    add(
      'evidence.single-source',
      'warn',
      `标为 verified，但独立来源只有 ${hosts.size} 个（要求 ${policy.verifiedMinSources} 个）→ 按 reported 处理`,
      '想当 verified 用，就再找一个不同站点的出处。',
    )
  }

  if (kind === 'claim' && policy.requireEvidence && evidence.length === 0) {
    add(
      'evidence.missing',
      'block',
      '这是一条断言，但没有给出任何可核对的出处',
      '要么补 --evidence "<url>|<原文>"，要么把话说成观点（删掉数字与绝对判断）。',
    )
  }

  let anchor = 0
  if (evidence.length > 0) {
    anchor = Math.max(...evidence.map((item) => overlapRatio(text, item.quote)))
    if (anchor < policy.anchorRatio) {
      add(
        'evidence.unanchored',
        'block',
        `引文和正文几乎无关（重叠 ${(anchor * 100).toFixed(1)}% < ${(policy.anchorRatio * 100).toFixed(0)}%）`,
        '这通常是“随手贴个链接当背书”。引文要直接支持正文里那句判断。',
      )
    }
  }

  const numbers = findNumbers(text)
  const unmatchedNumbers = []
  if (numbers.length > 0) {
    const quotes = evidence.map((item) => item.quote)
    for (const item of numbers) {
      if (item.softened && policy.allowEstimateNumbers) continue
      if (!numberSupported(item.raw, quotes)) unmatchedNumbers.push(item.raw)
    }
    if (unmatchedNumbers.length > 0) {
      add(
        'claim.number-unverified',
        'block',
        `这些数字在引文里找不到出处：${unmatchedNumbers.join('、')}`,
        '数字最容易编。要么在引文里找到它，要么写成“约/左右”，要么删掉。',
      )
    }
  }

  const absolutes = findAbsolutes(text)
  if (absolutes.length > 0 && level !== 'verified' && level !== 'first-party') {
    add(
      'claim.absolute',
      'block',
      `证据等级是 ${level}，却用了绝对化措辞：${absolutes.join('、')}`,
      '把“一定/所有/从来”改成“可能/多数/一直”，或者把证据升到 verified。',
    )
  }

  const hedges = findHedges(text)
  if (kind === 'claim' && level === 'reported' && hedges.length === 0 && evidence.length > 0) {
    add(
      'claim.missing-hedge',
      'block',
      '只有二手来源，正文却没有任何不确定性标记',
      '加“据报道/可能/尚未确认”之类，让读者知道这是转述。',
    )
  }

  const selfEndorsements = findSelfEndorsements(text)
  if (selfEndorsements.length > 0 && evidence.length === 0) {
    add(
      'claim.self-endorsement',
      'block',
      `用自我背书代替证据：${selfEndorsements.join('、')}`,
      '“我查过”不是证据。把查到的东西贴出来。',
    )
  }

  const disclosed = DISCLOSURE.test(text)
  if (policy.requireDisclosure && !disclosed) {
    add(
      'disclosure.missing',
      policy.strictDisclosure ? 'block' : 'warn',
      '正文里看不出这是 AI 在说话',
      '在开头加“（AI）”或“由 AI 生成”，别让读者以为对面是人。',
    )
  }

  const info = informationScore(text)
  if (info < policy.minInformation) {
    add('text.low-info', 'warn', `信息量过低（去重后只有 ${info} 个记号）`)
  }
  if (hasRepeatedNgram(text) || hasStutter(text)) {
    add('text.repetitive', 'warn', '正文里有成段重复，像复读机')
  }

  if (looksReported(text) && level === 'verified') {
    add('level.mismatch', 'warn', '正文是转述口吻，却标成 verified')
  }

  const flags = {
    evidence: evidence.length > 0 && evidence.every((item) => isHttpUrl(item.url)),
    anchor: anchor >= policy.anchorRatio,
    numbers: unmatchedNumbers.length === 0,
    wording: absolutes.length === 0 || level === 'verified' || level === 'first-party',
    hedge: hedges.length > 0,
    disclosure: disclosed,
    information: info >= policy.minInformation,
  }
  const applicable = applicableComponents({ kind, policy, evidence, numbers, level })
  const score = scoreOf(flags, applicable)

  const threshold = kind === 'opinion' ? policy.opinionMinScore : policy.minScore
  const blocking = issues.filter((issue) => issue.level === 'block')
  if (blocking.length === 0 && policy.blockOnWarn && issues.length > 0) {
    add('policy.block-on-warn', 'block', '策略要求：任何警告都不放行')
  }
  if (blocking.length === 0 && score < threshold) {
    add('score.below-threshold', 'block', `自证分 ${score} 低于阈值 ${threshold}`)
  }

  const verdict = issues.some((issue) => issue.level === 'block') ? 'block' : 'pass'

  return {
    verdict,
    score,
    threshold,
    kind,
    level,
    requestedLevel,
    issues,
    evidence,
    stats: {
      length: text.length,
      information: info,
      anchor: Number(anchor.toFixed(4)),
      numbers: numbers.map((item) => item.raw),
      absolutes,
      hedges,
      sources: [...hosts],
    },
  }
}

/** 哪些分项对这次判定有效。不适用的一律不计入分母。 */
function applicableComponents({ kind, policy, evidence, numbers, level }) {
  const ids = new Set(['wording', 'information'])
  if (kind === 'claim' && policy.requireEvidence) ids.add('evidence')
  if (evidence.length > 0) ids.add('anchor')
  if (numbers.length > 0) ids.add('numbers')
  if (kind === 'claim' && level === 'reported') ids.add('hedge')
  if (policy.requireDisclosure) ids.add('disclosure')
  return COMPONENTS.filter((component) => ids.has(component.id))
}

function scoreOf(flags, components) {
  const total = components.reduce((sum, component) => sum + component.weight, 0)
  if (total === 0) return 100
  const earned = components.reduce(
    (sum, component) => sum + (flags[component.id] === true ? component.weight : 0),
    0,
  )
  return Math.round((earned / total) * 100)
}

/** 数字是否能在某条引文里找到（允许千分位/空格差异）。 */
function numberSupported(raw, quotes) {
  const compact = raw.replace(/[\s,]/g, '')
  const digits = compact.replace(/[^\d.]/g, '')
  return quotes.some((quote) => {
    const haystack = quote.replace(/[\s,]/g, '')
    if (haystack.includes(compact)) return true
    // 单位不同不算错（“3万”对“30000”），但只对两位以上的数字放松。
    return digits.replace(/\./g, '').length >= 2 && haystack.includes(digits)
  })
}

/**
 * 把一段话改到能过闸：软化绝对词、补披露。
 *
 * 它**不会**替你编证据——缺证据只能人来补。改动全部回执，方便复核。
 *
 * @param {string} text
 * @param {object} [rawPolicy]
 */
export function fix(text, rawPolicy) {
  const policy = normalizePolicy(rawPolicy)
  const source = String(text ?? '').trim()
  const changes = []
  let output = source

  for (const [from, to] of SOFTEN) {
    if (!output.includes(from)) continue
    output = output.split(from).join(to)
    changes.push({ type: 'soften', from, to })
  }

  if (policy.requireDisclosure && !DISCLOSURE.test(output)) {
    output = `（AI）${output}`
    changes.push({ type: 'disclose', from: '', to: '（AI）' })
  }

  return { text: output, changes, changed: changes.length > 0 }
}

/** 一行摘要，CLI 与日志共用。 */
export function summarize(result) {
  const head = result.verdict === 'pass' ? '通过' : '拦截'
  return `${head} · 自证分 ${result.score}/${result.threshold} · ${result.kind}/${result.level} · ${result.issues.length} 条意见`
}
