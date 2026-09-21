import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, countQuery, now } from '../lib/firebase.js'
import { handleFirestoreError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { writeAudit } from '../lib/audit.js'

const createBody = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  company: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  ownerInitials: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  tagIds: z.array(z.string()).optional().default([]),
})

const updateBody = createBody.partial()

export async function customersRoutes(app: FastifyInstance) {
  // GET /api/v1/customers
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    let query = db.collection('customers') as FirebaseFirestore.Query
    if (q.status)  query = query.where('status', '==', q.status)
    if (q.ownerId) query = query.where('ownerId', '==', q.ownerId)
    if (q.tagId)   query = query.where('tagIds', 'array-contains', q.tagId)

    const total = await countQuery(query)
    const snap = await query.orderBy('lastName').offset((page - 1) * pageSize).limit(pageSize).get()
    let data = toDocs(snap)

    if (q.search) {
      const s = q.search.toLowerCase()
      data = data.filter(c =>
        c.firstName?.toLowerCase().includes(s) ||
        c.lastName?.toLowerCase().includes(s) ||
        c.email?.toLowerCase().includes(s) ||
        c.company?.toLowerCase().includes(s),
      )
    }

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/customers
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const docRef = db.collection('customers').doc()
    const customer = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await docRef.set(customer)
    writeAudit({ entityType: 'customer', entityId: docRef.id, action: 'created', actorId: request.user.id, after: result.data })
    return reply.status(201).send(customer)
  })

  // GET /api/v1/customers/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('customers').doc(id).get()
    const customer = toDoc(snap)
    if (!customer) return reply.status(404).send({ error: 'Customer not found' })
    return reply.send(customer)
  })

  // PATCH /api/v1/customers/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('customers').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Customer not found' })
    const before = snap.data()
    await db.collection('customers').doc(id).update({ ...result.data, updatedAt: now() })
    const updated = toDoc(await db.collection('customers').doc(id).get())
    writeAudit({ entityType: 'customer', entityId: id, action: 'updated', actorId: request.user.id, before, after: result.data })
    return reply.send(updated)
  })

  // DELETE /api/v1/customers/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('customers').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Customer not found' })
      const before = snap.data()
      await db.collection('customers').doc(id).delete()
      writeAudit({ entityType: 'customer', entityId: id, action: 'deleted', actorId: request.user.id, before })
      return reply.status(204).send()
    },
  )

  // GET /api/v1/customers/:id/deals
  app.get('/:id/deals', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('deals').where('customerId', '==', id).orderBy('createdAt', 'desc').get()
    return reply.send({ data: toDocs(snap) })
  })

  // GET /api/v1/customers/:id/activities
  app.get('/:id/activities', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('activities')
      .where('relatedTo', '==', id).where('relatedType', '==', 'customer')
      .orderBy('createdAt', 'desc').get()
    return reply.send({ data: toDocs(snap) })
  })
}
