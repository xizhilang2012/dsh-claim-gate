/**
 * 闸门策略：所有阈值都收在这里，改行为不用碰逻辑。
 *
 * @module claim-gate/lib/policy
 */

/** @typedef {'verified'|'first-party'|'reported'|'unverified'} EvidenceLevel */

export const LEVELS = /** @type {const} */ (['verified', 'first-party', 'reported', 'unverified'])

export const DEFAULTS = {
  /** 断言类内容的最低自证分。 */
  minScore: 70,
  /** 观点类内容的最低分（没有证据分项，阈值单独放低）。 */
  opinionMinScore: 60,
  /** 断言必须带证据。关掉就退化成“只查措辞”。 */
  requireEvidence: true,
  /** 公开内容必须能看出是 AI 在说。 */
  requireDisclosure: false,
  /** 缺披露时直接拦（而不是只警告）。 */
  strictDisclosure: false,
  /** 引文与正文的最低重叠比例。 */
  anchorRatio: 0.1,
  /** 引文最短字符数：太短的引文等于没引。 */
  minQuoteChars: 8,
  /** 正文最短字符数。 */
  minTextChars: 6,
  /** 正文上限（B 站评论 1000 字）。 */
  maxTextChars: 1000,
  /** 超过这个长度就给“评论写成长文”的警告。 */
  warnTextChars: 220,
  /** 数字被“约/左右”软化后可以放行。 */
  allowEstimateNumbers: true,
  /** verified 级别要求至少几个不同来源；不够就降级为 reported。 */
  verifiedMinSources: 2,
  /** 任何 warning 都算不通过。 */
  blockOnWarn: false,
  /** 信息量下限（去重记号数）。 */
  minInformation: 5,
}

/**
 * 合并用户配置，非法值回落默认。
 * @param {unknown} raw
 */
export function normalizePolicy(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const policy = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const fallback = DEFAULTS[key]
    const value = input[key]
    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') policy[key] = value
    } else if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) policy[key] = value
    }
  }
  return policy
}

/**
 * 规范化证据条目：接受 `"url|quote"` 字符串或 `{url, quote}` 对象。
 * @param {unknown} raw
 * @returns {{url: string, quote: string} | undefined}
 */
export function normalizeEvidence(raw) {
  if (typeof raw === 'string') {
    const index = raw.indexOf('|')
    if (index < 0) return { url: raw.trim(), quote: '' }
    return { url: raw.slice(0, index).trim(), quote: raw.slice(index + 1).trim() }
  }
  if (raw !== null && typeof raw === 'object') {
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    const quote = typeof raw.quote === 'string' ? raw.quote.trim() : ''
    if (url === '' && quote === '') return undefined
    return { url, quote }
  }
  return undefined
}

/**
 * 规范化级别，非法值当成 unverified（保守）。
 * @param {unknown} raw
 * @returns {EvidenceLevel}
 */
export function normalizeLevel(raw) {
  return LEVELS.includes(/** @type {any} */ (raw)) ? /** @type {EvidenceLevel} */ (raw) : 'unverified'
}

/** 合法 http(s) URL？ */
export function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

/** 证据来源的主机名（用于“几个独立来源”的判断）。 */
export function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
