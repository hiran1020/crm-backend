import type { FastifyReply } from 'fastify'

export function handleFirestoreError(err: unknown, reply: FastifyReply): FastifyReply | null {
  if (err instanceof Error) {
    // Firestore "not-found" error
    if ((err as NodeJS.ErrnoException).code === '5' || err.message.includes('NOT_FOUND')) {
      return reply.status(404).send({ error: 'Record not found' })
    }
    // Firebase Auth errors
    if ('errorInfo' in err) {
      const code = (err as { errorInfo: { code: string } }).errorInfo.code
      if (code === 'auth/email-already-exists') {
        return reply.status(409).send({ error: 'Conflict: email already exists' })
      }
      if (code === 'auth/user-not-found') {
        return reply.status(404).send({ error: 'User not found' })
      }
    }
  }
  return null
}
