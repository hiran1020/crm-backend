import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, countQuery, now, FieldValue } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { addClient, removeClient } from '../lib/sse.js'

const createBody = z.object({
  userId: z.string().optional(),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  type: z.string().min(1),
  link: z.string().optional(),
})

export async function notificationsRoutes(app: FastifyInstance) {
  // GET /api/v1/notifications/stream — SSE
  app.get('/stream', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(':connected\n\n')
    addClient(userId, reply.raw)

    const unreadSnap = await db.collection('notifications').doc(userId)
      .collection('items').where('read', '==', false).count().get()
    reply.raw.write(`event: unread_count\ndata: ${JSON.stringify({ count: unreadSnap.data().count })}\n\n`)

    const keepAlive = setInterval(() => {
      try { reply.raw.write(':heartbeat\n\n') } catch { clearInterval(keepAlive) }
    }, 25_000)

    request.raw.on('close', () => { clearInterval(keepAlive); removeClient(userId, reply.raw) })
    await new Promise<void>(resolve => request.raw.on('close', resolve))
  })

  // GET /api/v1/notifications
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const userId = request.user.id

    let query = db.collection('notifications').doc(userId).collection('items') as FirebaseFirestore.Query
    if (q.unreadOnly === 'true') query = query.where('read', '==', false)

    const total = await countQuery(query)
    const unreadCount = await db.collection('notifications').doc(userId)
      .collection('items').where('read', '==', false).count().get()
    const snap = await query.orderBy('createdAt', 'desc').offset((page - 1) * pageSize).limit(pageSize).get()

    return reply.send({
      data: toDocs(snap),
      total,
      unreadCount: unreadCount.data().count,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  })

  // POST /api/v1/notifications
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const targetUserId = result.data.userId ?? request.user.id
    const { userId: _, ...notifData } = result.data
    const docRef = db.collection('notifications').doc(targetUserId).collection('items').doc()
    const notification = { id: docRef.id, ...notifData, read: false, createdAt: now() }
    await docRef.set(notification)
    return reply.status(201).send(notification)
  })

  // PATCH /api/v1/notifications/:id/read
  app.patch('/:id/read', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user.id
    const ref = db.collection('notifications').doc(userId).collection('items').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return reply.status(404).send({ error: 'Notification not found' })
    await ref.update({ read: true })
    return reply.send(toDoc(await ref.get()))
  })

  // POST /api/v1/notifications/read-all
  app.post('/read-all', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id
    const snap = await db.collection('notifications').doc(userId)
      .collection('items').where('read', '==', false).get()
    const batch = db.batch()
    snap.docs.forEach(d => batch.update(d.ref, { read: true }))
    await batch.commit()
    return reply.send({ message: 'All notifications marked as read' })
  })

  // DELETE /api/v1/notifications/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user.id
    const ref = db.collection('notifications').doc(userId).collection('items').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return reply.status(404).send({ error: 'Notification not found' })
    await ref.delete()
    return reply.status(204).send()
  })
}
