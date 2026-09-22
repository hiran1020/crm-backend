import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, pagedList, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { writeAudit } from '../lib/audit.js'

const createBody = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  contractValue: z.number().min(0),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  status: z.enum(['upcoming', 'in_negotiation', 'renewed', 'churned', 'at_risk']).default('upcoming'),
  owner: z.string().min(1),
  probability: z.number().int().min(0).max(100).default(50),
  notes: z.string().optional(),
  lastContactDate: z.string().optional(),
})

const updateBody = createBody.partial()

export async function renewalsRoutes(app: FastifyInstance) {
  // GET /api/v1/renewals
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    let query = db.collection('renewals') as FirebaseFirestore.Query
    const hasFilters = !!(q.customerId || q.status || q.owner)
    if (q.customerId) query = query.where('customerId', '==', q.customerId)
    if (q.status)     query = query.where('status', '==', q.status)
    if (q.owner)      query = query.where('owner', '==', q.owner)

    let { data, total } = await pagedList({
      query,
      hasFilters,
      orderField: 'renewalDate',
      orderDir: 'asc',
      page,
      pageSize,
    })

    if (q.dueDays) {
      const days = parseInt(q.dueDays, 10)
      const today = new Date().toISOString().slice(0, 10)
      const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      data = data.filter(r => {
        const rd = String((r as Record<string, unknown>).renewalDate ?? '')
        return rd >= today && rd <= cutoff
      })
      total = data.length
    }

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/renewals
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const docRef = db.collection('renewals').doc()
    const renewal = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await docRef.set(renewal)
    writeAudit({ entityType: 'renewal', entityId: docRef.id, action: 'created', actorId: request.user.id, after: result.data })
    return reply.status(201).send(renewal)
  })

  // GET /api/v1/renewals/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('renewals').doc(id).get()
    const renewal = toDoc(snap)
    if (!renewal) return reply.status(404).send({ error: 'Renewal not found' })
    return reply.send(renewal)
  })

  // PATCH /api/v1/renewals/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('renewals').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Renewal not found' })
    const before = snap.data()
    await db.collection('renewals').doc(id).update({ ...result.data, updatedAt: now() })
    writeAudit({ entityType: 'renewal', entityId: id, action: 'updated', actorId: request.user.id, before, after: result.data })
    return reply.send(toDoc(await db.collection('renewals').doc(id).get()))
  })

  // DELETE /api/v1/renewals/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('renewals').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Renewal not found' })
    const before = snap.data()
    await db.collection('renewals').doc(id).delete()
    writeAudit({ entityType: 'renewal', entityId: id, action: 'deleted', actorId: request.user.id, before })
    return reply.status(204).send()
  })
}
