import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import crypto from 'crypto'

const createBody = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  description: z.string().optional(),
  active: z.boolean().default(true),
})

const updateBody = createBody.partial()

export async function webhooksRoutes(app: FastifyInstance) {
  // GET /api/v1/webhooks
  app.get(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_request, reply) => {
      const snap = await db.collection('webhooks').orderBy('createdAt', 'desc').get()
      // Never expose secret in list
      const data = toDocs<Record<string, unknown>>(snap).map(({ secret: _s, ...w }) => w)
      return reply.send({ data })
    },
  )

  // POST /api/v1/webhooks
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const secret = crypto.randomBytes(32).toString('hex')
      const docRef = db.collection('webhooks').doc()
      const webhook = { id: docRef.id, ...result.data, secret, deliveryCount: 0, failureCount: 0, createdAt: now(), updatedAt: now() }
      await docRef.set(webhook)
      // Return secret once on creation
      return reply.status(201).send(webhook)
    },
  )

  // GET /api/v1/webhooks/:id
  app.get(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('webhooks').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Webhook not found' })
      const { secret: _s, ...data } = { id: snap.id, ...snap.data() } as Record<string, unknown>
      return reply.send(data)
    },
  )

  // PATCH /api/v1/webhooks/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const snap = await db.collection('webhooks').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Webhook not found' })
      await db.collection('webhooks').doc(id).update({ ...result.data, updatedAt: now() })
      const updated = { id, ...((await db.collection('webhooks').doc(id).get()).data() ?? {}) } as Record<string, unknown>
      const { secret: _s, ...data } = updated
      return reply.send(data)
    },
  )

  // DELETE /api/v1/webhooks/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('webhooks').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Webhook not found' })
      await db.collection('webhooks').doc(id).delete()
      return reply.status(204).send()
    },
  )

  // POST /api/v1/webhooks/:id/rotate-secret
  app.post(
    '/:id/rotate-secret',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('webhooks').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Webhook not found' })
      const newSecret = crypto.randomBytes(32).toString('hex')
      await db.collection('webhooks').doc(id).update({ secret: newSecret, updatedAt: now() })
      return reply.send({ secret: newSecret })
    },
  )

  // GET /api/v1/webhooks/:id/deliveries — recent delivery log
  app.get(
    '/:id/deliveries',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('webhooks').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Webhook not found' })
      const deliveries = await db.collection('webhooks').doc(id)
        .collection('deliveries').orderBy('createdAt', 'desc').limit(50).get()
      return reply.send({ data: toDocs(deliveries) })
    },
  )
}
