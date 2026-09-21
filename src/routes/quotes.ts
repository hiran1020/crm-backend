import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { QuoteStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { writeAudit } from '../lib/audit.js'

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0),
  total: z.number().min(0),
})

const createBody = z.object({
  dealId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired']).default('Draft'),
  validUntil: z.string().datetime({ offset: true }).optional(),
  notes: z.string().optional(),
  subtotal: z.number().min(0),
  tax: z.number().min(0).default(0),
  total: z.number().min(0),
  lineItems: z.array(lineItemSchema).min(1),
})

const updateBody = createBody.partial()

const quoteInclude = {
  deal: { select: { id: true, title: true } },
  customer: { select: { id: true, firstName: true, lastName: true, company: true } },
} satisfies Prisma.QuoteInclude

export async function quotesRoutes(app: FastifyInstance) {
  // GET /api/v1/quotes
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))
    const skip = (page - 1) * pageSize

    const where: Prisma.QuoteWhereInput = {}
    if (q.status) where.status = q.status as QuoteStatus
    if (q.dealId) where.dealId = q.dealId
    if (q.customerId) where.customerId = q.customerId

    const [data, total] = await prisma.$transaction([
      prisma.quote.findMany({ where, include: quoteInclude, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.quote.count({ where }),
    ])

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  })

  // POST /api/v1/quotes
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = createBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const { lineItems, validUntil, ...rest } = result.data
    try {
      const quote = await prisma.quote.create({
        data: {
          ...rest,
          lineItems,
          validUntil: validUntil ? new Date(validUntil) : undefined,
        },
        include: quoteInclude,
      })
      writeAudit({ entityType: 'quote', entityId: quote.id, action: 'created', actorId: request.user.id, after: quote })
      return reply.status(201).send(quote)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/quotes/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const quote = await prisma.quote.findUnique({ where: { id }, include: quoteInclude })
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

    const existing = await prisma.quote.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ error: 'Quote not found' })

    const { lineItems, validUntil, ...rest } = result.data
    try {
      const quote = await prisma.quote.update({
        where: { id },
        data: {
          ...rest,
          ...(lineItems !== undefined && { lineItems }),
          ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
        },
        include: quoteInclude,
      })
      writeAudit({ entityType: 'quote', entityId: id, action: 'updated', actorId: request.user.id, before: existing, after: quote })
      return reply.send(quote)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // DELETE /api/v1/quotes/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const quote = await prisma.quote.delete({ where: { id } })
      writeAudit({ entityType: 'quote', entityId: id, action: 'deleted', actorId: request.user.id, before: quote })
      return reply.status(204).send()
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // POST /api/v1/quotes/:id/send  — mark as Sent
  app.post('/:id/send', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const quote = await prisma.quote.update({
        where: { id },
        data: { status: 'Sent' },
        include: quoteInclude,
      })
      return reply.send(quote)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // POST /api/v1/quotes/:id/accept  — mark as Accepted
  app.post('/:id/accept', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const quote = await prisma.quote.update({
        where: { id },
        data: { status: 'Accepted' },
        include: quoteInclude,
      })
      return reply.send(quote)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // POST /api/v1/quotes/:id/reject  — mark as Rejected
  app.post('/:id/reject', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const quote = await prisma.quote.update({
        where: { id },
        data: { status: 'Rejected' },
        include: quoteInclude,
      })
      return reply.send(quote)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
