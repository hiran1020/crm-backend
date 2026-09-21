import type { FastifyRequest, FastifyReply } from 'fastify'
import { auth } from '../lib/firebase.js'

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
  try {
    const decoded = await auth.verifyIdToken(token)
    request.user = {
      id: decoded.uid,
      email: decoded.email ?? '',
      name: (decoded.name as string) ?? decoded.email ?? '',
      role: (decoded.role as string) ?? 'sales_agent',
    }
  } catch {
    await reply.status(401).send({ error: 'Unauthorized: invalid or expired token' })
  }
}
