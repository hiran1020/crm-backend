import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DealStage, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { writeAudit } from '../lib/audit.js'

const dealInclude = {
  owner: { select: { id: true, name: true, avatarInitials: true } },
  customer: { select: { id: true, firstName: true, lastName: true, company: true } },
} satisfies Prisma.DealInclude

const createBody = z.object({
  title: z.string().trim().min(1),
  customerId: z.string().uuid(),
  amount: z.number().min(0),
  stage: z.enum(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']).default('New'),
  ownerId: z.string().uuid(),
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
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const skip = (page - 1) * pageSize

    const where: Prisma.DealWhereInput = {}
    if (q.search) {
      where.OR = [
        { title: { contains: q.search, mode: 'insensitive' } },
        { customer: { company: { contains: q.search, mode: 'insensitive' } } },
      ]
    }
    if (q.stage) where.stage = q.stage as DealStage
    if (q.ownerId) where.ownerId = q.ownerId
    if (q.customerId) where.customerId = q.customerId

    const orderBy: Prisma.DealOrderByWithRelationInput =
      q.sortBy === 'amount' ? { amount: (q.sortDir as Prisma.SortOrder) ?? 'desc' }
        : q.sortBy === 'expectedCloseDate' ? { expectedCloseDate: (q.sortDir as Prisma.SortOrder) ?? 'asc' }
        : { createdAt: 'desc' }

    const [data, total] = await prisma.$transaction([
      prisma.deal.findMany({ where, include: dealInclude, skip, take: pageSize, orderBy }),
      prisma.deal.count({ where }),
    ])

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/deals
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    try {
      const deal = await prisma.deal.create({ data: result.data, include: dealInclude })
      writeAudit({ entityType: 'deal', entityId: deal.id, action: 'created', actorId: request.user.id, after: deal })
      return reply.status(201).send(deal)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/deals/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deal = await prisma.deal.findUnique({ where: { id }, include: dealInclude })
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

    try {
      const existing = await prisma.deal.findUnique({ where: { id } })
      const deal = await prisma.deal.update({ where: { id }, data: result.data, include: dealInclude })
      writeAudit({ entityType: 'deal', entityId: id, action: 'updated', actorId: request.user.id, before: existing, after: deal })
      return reply.send(deal)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // DELETE /api/v1/deals/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        await prisma.deal.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // PATCH /api/v1/deals/:id/stage
  app.patch('/:id/stage', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = stageBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    try {
      const existing = await prisma.deal.findUnique({ where: { id } })
      const deal = await prisma.deal.update({
        where: { id },
        data: { stage: result.data.stage },
        include: dealInclude,
      })
      writeAudit({ entityType: 'deal', entityId: id, action: 'updated', actorId: request.user.id, before: existing, after: deal })
      return reply.send(deal)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/deals/:id/activities
  app.get('/:id/activities', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deal = await prisma.deal.findUnique({ where: { id }, select: { id: true } })
    if (!deal) return reply.status(404).send({ error: 'Deal not found' })

    const activities = await prisma.activity.findMany({
      where: { relatedTo: id, relatedType: 'deal' },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ data: activities })
  })
}
