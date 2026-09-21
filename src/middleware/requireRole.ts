import type { FastifyRequest, FastifyReply } from 'fastify'
import type { UserRole } from '@prisma/client'

export function requireRole(...roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.user
    if (!user) {
      await reply.status(401).send({ error: 'Unauthorized' })
      return
    }
    if (!roles.includes(user.role as UserRole)) {
      await reply.status(403).send({ error: 'Forbidden: insufficient role' })
    }
  }
}
