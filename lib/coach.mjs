/**
 * 把“不通过”翻译成一次可执行的纠错，而不是一张错误码清单。
 *
 * 闸门的目的是让对方**知道错在哪、以及为什么那是个错**，然后自己改；
 * 只丢一个 exit 2 出去，最可能的结果是它把“一定”换成“可能”再发一遍——
 * 那是顺从，不是理解。
 *
 * @module claim-gate/lib/coach
 */

/** 每条规则背后的“为什么”，以及可以怎么改。 */
export const RULES = {
  'evidence.missing': {
    why: '你在陈述一件有真假的事，却没给读者任何能自己核对的东西。读者只能选择信你、或者不信你——评论区变成噪声，就是从这一步开始的。',
    fixes: [
      '补证据：<code>--evidence "&lt;链接&gt;|&lt;原文至少 8 字&gt;"</code>',
      '降级为转述：加“据报道/可能”，同时拿掉绝对判断',
      '改成观点：只说你自己的感受，删掉数字和事实动词',
    ],
  },
  'evidence.url': {
    why: '给了出处，但那不是一个能打开的链接。等于把“我说了算”包装成了“有来源”。',
    fixes: ['换成完整的 http(s) 地址；打不开的东西不算证据'],
  },
  'evidence.quote-short': {
    why: '引文太短，短到不能独立成立。别人顺着链接过去，也没法确认你引的就是这个意思。',
    fixes: ['引一整句原文，至少 8 个字，能脱离上下文看懂'],
  },
  'evidence.unanchored': {
    why: '链接是真的，但引文和你要说的那句话几乎没关系。这是最常见的一种假装：随手贴个来源，让它替一段它并不支持的判断背书。',
    fixes: [
      '换一段真正支持这句判断的引文',
      '或者把判断改成引文能支持的那部分',
      '两样都做不到，说明这个判断目前没有依据',
    ],
  },
  'claim.number-unverified': {
    why: '数字最容易被记住，也最容易被编。一个没有出处的数字，比一句模糊的形容词危险得多——因为它看起来精确。',
    fixes: [
      '在引文里找到这个数字',
      '写成“约/左右/近”，承认它不精确',
      '删掉它，换成定性描述',
    ],
  },
  'claim.absolute': {
    why: '你手上只有二手消息（或什么都没有），却用了“一定、所有、从来”这种不留余地的词。语气比证据硬，读者就会被误导。',
    fixes: ['把绝对词换成“可能/多数/一直”', '或者把证据等级升到 verified（两个以上独立来源）'],
  },
  'claim.missing-hedge': {
    why: '这是转述，不是你的亲历，但正文里读不出这一层。读者会以为你在陈述自己确认过的事。',
    fixes: ['加“据报道/据称/尚未确认”一类的标记'],
  },
  'claim.self-endorsement': {
    why: '“我查过”不是证据，是把核查过程藏起来，只留下结论。读者无法复核，只能相信你——这跟没有出处是一回事。',
    fixes: ['把查到的东西贴出来：链接 + 原文'],
  },
  'evidence.single-source': {
    why: '标成 verified，但只有一个来源。单一来源可以是对的，但它撑不起“已核实”这个说法。',
    fixes: ['再找一个不同站点的出处', '或者把等级降成 reported，并在正文里保留语气'],
  },
  'disclosure.missing': {
    why: '读的人看不出这是 AI 在说话。鱼灾里最刺眼的一点，就是自动化被可爱人格洗成了“一个真实的人在回你”。',
    fixes: ['在正文里加上“（AI）”或“由 AI 生成”'],
  },
  'text.low-info': {
    why: '这句话几乎没有信息量。它占了公共版面，却没有让任何人多知道一件事。',
    fixes: ['补一个具体的东西：时间、地点、数字、原文', '或者干脆不说'],
  },
  'text.repetitive': {
    why: '成段重复，像复读机。评论区里最容易被识别成机器人的就是这种。',
    fixes: ['删掉重复部分，只留一次'],
  },
  'text.too-short': {
    why: '太短了，不构成一次发言。',
    fixes: ['把话说完'],
  },
  'text.too-long': {
    why: '超过平台上限，发不出去。',
    fixes: ['拆成几条，或者只留最要紧的一句'],
  },
  'text.verbose': {
    why: '评论区里偏长。长不等于有内容，通常只是没想清楚。',
    fixes: ['砍掉铺垫，只留判断和依据'],
  },
  'level.mismatch': {
    why: '正文是转述口吻，却标成 verified。标签和内容对不上。',
    fixes: ['把等级改成 reported，或者换成你自己确认过的事实'],
  },
  'score.below-threshold': {
    why: '没有某一条硬伤，但整体“自证”不足：证据、锚定、数字、语气几项加起来不够。',
    fixes: ['补一条能把数字和判断都罩住的引文'],
  },
  'policy.block-on-warn': {
    why: '当前策略要求：任何警告都不放行。',
    fixes: ['把警告项处理掉，或者调低 blockOnWarn'],
  },
  'attempt.exhausted': {
    why: '同一件事已经试了太多次。继续试下去，只会让它在“猜怎么过闸”上花力气，而不是在“这件事到底是不是真的”上花力气。',
    fixes: ['停下来，把这条交给人类判断'],
  },
  'ack.missing': {
    why: '这是第二次提交，但没有说明上一版错在哪、这次改了什么。改了字不等于知道错在哪。',
    fixes: ['加 --ack "我漏了出处：原话是 X，我写成了 Y"'],
  },
  'ack.vague': {
    why: '回执没有指向具体的问题。它读起来像“我错了，我改”，但看不出你到底认下了哪一条。',
    fixes: ['在回执里点名那条规则，或者引用你改掉的原话'],
  },
}

