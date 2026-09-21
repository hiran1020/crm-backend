import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, pagedList, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
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
    const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    // Email is a unique field — return the single match directly without ordering.
    if (q.email) {
      const snap = await db.collection('customers').where('email', '==', q.email).get()
      const data = toDocs(snap)
      return reply.send({ data, total: data.length, page: 1, pageSize: data.length, totalPages: 1 })
    }

    let query = db.collection('customers') as FirebaseFirestore.Query
    const hasFilters = !!(q.status || q.ownerId || q.tagId)
    if (q.status)  query = query.where('status', '==', q.status)
    if (q.ownerId) query = query.where('ownerId', '==', q.ownerId)
    if (q.tagId)   query = query.where('tagIds', 'array-contains', q.tagId)

    const searchTerm = q.search?.toLowerCase()
    const inMemoryFilter = searchTerm
      ? (c: Record<string, unknown>) =>
          String(c.firstName ?? '').toLowerCase().includes(searchTerm) ||
          String(c.lastName ?? '').toLowerCase().includes(searchTerm) ||
          String(c.email ?? '').toLowerCase().includes(searchTerm) ||
          String(c.company ?? '').toLowerCase().includes(searchTerm)
      : undefined

    // customers are ordered by lastName; for filtered queries sort in memory, no composite index needed
    const { data, total } = await pagedList({
      query, hasFilters, orderField: 'lastName', orderDir: 'asc', page, pageSize, inMemoryFilter,
    })

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
    const updatedAt = new Date().toISOString()
    await db.collection('customers').doc(id).update({ ...result.data, updatedAt: now() })
    writeAudit({ entityType: 'customer', entityId: id, action: 'updated', actorId: request.user.id, before, after: result.data })
    return reply.send({ id, ...snap.data(), ...result.data, updatedAt })
  })

  // DELETE /api/v1/customers/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('customers').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Customer not found' })
    const before = snap.data()
    await db.collection('customers').doc(id).delete()
    writeAudit({ entityType: 'customer', entityId: id, action: 'deleted', actorId: request.user.id, before })
    return reply.status(204).send()
  })

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
