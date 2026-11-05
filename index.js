/**
 * claim-gate 的 Host 侧入口。
 *
 * 闸门的本体在 lib/ 与 bin/ 里（纯函数 + 命令行），这个文件只做两件事：
 *   1. 把策略挂到本 profile，启动时打一行“闸门已装”。
 *   2. 暴露一个本地 HTTP 接口，给设置页/别的插件做预检：
 *        POST /dsh-claim-gate/check  { text, evidence, level, kind }
 *        GET  /dsh-claim-gate/policy
 *
 * 路由注册失败不会让插件崩掉：命令行那条路不依赖它。
 *
 * @module dsh-claim-gate
 */
import { check, summarize } from './lib/gate.mjs'
import { renderBrief } from './lib/coach.mjs'
import { DEFAULTS, normalizePolicy } from './lib/policy.mjs'

export const name = 'claim-gate'

/** 没有必须依赖的服务：拿不到 webServer 就退化成纯命令行工具。 */
export const inject = []

const MAX_BODY = 64 * 1024

export function apply(ctx, rawConfig) {
  const policy = normalizePolicy(rawConfig)
  const log = ctx.logger ?? console
  log.info(
    `claim-gate: 自证闸门已装载（及格线 ${policy.minScore}，证据${policy.requireEvidence ? '必需' : '可选'}）`,
  )

  const server = ctx.webServer
  if (server === undefined || typeof server.register !== 'function') {
    log.info('claim-gate: 当前环境没有 webServer，只提供命令行（bin/claim-gate.mjs）')
    return
  }

  ctx.effect(() => {
    const disposers = [
      server.register({
        kind: 'exact',
        path: '/dsh-claim-gate/policy',
        handler: async (_req, res) => {
          json(res, 200, { ok: true, policy, defaults: DEFAULTS })
        },
      }),
      server.register({
        kind: 'exact',
        path: '/dsh-claim-gate/check',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: '只接受 POST' })
            return
          }
          let body
          try {
            body = JSON.parse(await readBody(req))
          } catch (error) {
            json(res, 400, { ok: false, error: `请求体不是合法 JSON：${error.message}` })
            return
          }
          if (body === null || typeof body !== 'object' || typeof body.text !== 'string') {
            json(res, 400, { ok: false, error: '缺少 text' })
            return
          }
          try {
            const result = check(
              {
                text: body.text,
                evidence: Array.isArray(body.evidence) ? body.evidence : [],
                level: body.level,
                kind: body.kind,
              },
              policy,
            )
            json(res, 200, { ok: true, summary: summarize(result), brief: renderBrief(result), ...result })
          } catch (error) {
            json(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          // 卸载阶段的失败不该影响宿主退出。
        }
      }
    }
  }, 'claimGate.routes')

  log.info('claim-gate: 预检接口 /dsh-claim-gate/check 已就绪')
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error(`请求体超过 ${MAX_BODY} 字节`))
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}
