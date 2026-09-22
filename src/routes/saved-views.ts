import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'

const createBody = z.object({
  name: z.string().trim().min(1),
  entityType: z.enum(['customer', 'lead', 'deal']),
  filters: z.record(z.string()).default({}),
  isDefault: z.boolean().default(false),
})

const updateBody = createBody.partial()

export async function savedViewsRoutes(app: FastifyInstance) {
  // GET /api/v1/saved-views
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    let query = db.collection('saved_views') as FirebaseFirestore.Query
    if (q.entityType) query = query.where('entityType', '==', q.entityType)
    // Sort in memory — avoids composite index for where+orderBy
    const snap = await query.get()
    const data = toDocs(snap).sort((a, b) =>
      String(a.name).localeCompare(String(b.name)),
    )
    return reply.send({ data })
  })

  // POST /api/v1/saved-views
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    // If setting default, clear any existing default for the same entityType
    if (result.data.isDefault) {
      const others = await db.collection('saved_views')
        .where('entityType', '==', result.data.entityType)
        .where('isDefault', '==', true)
        .get()
      await Promise.all(others.docs.map(d => d.ref.update({ isDefault: false })))
    }
    const docRef = db.collection('saved_views').doc()
    const view = {
      id: docRef.id,
      ...result.data,
      createdBy: request.user.id,
      createdAt: now(),
      updatedAt: now(),
    }
    await docRef.set(view)
    return reply.status(201).send(view)
  })

  // GET /api/v1/saved-views/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('saved_views').doc(id).get()
    const view = toDoc(snap)
    if (!view) return reply.status(404).send({ error: 'Saved view not found' })
    return reply.send(view)
  })

  // PATCH /api/v1/saved-views/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('saved_views').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Saved view not found' })
    // Clear other defaults when setting a new one
    if (result.data.isDefault) {
      const entityType = result.data.entityType ?? (snap.data()?.entityType as string)
      const others = await db.collection('saved_views')
        .where('entityType', '==', entityType)
        .where('isDefault', '==', true)
        .get()
      await Promise.all(others.docs.filter(d => d.id !== id).map(d => d.ref.update({ isDefault: false })))
    }
    const updatedAt = new Date().toISOString()
    await db.collection('saved_views').doc(id).update({ ...result.data, updatedAt: now() })
    return reply.send({ id, ...snap.data(), ...result.data, updatedAt })
  })

  // DELETE /api/v1/saved-views/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('saved_views').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Saved view not found' })
    await db.collection('saved_views').doc(id).delete()
    return reply.status(204).send()
  })
}
