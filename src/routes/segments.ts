import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const criterionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'in', 'not_in']),
  value: z.unknown(),
})

const createBody = z.object({
  name: z.string().trim().min(1),
  entityType: z.enum(['customer', 'lead', 'deal']),
  criteria: z.array(criterionSchema).min(1),
  description: z.string().optional(),
})

const updateBody = createBody.partial()

type Criterion = z.infer<typeof criterionSchema>

function matchesCriteria(data: Record<string, unknown>, criteria: Criterion[]): boolean {
  return criteria.every(c => {
    const val = data[c.field]
    switch (c.operator) {
      case 'eq': return val === c.value
      case 'ne': return val !== c.value
      case 'gt': return (val as number) > (c.value as number)
      case 'lt': return (val as number) < (c.value as number)
      case 'gte': return (val as number) >= (c.value as number)
      case 'lte': return (val as number) <= (c.value as number)
      case 'contains': return typeof val === 'string' && val.includes(c.value as string)
      case 'in': return Array.isArray(c.value) && (c.value as unknown[]).includes(val)
      case 'not_in': return Array.isArray(c.value) && !(c.value as unknown[]).includes(val)
      default: return false
    }
  })
}

export async function segmentsRoutes(app: FastifyInstance) {
  // GET /api/v1/segments
  app.get('/', { preHandler: authenticate }, async (_request, reply) => {
    const snap = await db.collection('segments').orderBy('name').get()
    return reply.send({ data: toDocs(snap) })
  })

  // POST /api/v1/segments
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const docRef = db.collection('segments').doc()
      const segment = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
      await docRef.set(segment)
      return reply.status(201).send(segment)
    },
  )

  // GET /api/v1/segments/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('segments').doc(id).get()
    const segment = toDoc(snap)
    if (!segment) return reply.status(404).send({ error: 'Segment not found' })
    return reply.send(segment)
  })

  // PATCH /api/v1/segments/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const snap = await db.collection('segments').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Segment not found' })
      await db.collection('segments').doc(id).update({ ...result.data, updatedAt: now() })
      return reply.send(toDoc(await db.collection('segments').doc(id).get()))
    },
  )

  // DELETE /api/v1/segments/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('segments').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Segment not found' })
      await db.collection('segments').doc(id).delete()
      return reply.status(204).send()
    },
  )

  // GET /api/v1/segments/:id/evaluate — return matching entity ids
  app.get('/:id/evaluate', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('segments').doc(id).get()
    const segment = toDoc<{ entityType: string; criteria: Criterion[] }>(snap)
    if (!segment) return reply.status(404).send({ error: 'Segment not found' })

    const collectionMap: Record<string, string> = { customer: 'customers', lead: 'leads', deal: 'deals' }
    const collection = collectionMap[segment.entityType]
    if (!collection) return reply.status(400).send({ error: 'Unknown entity type' })

    const entitySnap = await db.collection(collection).get()
    const matches = entitySnap.docs
      .filter(d => matchesCriteria(d.data() as Record<string, unknown>, segment.criteria))
      .map(d => ({ id: d.id, ...d.data() }))

    return reply.send({ count: matches.length, data: matches })
  })
}
