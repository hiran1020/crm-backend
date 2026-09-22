import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const createBody = z.object({
  name: z.string().trim().min(1),
  metric: z.enum(['revenue', 'deals_won', 'leads_converted', 'activities']),
  target: z.number().positive(),
  period: z.enum(['monthly', 'quarterly', 'annual']),
  year: z.number().int().min(2020).max(2100),
  quarter: z.number().int().min(1).max(4).optional(),
  month: z.number().int().min(1).max(12).optional(),
  owner: z.string().default('all'),
})

const updateBody = createBody.partial()

export async function goalsRoutes(app: FastifyInstance) {
  // GET /api/v1/goals
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    let query = db.collection('goals') as FirebaseFirestore.Query
    if (q.owner)  query = query.where('owner', '==', q.owner)
    if (q.period) query = query.where('period', '==', q.period)
    if (q.year)   query = query.where('year', '==', parseInt(q.year, 10))
    const snap = await query.orderBy('createdAt', 'desc').get()
    return reply.send({ data: toDocs(snap) })
  })

  // POST /api/v1/goals
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const docRef = db.collection('goals').doc()
      const goal = { id: docRef.id, ...result.data, current: 0, createdAt: now(), updatedAt: now() }
      await docRef.set(goal)
      return reply.status(201).send(goal)
    },
  )

  // GET /api/v1/goals/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('goals').doc(id).get()
    const goal = toDoc(snap)
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })
    return reply.send(goal)
  })

  // PATCH /api/v1/goals/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const snap = await db.collection('goals').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Goal not found' })
      await db.collection('goals').doc(id).update({ ...result.data, updatedAt: now() })
      return reply.send(toDoc(await db.collection('goals').doc(id).get()))
    },
  )

  // DELETE /api/v1/goals/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('goals').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Goal not found' })
      await db.collection('goals').doc(id).delete()
      return reply.status(204).send()
    },
  )
}
