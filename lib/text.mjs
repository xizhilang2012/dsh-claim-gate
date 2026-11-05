/**
 * 文本侧的特征提取：给闸门提供“能判的东西”。
 *
 * 全部是纯函数、零依赖，B站评论这种短文本和长动态都吃得下。
 * CJK 用字二元组（bigram）而不是分词——没有词典也能算重叠，且对“改写”更宽容。
 *
 * @module claim-gate/lib/text
 */

const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g
const LATIN_RUN = /[a-z0-9]+/g

/** 英文功能词：算重叠时只会带来噪声。 */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'as', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'me', 'us', 'them',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'not', 'no',
  'from', 'with', 'about', 'into', 'over', 'more', 'most', 'some', 'any', 'all', '这里', '这个', '那个',
])

/** 绝对化措辞：没有实证时，这些词就是“断言”的标记。 */
const ABSOLUTE = [
  '一定', '必然', '绝对', '毫无疑问', '无疑', '显然', '肯定', '势必', '注定', '众所周知',
  '从来', '永远', '全部', '所有', '全都', '根本', '彻底', '百分百', '100%', '无一例外',
  '必然导致', '铁定', '板上钉钉', '不容置疑', '显而易见',
]

/** 不确定性标记：二手信息至少要带一个。 */
const HEDGE = [
  '可能', '也许', '或许', '大概', '大约', '约', '左右', '似乎', '看起来', '貌似', '疑似',
  '据说', '据报', '据报道', '据称', '听说', '网传', '传闻', '尚未', '未见', '暂无',
  '不确定', '不清楚', '无法确认', '待核实', '存疑', '未必', '不一定', '按目前', '就我所见',
]

/** 自我背书：没有证据时，这类话本身就是问题。 */
const SELF_ENDORSE = [
  '我查过', '我核实过', '我确认过', '我验证过', '我亲眼', '已确认', '经核实', '我看过了',
  '我保证', '千真万确', '确定无误', '我亲手查',
]

/** 二手信息标记：出现即说明这条不是当事人视角。 */
const REPORT_MARK = /(据说|听说|网传|据报|据报道|据称|消息称|内部消息|传闻|有人反映|网友爆料)/

/**
 * 断言词：出现这些词，基本可以断定说话人在讲一件“有真假”的事，
 * 而不是在表达感受。分类器宁可把观点误判成断言（顶多要求补证据），
 * 也不要把断言漏判成观点（那就是鱼灾的入口）。
 */
const CLAIM_MARK =
  /(已经|早已|即将|将要|计划|宣布|确认|披露|数据|统计|调查|报告|内部|消息|来源|占比|同比|环比|上涨|下跌|裁员|降价|涨价|发布|上线|下架|起诉|被判|通报|证据|核实)/

/** 数量词：中文数字也算，因为它们常出现在事实陈述里。 */
const QUANTITY_MARK = /(一半|半数|多数|少数|三分之一|四成|翻倍|成倍)/

function text(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 切成可比较的记号：CJK 二元组 + 英文/数字单词。
 * @param {string} value
 * @returns {string[]}
 */
export function splitTokens(value) {
  const source = text(value).toLowerCase()
  const out = []

  for (const run of source.match(CJK_RUN) ?? []) {
    if (run.length === 1) out.push(run)
    else for (let i = 0; i + 1 < run.length; i += 1) out.push(run.slice(i, i + 2))
  }

  for (const word of source.match(LATIN_RUN) ?? []) {
    if (word.length >= 2 && !STOP.has(word)) out.push(word)
  }

  return out
}

/**
 * 断言文本被引文覆盖的比例（0–1）。
 *
 * 这是闸门里最关键的“防装饰性引用”：随手贴一个链接，但引文和正文讲的是两回事，
 * 这个比例会接近 0。
 *
 * @param {string} claim 正文
 * @param {string} quote 引文
 * @returns {number}
 */
export function overlapRatio(claim, quote) {
  const claimTokens = new Set(splitTokens(claim))
  if (claimTokens.size === 0) return 0
  const quoteTokens = new Set(splitTokens(quote))
  let hit = 0
  for (const token of claimTokens) if (quoteTokens.has(token)) hit += 1
  return hit / claimTokens.size
}

/** 找出正文里的数字（含百分比、万/亿），附带是否被“约/左右”之类软化过。 */
export function findNumbers(value) {
  const source = text(value)
  const out = []
  const pattern = /\d+(?:[.,]\d+)*(?:\s*(?:%|％|万|亿|千|个|人|次|元|块|条|年|月|日|小时|分钟))?/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    const before = source.slice(Math.max(0, match.index - 2), match.index)
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 2)
    const softened = /[约近~≈]|超过|不到|逾/.test(before) || /左右|上下|多|余/.test(after)
    out.push({ raw: match[0].trim(), index: match.index, softened })
  }
  return out
}

/** 命中的绝对化措辞。 */
export function findAbsolutes(value) {
  const source = text(value)
  return ABSOLUTE.filter((word) => source.includes(word))
}

/** 命中的不确定性标记。 */
export function findHedges(value) {
  const source = text(value)
  const found = HEDGE.filter((word) => source.includes(word))
  // “据新京报报道”这类最常见的转述写法，靠固定词表会漏掉：补一条模式。
  for (const match of source.matchAll(/据[^，。；！？]{0,10}(?:报道|称|透露|指出|了解)|有消息称|消息人士/g)) {
    if (!found.includes(match[0])) found.push(match[0])
  }
  return found
}

/** 命中的自我背书。 */
export function findSelfEndorsements(value) {
  const source = text(value)
  return SELF_ENDORSE.filter((word) => source.includes(word))
}

/** 是否是二手/转述口吻。 */
export function looksReported(value) {
  return REPORT_MARK.test(text(value))
}

/**
 * 粗分类：这句话是在陈述可核查的事实，还是在表达观点。
 *
 * 观点不需要证据（“这个镜头真好看”没有来源可给），断言需要。
 * 判据故意保守：只有明显无数字、无绝对词、无转述、也不太长的，才归为观点。
 *
 * @param {string} value
 * @returns {'claim'|'opinion'}
 */
export function classify(value) {
  const source = text(value).trim()
  if (source === '') return 'claim'
  if (findNumbers(source).length > 0) return 'claim'
  if (findAbsolutes(source).length > 0) return 'claim'
  if (looksReported(source)) return 'claim'
  if (findSelfEndorsements(source).length > 0) return 'claim'
  if (CLAIM_MARK.test(source)) return 'claim'
  if (QUANTITY_MARK.test(source)) return 'claim'
  if (source.length > 120) return 'claim'
  return 'opinion'
}

/** 去重后的记号数量：太少说明这条几乎没信息。 */
export function informationScore(value) {
  return new Set(splitTokens(value)).size
}

/** 是否出现重复的 n 字片段（复制粘贴/复读机痕迹）。 */
export function hasRepeatedNgram(value, n = 8) {
  const source = text(value).replace(/\s+/g, '')
  if (source.length < n * 2) return false
  const seen = new Set()
  for (let i = 0; i + n <= source.length; i += 1) {
    const gram = source.slice(i, i + n)
    if (seen.has(gram)) return true
    seen.add(gram)
  }
  return false
}

/** 结巴式重复（同一句连着说两遍）。 */
export function hasStutter(value) {
  const source = text(value).replace(/\s+/g, '')
  const pattern = /(.{6,})\1/
  return pattern.test(source)
}
