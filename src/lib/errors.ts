import type { FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'

export function handlePrismaError(err: unknown, reply: FastifyReply): FastifyReply | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[])?.join(', ') ?? 'field'
      return reply.status(409).send({ error: `Conflict: ${fields} already exists` })
    }
    if (err.code === 'P2025') {
      return reply.status(404).send({ error: 'Record not found' })
    }
  }
  return null
}
