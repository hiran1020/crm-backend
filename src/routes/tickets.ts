import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, pagedList, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'

const createBody = z.object({
  subject: z.string().trim().min(1),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  status: z.enum(['Open', 'In_Progress', 'Resolved', 'Closed']).default('Open'),
  priority: z.enum(['Low', 'Medium', 'High', 'Critical']).default('Medium'),
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  channel: z.enum(['email', 'phone', 'chat', 'web']).optional(),
  tags: z.array(z.string()).optional().default([]),
})

const updateBody = createBody.partial()

const commentBody = z.object({
  author: z.string().trim().min(1),
  body: z.string().trim().min(1),
  isInternal: z.boolean().default(false),
})

export async function ticketsRoutes(app: FastifyInstance) {
  // GET /api/v1/tickets
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    let query = db.collection('tickets') as FirebaseFirestore.Query
    const hasFilters = !!(q.status || q.priority || q.channel || q.assigneeId || q.customerId)
    if (q.status)     query = query.where('status', '==', q.status)
    if (q.priority)   query = query.where('priority', '==', q.priority)
    if (q.channel)    query = query.where('channel', '==', q.channel)
    if (q.assigneeId) query = query.where('assigneeId', '==', q.assigneeId)
    if (q.customerId) query = query.where('customerId', '==', q.customerId)

    const { data, total } = await pagedList({ query, hasFilters, orderField: 'createdAt', page, pageSize })
    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/tickets
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const docRef = db.collection('tickets').doc()
    const ticket = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await docRef.set(ticket)
    return reply.status(201).send(ticket)
  })

  // GET /api/v1/tickets/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [ticketSnap, commentsSnap] = await Promise.all([
      db.collection('tickets').doc(id).get(),
      db.collection('tickets').doc(id).collection('comments').orderBy('createdAt', 'asc').get(),
    ])
    const ticket = toDoc(ticketSnap)
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })
    return reply.send({ ...ticket, comments: toDocs(commentsSnap) })
  })

  // PATCH /api/v1/tickets/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('tickets').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Ticket not found' })
    const updatedAt = new Date().toISOString()
    await db.collection('tickets').doc(id).update({ ...result.data, updatedAt: now() })
    return reply.send({ id, ...snap.data(), ...result.data, updatedAt })
  })

  // DELETE /api/v1/tickets/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('tickets').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Ticket not found' })
    await db.collection('tickets').doc(id).delete()
    return reply.status(204).send()
  })

  // PATCH /api/v1/tickets/:id/status
  app.patch('/:id/status', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ status: z.enum(['Open', 'In_Progress', 'Resolved', 'Closed']) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid status' })
    const snap = await db.collection('tickets').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Ticket not found' })
    const updatedAt = new Date().toISOString()
    await db.collection('tickets').doc(id).update({ status: body.data.status, updatedAt: now() })
    return reply.send({ id, ...snap.data(), status: body.data.status, updatedAt })
  })

  // POST /api/v1/tickets/:id/comments
  app.post('/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = commentBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('tickets').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Ticket not found' })

    const commentRef = db.collection('tickets').doc(id).collection('comments').doc()
    const comment = { id: commentRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await commentRef.set(comment)
    return reply.status(201).send(comment)
  })

  // GET /api/v1/tickets/:id/comments
  app.get('/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('tickets').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Ticket not found' })
    const commentsSnap = await db.collection('tickets').doc(id).collection('comments').orderBy('createdAt', 'asc').get()
    return reply.send({ data: toDocs(commentsSnap) })
  })
}
