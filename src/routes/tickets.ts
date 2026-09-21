import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { TicketStatus, TicketPriority, TicketChannel, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'

const ticketInclude = {
  customer: { select: { id: true, firstName: true, lastName: true, company: true } },
  assignee: { select: { id: true, name: true, avatarInitials: true } },
} satisfies Prisma.TicketInclude

const createBody = z.object({
  subject: z.string().trim().min(1),
  customerId: z.string().uuid().optional(),
  status: z.enum(['Open', 'In_Progress', 'Resolved', 'Closed']).default('Open'),
  priority: z.enum(['Low', 'Medium', 'High', 'Critical']).default('Medium'),
  assigneeId: z.string().uuid().optional(),
  channel: z.enum(['email', 'phone', 'chat', 'web']).optional(),
  tags: z.array(z.string()).optional(),
})

const updateBody = createBody.partial()

const statusBody = z.object({
  status: z.enum(['Open', 'In_Progress', 'Resolved', 'Closed']),
})

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
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const skip = (page - 1) * pageSize

    const where: Prisma.TicketWhereInput = {}
    if (q.search) where.subject = { contains: q.search, mode: 'insensitive' }
    if (q.status) where.status = q.status as TicketStatus
    if (q.priority) where.priority = q.priority as TicketPriority
    if (q.channel) where.channel = q.channel as TicketChannel
    if (q.assigneeId) where.assigneeId = q.assigneeId
    if (q.customerId) where.customerId = q.customerId

    const orderBy: Prisma.TicketOrderByWithRelationInput =
      q.sortBy === 'priority' ? { priority: (q.sortDir as Prisma.SortOrder) ?? 'desc' }
        : { createdAt: 'desc' }

    const [data, total] = await prisma.$transaction([
      prisma.ticket.findMany({ where, include: ticketInclude, skip, take: pageSize, orderBy }),
      prisma.ticket.count({ where }),
    ])

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/tickets
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    try {
      const ticket = await prisma.ticket.create({ data: result.data, include: ticketInclude })
      return reply.status(201).send(ticket)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/tickets/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { ...ticketInclude, comments: { orderBy: { createdAt: 'asc' } } },
    })
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })
    return reply.send(ticket)
  })

  // PATCH /api/v1/tickets/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    try {
      const ticket = await prisma.ticket.update({ where: { id }, data: result.data, include: ticketInclude })
      return reply.send(ticket)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // DELETE /api/v1/tickets/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await prisma.ticket.delete({ where: { id } })
      return reply.status(204).send()
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // PATCH /api/v1/tickets/:id/status
  app.patch('/:id/status', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = statusBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    try {
      const ticket = await prisma.ticket.update({
        where: { id },
        data: { status: result.data.status },
        include: ticketInclude,
      })
      return reply.send(ticket)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // POST /api/v1/tickets/:id/comments
  app.post('/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = commentBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true } })
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })

    try {
      const comment = await prisma.ticketComment.create({
        data: { ticketId: id, ...result.data },
      })
      return reply.status(201).send(comment)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/tickets/:id/comments
  app.get('/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true } })
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })

    const comments = await prisma.ticketComment.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'asc' },
    })
    return reply.send({ data: comments })
  })
}
