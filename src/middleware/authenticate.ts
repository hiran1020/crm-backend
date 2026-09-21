import type { FastifyRequest, FastifyReply } from 'fastify'
import { auth } from '../lib/firebase.js'

type RequestUser = FastifyRequest['user']

// Cache verified token payloads so we don't call verifyIdToken on every request.
// Key = token string, value expires when the JWT itself expires.
const tokenCache = new Map<string, { user: RequestUser; expiresAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of tokenCache) if (v.expiresAt <= now) tokenCache.delete(k)
}, 60_000)

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    await reply.status(401).send({ error: 'Unauthorized: missing Bearer token' })
    return
  }

  const token = header.slice(7)

  const cached = tokenCache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    request.user = cached.user
    return
  }

  try {
    const decoded = await auth.verifyIdToken(token)
    const user: RequestUser = {
      id:    decoded.uid,
      email: decoded.email ?? '',
      name:  (decoded.name as string) ?? decoded.email ?? '',
      role:  (decoded.role as string) ?? 'sales_agent',
    }
    // Cache until 30 s before the token's own expiry to avoid serving stale entries
    tokenCache.set(token, { user, expiresAt: decoded.exp * 1000 - 30_000 })
    request.user = user
  } catch {
    await reply.status(401).send({ error: 'Unauthorized: invalid or expired token' })
  }
}
