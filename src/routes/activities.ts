import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, pagedList, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'

const createBody = z.object({
  type: z.enum(['call', 'email', 'meeting', 'note', 'task']),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  owner: z.string().min(1),
  completed: z.boolean().default(false),
  // Accept empty string (→ undefined), date-only "YYYY-MM-DD" (→ midnight UTC), or full ISO datetime
  dueDate: z.preprocess(
    v => {
      if (v == null || v === '') return undefined
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`
      return v
    },
    z.string().datetime({ offset: true }).optional(),
  ),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  // Activities can be standalone (personal tasks) or linked to an entity
  relatedTo:   z.string().min(1).optional(),
  relatedType: z.enum(['customer', 'lead', 'deal']).optional(),
  relatedName: z.string().trim().optional(),
})

const updateBody = createBody.partial()

export async function activitiesRoutes(app: FastifyInstance) {
  // GET /api/v1/activities
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    let query = db.collection('activities') as FirebaseFirestore.Query
    const hasFilters = !!(q.relatedTo || q.relatedType || q.type || q.owner || q.completed !== undefined)
    if (q.relatedTo)   query = query.where('relatedTo', '==', q.relatedTo)
    if (q.relatedType) query = query.where('relatedType', '==', q.relatedType)
    if (q.type)        query = query.where('type', '==', q.type)
    if (q.owner)       query = query.where('owner', '==', q.owner)
    if (q.completed !== undefined) query = query.where('completed', '==', q.completed === 'true')

    const { data, total } = await pagedList({ query, hasFilters, orderField: 'createdAt', page, pageSize })
    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/activities
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const docRef = db.collection('activities').doc()
    const activity = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await docRef.set(activity)
    return reply.status(201).send(activity)
  })

  // GET /api/v1/activities/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('activities').doc(id).get()
    const activity = toDoc(snap)
    if (!activity) return reply.status(404).send({ error: 'Activity not found' })
    return reply.send(activity)
  })

  // PATCH /api/v1/activities/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('activities').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Activity not found' })
    await db.collection('activities').doc(id).update({ ...result.data, updatedAt: now() })
    return reply.send(toDoc(await db.collection('activities').doc(id).get()))
  })

  // DELETE /api/v1/activities/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('activities').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Activity not found' })
    await db.collection('activities').doc(id).delete()
    return reply.status(204).send()
  })
}
