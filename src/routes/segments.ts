import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { EntityType, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in']),
  value: z.unknown(),
})

const criteriaSchema = z.object({
  conditions: z.array(conditionSchema).min(1),
  logic: z.enum(['AND', 'OR']).default('AND'),
})

const createBody = z.object({
  name: z.string().trim().min(1),
  entityType: z.enum(['customer', 'lead', 'deal']),
  criteria: criteriaSchema,
})

const updateBody = createBody.partial()

// Translate a segment condition to a Prisma where clause fragment
function conditionToWhere(cond: z.infer<typeof conditionSchema>): Record<string, unknown> {
  const { field, op, value } = cond
  switch (op) {
    case 'eq':      return { [field]: { equals: value } }
    case 'ne':      return { [field]: { not: value } }
    case 'contains': return { [field]: { contains: value, mode: 'insensitive' } }
    case 'gt':      return { [field]: { gt: value } }
    case 'gte':     return { [field]: { gte: value } }
    case 'lt':      return { [field]: { lt: value } }
    case 'lte':     return { [field]: { lte: value } }
    case 'in':      return { [field]: { in: value as unknown[] } }
    case 'not_in':  return { [field]: { notIn: value as unknown[] } }
    default:        return {}
  }
}

function criteriaToWhere(criteria: z.infer<typeof criteriaSchema>) {
  const clauses = criteria.conditions.map(conditionToWhere)
  return criteria.logic === 'OR' ? { OR: clauses } : { AND: clauses }
}

async function evaluateCriteria(entityType: EntityType, criteria: z.infer<typeof criteriaSchema>): Promise<number> {
  const where = criteriaToWhere(criteria)
  switch (entityType) {
    case 'customer': return prisma.customer.count({ where: where as Prisma.CustomerWhereInput })
    case 'lead':     return prisma.lead.count({ where: where as Prisma.LeadWhereInput })
    case 'deal':     return prisma.deal.count({ where: where as Prisma.DealWhereInput })
  }
}

export async function segmentsRoutes(app: FastifyInstance) {
  // GET /api/v1/segments
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const where: Prisma.SegmentWhereInput = {}
    if (q.entityType) where.entityType = q.entityType as EntityType

    const segments = await prisma.segment.findMany({ where, orderBy: { name: 'asc' } })
    return reply.send({ data: segments })
  })

  // POST /api/v1/segments
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const { criteria, ...rest } = result.data
      const matchCount = await evaluateCriteria(rest.entityType, criteria)
      try {
        const segment = await prisma.segment.create({
          data: { ...rest, criteria: criteria as object, matchCount },
        })
        return reply.status(201).send(segment)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/segments/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const segment = await prisma.segment.findUnique({ where: { id } })
    if (!segment) return reply.status(404).send({ error: 'Segment not found' })
    return reply.send(segment)
  })

  // PATCH /api/v1/segments/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }

      const existing = await prisma.segment.findUnique({ where: { id } })
      if (!existing) return reply.status(404).send({ error: 'Segment not found' })

      const { criteria, entityType, ...rest } = result.data
      const resolvedEntityType = (entityType ?? existing.entityType) as EntityType
      const resolvedCriteria = criteria ?? (existing.criteria as z.infer<typeof criteriaSchema>)
      const matchCount = await evaluateCriteria(resolvedEntityType, resolvedCriteria)

      try {
        const segment = await prisma.segment.update({
          where: { id },
          data: { ...rest, ...(criteria && { criteria: criteria as object }), matchCount },
        })
        return reply.send(segment)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // DELETE /api/v1/segments/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        await prisma.segment.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // POST /api/v1/segments/:id/evaluate  — recount matches and update matchCount
  app.post('/:id/evaluate', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const segment = await prisma.segment.findUnique({ where: { id } })
    if (!segment) return reply.status(404).send({ error: 'Segment not found' })

    const criteria = segment.criteria as z.infer<typeof criteriaSchema>
    const matchCount = await evaluateCriteria(segment.entityType as EntityType, criteria)

    const updated = await prisma.segment.update({ where: { id }, data: { matchCount } })
    return reply.send(updated)
  })
}
