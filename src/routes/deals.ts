import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, pagedList, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { writeAudit } from '../lib/audit.js'

const createBody = z.object({
  title: z.string().trim().min(1),
  customerId: z.string().min(1),
  customerName: z.string().min(1),     // denormalized
  customerCompany: z.string().min(1),  // denormalized
  amount: z.number().min(0),
  stage: z.enum(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']).default('New'),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  ownerInitials: z.string().min(1),
  expectedCloseDate: z.string().min(1),
  description: z.string().optional(),
  probability: z.number().int().min(0).max(100).optional(),
})

const updateBody = createBody.partial()

const stageBody = z.object({
  stage: z.enum(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']),
})

export async function dealsRoutes(app: FastifyInstance) {
  // GET /api/v1/deals
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    let query = db.collection('deals') as FirebaseFirestore.Query
    const hasFilters = !!(q.stage || q.ownerId || q.customerId)
    if (q.stage)      query = query.where('stage', '==', q.stage)
    if (q.ownerId)    query = query.where('ownerId', '==', q.ownerId)
    if (q.customerId) query = query.where('customerId', '==', q.customerId)

    let { data, total } = await pagedList({ query, hasFilters, orderField: 'createdAt', page, pageSize })

    if (q.search) {
      const s = q.search.toLowerCase()
      data = data.filter((d: Record<string, unknown>) =>
        String(d.title ?? '').toLowerCase().includes(s) ||
        String(d.customerCompany ?? '').toLowerCase().includes(s),
      )
    }

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/deals
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const docRef = db.collection('deals').doc()
    const deal = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await docRef.set(deal)
    writeAudit({ entityType: 'deal', entityId: docRef.id, action: 'created', actorId: request.user.id, after: result.data })
    return reply.status(201).send(deal)
  })

  // GET /api/v1/deals/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('deals').doc(id).get()
    const deal = toDoc(snap)
    if (!deal) return reply.status(404).send({ error: 'Deal not found' })
    return reply.send(deal)
  })

  // PATCH /api/v1/deals/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('deals').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Deal not found' })
    const before = snap.data()
    await db.collection('deals').doc(id).update({ ...result.data, updatedAt: now() })
    const updated = toDoc(await db.collection('deals').doc(id).get())
    writeAudit({ entityType: 'deal', entityId: id, action: 'updated', actorId: request.user.id, before, after: result.data })
    return reply.send(updated)
  })

  // DELETE /api/v1/deals/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('deals').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Deal not found' })
      const before = snap.data()
      await db.collection('deals').doc(id).delete()
      writeAudit({ entityType: 'deal', entityId: id, action: 'deleted', actorId: request.user.id, before })
      return reply.status(204).send()
    },
  )

  // PATCH /api/v1/deals/:id/stage
  app.patch('/:id/stage', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = stageBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('deals').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Deal not found' })
    const before = snap.data()
    await db.collection('deals').doc(id).update({ stage: result.data.stage, updatedAt: now() })
    const updated = toDoc(await db.collection('deals').doc(id).get())
    writeAudit({ entityType: 'deal', entityId: id, action: 'updated', actorId: request.user.id, before, after: { stage: result.data.stage } })
    return reply.send(updated)
  })

  // GET /api/v1/deals/:id/activities
  app.get('/:id/activities', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('activities')
      .where('relatedTo', '==', id).where('relatedType', '==', 'deal')
      .orderBy('createdAt', 'desc').get()
    return reply.send({ data: toDocs(snap) })
  })
}
