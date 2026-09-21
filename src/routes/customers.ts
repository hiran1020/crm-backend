import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { CustomerStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { writeAudit } from '../lib/audit.js'

const customerInclude = {
  owner: { select: { id: true, name: true, avatarInitials: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.CustomerInclude

const createBody = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  company: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  ownerId: z.string().uuid(),
  avatarUrl: z.string().url().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
})

const updateBody = createBody.partial()

export async function customersRoutes(app: FastifyInstance) {
  // GET /api/v1/customers
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const skip = (page - 1) * pageSize

    const where: Prisma.CustomerWhereInput = {}
    if (q.search) {
      where.OR = [
        { firstName: { contains: q.search, mode: 'insensitive' } },
        { lastName: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { company: { contains: q.search, mode: 'insensitive' } },
      ]
    }
    if (q.status) where.status = q.status as CustomerStatus
    if (q.ownerId) where.ownerId = q.ownerId
    if (q.tagId) where.tags = { some: { tagId: q.tagId } }

    const orderBy: Prisma.CustomerOrderByWithRelationInput =
      q.sortBy === 'company' ? { company: (q.sortDir as Prisma.SortOrder) ?? 'asc' }
        : q.sortBy === 'createdAt' ? { createdAt: (q.sortDir as Prisma.SortOrder) ?? 'desc' }
        : { lastName: 'asc' }

    const [data, total] = await prisma.$transaction([
      prisma.customer.findMany({ where, include: customerInclude, skip, take: pageSize, orderBy }),
      prisma.customer.count({ where }),
    ])

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/customers
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const { tagIds, ...fields } = result.data

    try {
      const customer = await prisma.customer.create({
        data: {
          ...fields,
          tags: tagIds?.length
            ? { create: tagIds.map(tagId => ({ tagId })) }
            : undefined,
        },
        include: customerInclude,
      })
      writeAudit({ entityType: 'customer', entityId: customer.id, action: 'created', actorId: request.user.id, after: customer })
      return reply.status(201).send(customer)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/customers/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const customer = await prisma.customer.findUnique({ where: { id }, include: customerInclude })
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
    const { tagIds, ...fields } = result.data

    const existing = await prisma.customer.findUnique({ where: { id } })
    try {
      const customer = await prisma.customer.update({
        where: { id },
        data: {
          ...fields,
          ...(tagIds !== undefined && {
            tags: {
              deleteMany: {},
              create: tagIds.map(tagId => ({ tagId })),
            },
          }),
        },
        include: customerInclude,
      })
      writeAudit({ entityType: 'customer', entityId: id, action: 'updated', actorId: request.user.id, before: existing, after: customer })
      return reply.send(customer)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // DELETE /api/v1/customers/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const customer = await prisma.customer.delete({ where: { id } })
        writeAudit({ entityType: 'customer', entityId: id, action: 'deleted', actorId: request.user.id, before: customer })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/customers/:id/deals
  app.get('/:id/deals', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } })
    if (!customer) return reply.status(404).send({ error: 'Customer not found' })

    const deals = await prisma.deal.findMany({
      where: { customerId: id },
      include: { owner: { select: { id: true, name: true, avatarInitials: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ data: deals })
  })

  // GET /api/v1/customers/:id/activities
  app.get('/:id/activities', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } })
    if (!customer) return reply.status(404).send({ error: 'Customer not found' })

    const activities = await prisma.activity.findMany({
      where: { relatedTo: id, relatedType: 'customer' },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ data: activities })
  })
}
