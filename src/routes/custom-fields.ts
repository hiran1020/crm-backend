import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const createDefBody = z.object({
  entityType: z.enum(['customer', 'lead', 'deal']),
  key: z.string().trim().min(1).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(1),
  type: z.enum(['text', 'number', 'date', 'select', 'url', 'checkbox']),
  options: z.array(z.string()).optional().default([]),
  required: z.boolean().default(false),
})

const updateDefBody = createDefBody.omit({ entityType: true, key: true }).partial()

const upsertValueBody = z.object({
  entityId: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
})

export async function customFieldsRoutes(app: FastifyInstance) {
  // GET /api/v1/custom-fields?entityType=customer
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    let query = db.collection('custom_field_defs') as FirebaseFirestore.Query
    if (q.entityType) query = query.where('entityType', '==', q.entityType)
    const snap = await query.orderBy('name').get()
    return reply.send({ data: toDocs(snap) })
  })

  // POST /api/v1/custom-fields
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const result = createDefBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const docRef = db.collection('custom_field_defs').doc()
      const def = { id: docRef.id, ...result.data, createdAt: now() }
      await docRef.set(def)
      return reply.status(201).send(def)
    },
  )

  // GET /api/v1/custom-fields/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('custom_field_defs').doc(id).get()
    const def = toDoc(snap)
    if (!def) return reply.status(404).send({ error: 'Custom field not found' })
    return reply.send(def)
  })

  // PATCH /api/v1/custom-fields/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateDefBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const snap = await db.collection('custom_field_defs').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Custom field not found' })
      await db.collection('custom_field_defs').doc(id).update(result.data as Record<string, unknown>)
      return reply.send(toDoc(await db.collection('custom_field_defs').doc(id).get()))
    },
  )

  // DELETE /api/v1/custom-fields/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('custom_field_defs').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Custom field not found' })
      await db.collection('custom_field_defs').doc(id).delete()
      return reply.status(204).send()
    },
  )

  // GET /api/v1/custom-fields/values?entityId=xxx
  app.get('/values', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    if (!q.entityId) return reply.status(400).send({ error: 'entityId is required' })
    const snap = await db.collection('custom_field_values').where('entityId', '==', q.entityId).get()
    return reply.send({ data: toDocs(snap) })
  })

  // PUT /api/v1/custom-fields/values — batch upsert {entityId, values: {key: value}}
  app.put('/values', { preHandler: authenticate }, async (request, reply) => {
    const result = upsertValueBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const { entityId, values } = result.data
    const keys = Object.keys(values)

    // Resolve field def ids by key
    const defsSnap = await db.collection('custom_field_defs').where('key', 'in', keys).get()
    const defByKey = new Map(defsSnap.docs.map(d => [d.data().key, d.id]))

    const unknown = keys.filter(k => !defByKey.has(k))
    if (unknown.length) return reply.status(400).send({ error: `Unknown field keys: ${unknown.join(', ')}` })

    const batch = db.batch()
    for (const key of keys) {
      const fieldDefId = defByKey.get(key)!
      const docId = `${fieldDefId}_${entityId}`
      const ref = db.collection('custom_field_values').doc(docId)
      batch.set(ref, { id: docId, fieldDefId, entityId, key, value: values[key], updatedAt: now() }, { merge: true })
    }
    await batch.commit()

    const updated = await db.collection('custom_field_values').where('entityId', '==', entityId).get()
    return reply.send({ data: toDocs(updated) })
  })
}
