import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { addClient, removeClient } from '../lib/sse.js'

const createBody = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  type: z.string().min(1),
  link: z.string().optional(),
})

export async function notificationsRoutes(app: FastifyInstance) {
  // GET /api/v1/notifications
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const skip = (page - 1) * pageSize

    const userId = request.user.id
    const where = {
      userId,
      ...(q.unreadOnly === 'true' ? { read: false } : {}),
    }

    const [data, total, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, read: false } }),
    ])

    return reply.send({ data, total, unreadCount, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/notifications (internal / admin use — create for a specific user)
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as { userId?: string } & Record<string, unknown>
    const targetUserId = body.userId ?? request.user.id
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    try {
      const notification = await prisma.notification.create({
        data: { userId: targetUserId, ...result.data },
      })
      return reply.status(201).send(notification)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // PATCH /api/v1/notifications/:id/read
  app.patch('/:id/read', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }

    try {
      const notification = await prisma.notification.update({
        where: { id, userId: request.user.id },
        data: { read: true },
      })
      return reply.send(notification)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // POST /api/v1/notifications/read-all
  app.post('/read-all', { preHandler: authenticate }, async (request, reply) => {
    await prisma.notification.updateMany({
      where: { userId: request.user.id, read: false },
      data: { read: true },
    })
    return reply.send({ message: 'All notifications marked as read' })
  })

  // GET /api/v1/notifications/stream  — SSE endpoint for real-time notification push
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

    // Flush unread count on connect
    const unread = await prisma.notification.count({ where: { userId, read: false } })
    reply.raw.write(`event: unread_count\ndata: ${JSON.stringify({ count: unread })}\n\n`)

    const keepAlive = setInterval(() => {
      try { reply.raw.write(':heartbeat\n\n') } catch { clearInterval(keepAlive) }
    }, 25_000)

    request.raw.on('close', () => {
      clearInterval(keepAlive)
      removeClient(userId, reply.raw)
    })

    // Prevent Fastify from auto-closing the response
    await new Promise<void>(resolve => request.raw.on('close', resolve))
  })

  // DELETE /api/v1/notifications/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await prisma.notification.delete({ where: { id, userId: request.user.id } })
      return reply.status(204).send()
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
