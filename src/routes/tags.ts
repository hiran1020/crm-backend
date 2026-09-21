import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const createBody = z.object({
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

const updateBody = createBody.partial()

export async function tagsRoutes(app: FastifyInstance) {
  // GET /api/v1/tags
  app.get('/', { preHandler: authenticate }, async (_request, reply) => {
    const snap = await db.collection('tags').orderBy('name').get()
    return reply.send({ data: toDocs(snap) })
  })

  // POST /api/v1/tags
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const docRef = db.collection('tags').doc()
      const tag = { id: docRef.id, ...result.data }
      await docRef.set(tag)
      return reply.status(201).send(tag)
    },
  )

  // GET /api/v1/tags/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('tags').doc(id).get()
    const tag = toDoc(snap)
    if (!tag) return reply.status(404).send({ error: 'Tag not found' })
    return reply.send(tag)
  })

  // PATCH /api/v1/tags/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const snap = await db.collection('tags').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Tag not found' })
      await db.collection('tags').doc(id).update(result.data as Record<string, unknown>)
      return reply.send(toDoc(await db.collection('tags').doc(id).get()))
    },
  )

  // DELETE /api/v1/tags/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('tags').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Tag not found' })
      await db.collection('tags').doc(id).delete()
      return reply.status(204).send()
    },
  )
}
