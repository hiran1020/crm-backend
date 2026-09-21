import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ActivityType, RelatedType, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'

const createBody = z.object({
  type: z.enum(['call', 'email', 'meeting', 'note', 'task']),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  owner: z.string().min(1),
  completed: z.boolean().default(false),
  dueDate: z.string().datetime({ offset: true }).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  relatedTo: z.string().uuid(),
  relatedType: z.enum(['customer', 'lead', 'deal']),
  relatedName: z.string().trim().min(1),
})

const updateBody = createBody.partial()

export async function activitiesRoutes(app: FastifyInstance) {
  // GET /api/v1/activities
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const skip = (page - 1) * pageSize

    const where: Prisma.ActivityWhereInput = {}
    if (q.relatedTo) where.relatedTo = q.relatedTo
    if (q.relatedType) where.relatedType = q.relatedType as RelatedType
    if (q.type) where.type = q.type as ActivityType
    if (q.owner) where.owner = q.owner
    if (q.completed !== undefined) where.completed = q.completed === 'true'

    const orderBy: Prisma.ActivityOrderByWithRelationInput =
      q.sortBy === 'dueDate' ? { dueDate: (q.sortDir as Prisma.SortOrder) ?? 'asc' }
        : { createdAt: 'desc' }

    const [data, total] = await prisma.$transaction([
      prisma.activity.findMany({ where, skip, take: pageSize, orderBy }),
      prisma.activity.count({ where }),
    ])

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/activities
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const data = {
      ...result.data,
      dueDate: result.data.dueDate ? new Date(result.data.dueDate) : undefined,
    }

    try {
      const activity = await prisma.activity.create({ data })
      return reply.status(201).send(activity)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/activities/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const activity = await prisma.activity.findUnique({ where: { id } })
    if (!activity) return reply.status(404).send({ error: 'Activity not found' })
    return reply.send(activity)
  })

  // PATCH /api/v1/activities/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const data: Prisma.ActivityUpdateInput = {
      ...result.data,
      dueDate: result.data.dueDate !== undefined
        ? result.data.dueDate ? new Date(result.data.dueDate) : null
        : undefined,
    }

    try {
      const activity = await prisma.activity.update({ where: { id }, data })
      return reply.send(activity)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // DELETE /api/v1/activities/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await prisma.activity.delete({ where: { id } })
      return reply.status(204).send()
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
