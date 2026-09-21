import type { FastifyRequest, FastifyReply } from 'fastify'

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.accessVerify()
  } catch {
    await reply.status(401).send({ error: 'Unauthorized: invalid or missing token' })
  }
}
