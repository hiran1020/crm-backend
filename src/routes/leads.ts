import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, countQuery, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { writeAudit } from '../lib/audit.js'

const createBody = z.object({
  name: z.string().trim().min(1),
  company: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  source: z.enum(['Website', 'Referral', 'Trade_Show', 'Cold_Call', 'Email_Campaign', 'Social_Media', 'Partner']),
  status: z.enum(['New', 'Contacted', 'Qualified', 'Lost', 'Converted']).default('New'),
  value: z.number().min(0),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  ownerInitials: z.string().min(1),
  notes: z.string().optional(),
  tagIds: z.array(z.string()).optional().default([]),
})

const updateBody = createBody.partial()

const convertBody = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().optional(),
  jobTitle: z.string().trim().optional(),
  ownerId: z.string().optional(),
  ownerName: z.string().optional(),
  ownerInitials: z.string().optional(),
})

export async function leadsRoutes(app: FastifyInstance) {
  // GET /api/v1/leads
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

    let query = db.collection('leads') as FirebaseFirestore.Query
    if (q.status)  query = query.where('status', '==', q.status)
    if (q.source)  query = query.where('source', '==', q.source)
    if (q.ownerId) query = query.where('ownerId', '==', q.ownerId)
    if (q.tagId)   query = query.where('tagIds', 'array-contains', q.tagId)

    const total = await countQuery(query)
    const snap = await query.orderBy('createdAt', 'desc').offset((page - 1) * pageSize).limit(pageSize).get()
    let data = toDocs(snap)

    if (q.search) {
      const s = q.search.toLowerCase()
      data = data.filter(l =>
        l.name?.toLowerCase().includes(s) ||
        l.email?.toLowerCase().includes(s) ||
        l.company?.toLowerCase().includes(s),
      )
    }

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/leads
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const docRef = db.collection('leads').doc()
    const lead = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
    await docRef.set(lead)
    writeAudit({ entityType: 'lead', entityId: docRef.id, action: 'created', actorId: request.user.id, after: result.data })
    return reply.status(201).send(lead)
  })

  // GET /api/v1/leads/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('leads').doc(id).get()
    const lead = toDoc(snap)
    if (!lead) return reply.status(404).send({ error: 'Lead not found' })
    return reply.send(lead)
  })

  // PATCH /api/v1/leads/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const snap = await db.collection('leads').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Lead not found' })
    const before = snap.data()
    await db.collection('leads').doc(id).update({ ...result.data, updatedAt: now() })
    const updated = toDoc(await db.collection('leads').doc(id).get())
    writeAudit({ entityType: 'lead', entityId: id, action: 'updated', actorId: request.user.id, before, after: result.data })
    return reply.send(updated)
  })

  // DELETE /api/v1/leads/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('leads').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Lead not found' })
      const before = snap.data()
      await db.collection('leads').doc(id).delete()
      writeAudit({ entityType: 'lead', entityId: id, action: 'deleted', actorId: request.user.id, before })
      return reply.status(204).send()
    },
  )

  // POST /api/v1/leads/:id/convert
  app.post('/:id/convert', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = convertBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const leadSnap = await db.collection('leads').doc(id).get()
    if (!leadSnap.exists) return reply.status(404).send({ error: 'Lead not found' })
    const lead = leadSnap.data()!
    if (lead.status === 'Converted') return reply.status(409).send({ error: 'Lead already converted' })

    const { firstName, lastName, phone, jobTitle, ownerId, ownerName, ownerInitials } = result.data
    const customerRef = db.collection('customers').doc()
    const customer = {
      id: customerRef.id,
      firstName,
      lastName,
      email: lead.email,
      phone: phone ?? lead.phone ?? '',
      company: lead.company,
      jobTitle: jobTitle ?? '',
      status: 'Active',
      ownerId: ownerId ?? lead.ownerId,
      ownerName: ownerName ?? lead.ownerName,
      ownerInitials: ownerInitials ?? lead.ownerInitials,
      tagIds: [],
      createdAt: now(),
      updatedAt: now(),
    }

    const batch = db.batch()
    batch.set(customerRef, customer)
    batch.update(db.collection('leads').doc(id), { status: 'Converted', updatedAt: now() })
    await batch.commit()

    return reply.status(201).send(customer)
  })

  // GET /api/v1/leads/:id/activities
  app.get('/:id/activities', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('activities')
      .where('relatedTo', '==', id).where('relatedType', '==', 'lead')
      .orderBy('createdAt', 'desc').get()
    return reply.send({ data: toDocs(snap) })
  })
}
