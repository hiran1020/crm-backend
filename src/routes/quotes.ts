import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, countQuery, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { writeAudit } from '../lib/audit.js'

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0),
  total: z.number().min(0),
})

const createBody = z.object({
  dealId: z.string().optional(),
  dealTitle: z.string().optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  status: z.enum(['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired']).default('Draft'),
  validUntil: z.string().datetime({ offset: true }).optional(),
  notes: z.string().optional(),
  subtotal: z.number().min(0),
  tax: z.number().min(0).default(0),
  total: z.number().min(0),
  lineItems: z.array(lineItemSchema).min(1),
})

const updateBody = createBody.partial()

export async function quotesRoutes(app: FastifyInstance) {
  // GET /api/v1/quotes
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    let query = db.collection('quotes') as FirebaseFirestore.Query
    if (q.status)     query = query.where('status', '==', q.status)
    if (q.dealId)     query = query.where('dealId', '==', q.dealId)
    if (q.customerId) query = query.where('customerId', '==', q.customerId)

    const total = await countQuery(query)
    const snap = await query.orderBy('createdAt', 'desc').offset((page - 1) * pageSize).limit(pageSize).get()

    return reply.send({ data: toDocs(snap), total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/quotes
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const docRef = db.collection('quotes').doc()
    const quote = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await docRef.set(quote)
    writeAudit({ entityType: 'quote', entityId: docRef.id, action: 'created', actorId: request.user.id, after: result.data })
    return reply.status(201).send(quote)
  })

  // GET /api/v1/quotes/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('quotes').doc(id).get()
    const quote = toDoc(snap)
    if (!quote) return reply.status(404).send({ error: 'Quote not found' })
    return reply.send(quote)
  })

  // PATCH /api/v1/quotes/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('quotes').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Quote not found' })
    const before = snap.data()
    await db.collection('quotes').doc(id).update({ ...result.data, updatedAt: now() })
    const updated = toDoc(await db.collection('quotes').doc(id).get())
    writeAudit({ entityType: 'quote', entityId: id, action: 'updated', actorId: request.user.id, before, after: result.data })
    return reply.send(updated)
  })

  // DELETE /api/v1/quotes/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('quotes').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Quote not found' })
    const before = snap.data()
    await db.collection('quotes').doc(id).delete()
    writeAudit({ entityType: 'quote', entityId: id, action: 'deleted', actorId: request.user.id, before })
    return reply.status(204).send()
  })

  // POST /api/v1/quotes/:id/send
  app.post('/:id/send', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('quotes').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Quote not found' })
    await db.collection('quotes').doc(id).update({ status: 'Sent', updatedAt: now() })
    return reply.send(toDoc(await db.collection('quotes').doc(id).get()))
  })

  // POST /api/v1/quotes/:id/accept
  app.post('/:id/accept', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('quotes').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Quote not found' })
    await db.collection('quotes').doc(id).update({ status: 'Accepted', updatedAt: now() })
    return reply.send(toDoc(await db.collection('quotes').doc(id).get()))
  })

  // POST /api/v1/quotes/:id/reject
  app.post('/:id/reject', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('quotes').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Quote not found' })
    await db.collection('quotes').doc(id).update({ status: 'Rejected', updatedAt: now() })
    return reply.send(toDoc(await db.collection('quotes').doc(id).get()))
  })
}
