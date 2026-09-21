import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { LeadSource, LeadStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { writeAudit } from '../lib/audit.js'

const leadInclude = {
  owner: { select: { id: true, name: true, avatarInitials: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.LeadInclude

const createBody = z.object({
  name: z.string().trim().min(1),
  company: z.string().trim().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  source: z.enum(['Website', 'Referral', 'Trade_Show', 'Cold_Call', 'Email_Campaign', 'Social_Media', 'Partner']),
  status: z.enum(['New', 'Contacted', 'Qualified', 'Lost', 'Converted']).default('New'),
  value: z.number().min(0),
  ownerId: z.string().uuid(),
  notes: z.string().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
})

const updateBody = createBody.partial()

const convertBody = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().optional(),
  jobTitle: z.string().trim().optional(),
  ownerId: z.string().uuid().optional(),
})

export async function leadsRoutes(app: FastifyInstance) {
  // GET /api/v1/leads
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const skip = (page - 1) * pageSize

    const where: Prisma.LeadWhereInput = {}
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { company: { contains: q.search, mode: 'insensitive' } },
      ]
    }
    if (q.status) where.status = q.status as LeadStatus
    if (q.source) where.source = q.source as LeadSource
    if (q.ownerId) where.ownerId = q.ownerId
    if (q.tagId) where.tags = { some: { tagId: q.tagId } }

    const orderBy: Prisma.LeadOrderByWithRelationInput =
      q.sortBy === 'value' ? { value: (q.sortDir as Prisma.SortOrder) ?? 'desc' }
        : q.sortBy === 'createdAt' ? { createdAt: (q.sortDir as Prisma.SortOrder) ?? 'desc' }
        : { createdAt: 'desc' }

    const [data, total] = await prisma.$transaction([
      prisma.lead.findMany({ where, include: leadInclude, skip, take: pageSize, orderBy }),
      prisma.lead.count({ where }),
    ])

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/leads
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const { tagIds, ...fields } = result.data

    try {
      const lead = await prisma.lead.create({
        data: {
          ...fields,
          tags: tagIds?.length
            ? { create: tagIds.map(tagId => ({ tagId })) }
            : undefined,
        },
        include: leadInclude,
      })
      writeAudit({ entityType: 'lead', entityId: lead.id, action: 'created', actorId: request.user.id, after: lead })
      return reply.status(201).send(lead)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/leads/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const lead = await prisma.lead.findUnique({ where: { id }, include: leadInclude })
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
    const { tagIds, ...fields } = result.data

    try {
      const lead = await prisma.lead.update({
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
        include: leadInclude,
      })
      return reply.send(lead)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // DELETE /api/v1/leads/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        await prisma.lead.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // POST /api/v1/leads/:id/convert
  app.post('/:id/convert', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = convertBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const lead = await prisma.lead.findUnique({ where: { id } })
    if (!lead) return reply.status(404).send({ error: 'Lead not found' })
    if (lead.status === 'Converted') {
      return reply.status(409).send({ error: 'Lead already converted' })
    }

    const { firstName, lastName, phone, jobTitle, ownerId } = result.data

    const [customer] = await prisma.$transaction([
      prisma.customer.create({
        data: {
          firstName,
          lastName,
          email: lead.email,
          phone: phone ?? lead.phone ?? '',
          company: lead.company,
          jobTitle: jobTitle ?? '',
          status: 'Active',
          ownerId: ownerId ?? lead.ownerId,
        },
        include: {
          owner: { select: { id: true, name: true, avatarInitials: true } },
          tags: { include: { tag: true } },
        },
      }),
      prisma.lead.update({ where: { id }, data: { status: 'Converted' } }),
    ])

    return reply.status(201).send(customer)
  })

  // GET /api/v1/leads/:id/activities
  app.get('/:id/activities', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } })
    if (!lead) return reply.status(404).send({ error: 'Lead not found' })

    const activities = await prisma.activity.findMany({
      where: { relatedTo: id, relatedType: 'lead' },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ data: activities })
  })
}
