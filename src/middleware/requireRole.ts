import type { FastifyRequest, FastifyReply } from 'fastify'

export function requireRole(...roles: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      await reply.status(401).send({ error: 'Unauthorized' })
      return
    }
    if (!roles.includes(request.user.role)) {
      await reply.status(403).send({ error: 'Forbidden: insufficient role' })
    }
  }
}