/** 判据里面向“读者”的解释，缺规则时兜底。 */
const FALLBACK = {
  why: '这句话没有通过自证检查。',
  fixes: ['补出处，或者把话说小一点'],
}

/**
 * 生成一次纠错说明。
 *
 * @param {object} result `check()` 的返回值
 * @param {{attempt?: number, maxAttempts?: number, ackRequired?: boolean}} [meta]
 */
export function brief(result, meta = {}) {
  const attempt = meta.attempt ?? 1
  const maxAttempts = meta.maxAttempts ?? 3
  const blocking = result.issues.filter((issue) => issue.level === 'block')
  const primary = blocking[0] ?? result.issues[0]
  const rule = RULES[primary?.id] ?? FALLBACK

  const fixes = []
  for (const issue of blocking.length > 0 ? blocking : result.issues) {
    for (const fix of (RULES[issue.id] ?? FALLBACK).fixes) {
      if (!fixes.includes(fix)) fixes.push(fix)
    }
  }

  return {
    verdict: result.verdict,
    score: result.score,
    threshold: result.threshold,
    kind: result.kind,
    level: result.level,
    attempt,
    maxAttempts,
    remaining: Math.max(0, maxAttempts - attempt),
    why: rule.why,
    fixes: fixes.slice(0, 5),
    ackRequired: meta.ackRequired === true,
    issues: result.issues,
  }
}

/** 回执里出现这些词，说明它确实在认错，而不只是走个流程。 */
const ACK_MARK = /(漏|没|错|以为|误|当成|补|改|删|降级|换成|证据|出处|来源|核实|原文)/

/**
 * 校验“认知回执”。
 *
 * 不要求文采，只要求两件事：够具体（8 字以上），且指向问题本身（含认知词）。
 *
 * @param {string} ack
 * @param {object} result
 * @returns {{ok: true} | {ok: false, id: string, message: string}}
 */
export function validateAck(ack, result) {
  const text = String(ack ?? '').trim()
  if (text === '') {
    return { ok: false, id: 'ack.missing', message: '缺少 --ack（这次改了什么、上一版错在哪）' }
  }
  if (text.length < 8 || !ACK_MARK.test(text)) {
    return {
      ok: false,
      id: 'ack.vague',
      message: `回执太笼统（“${text}”）：说清是哪一条、原文是什么、你改成了什么`,
    }
  }
  const mentioned = result.issues.map((issue) => issue.id).find((id) => text.includes(id))
  return { ok: true, ...(mentioned === undefined ? {} : { rule: mentioned }) }
}

/** 渲染成给人（也给 agent）读的一段话。 */
export function renderBrief(result, meta = {}) {
  const info = brief(result, meta)
  const lines = []
  const head = result.verdict === 'pass' ? '通过' : result.verdict === 'escalate' ? '停下' : '拦截'
  lines.push(
    `[claim-gate] ${head} · 第 ${info.attempt}/${info.maxAttempts} 次 · 自证分 ${result.score}/${result.threshold} · ${result.kind}/${result.level}`,
  )
  lines.push('')
  lines.push('为什么会拦')
  lines.push(`  ${info.why}`)
  lines.push('')

  if (result.issues.length > 0) {
    lines.push('这次具体哪不对')
    for (const issue of result.issues) {
      lines.push(`  ${issue.level === 'block' ? '✗' : '！'} ${issue.id}：${issue.message}`)
    }
    lines.push('')
  }

  if (info.fixes.length > 0) {
    lines.push('可以怎么改（选一条，不用全做）')
    info.fixes.forEach((fix, index) => {
      lines.push(`  ${String.fromCharCode(65 + index)}. ${fix.replace(/<[^>]+>/g, '')}`)
    })
    lines.push('')
  }

  if (info.ackRequired) {
    lines.push('改完要带一句回执')
    lines.push('  --ack "我漏了出处：原话只说了 X，我写成了 Y"')
    lines.push('  没有回执的再次提交会被拒——要的不是改字，是你知道改了什么。')
    lines.push('')
  }

  if (result.verdict !== 'pass') {
    lines.push(
      info.remaining > 0
        ? `还有 ${info.remaining} 次机会；用完就停下来交给人。`
        : '次数用完了。停在这里，把这件事交给人判断。',
    )
  }

  return lines.join('\n')
}
