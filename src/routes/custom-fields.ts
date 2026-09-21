import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { EntityType, CustomFieldType, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const createDefBody = z.object({
  entityType: z.enum(['customer', 'lead', 'deal']),
  key: z.string().trim().min(1).regex(/^[a-z0-9_]+$/, 'key must be lowercase letters, digits, or underscores'),
  name: z.string().trim().min(1),
  type: z.enum(['text', 'number', 'date', 'select', 'url', 'checkbox']),
  options: z.array(z.string()).optional().default([]),
  required: z.boolean().default(false),
})

const updateDefBody = createDefBody.omit({ entityType: true, key: true }).partial()

const upsertValueBody = z.object({
  entityId: z.string().uuid(),
  values: z.record(z.string(), z.unknown()),
})

export async function customFieldsRoutes(app: FastifyInstance) {
  // ─── Field Definitions ────────────────────────────────────────────────────

  // GET /api/v1/custom-fields?entityType=customer
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const where: Prisma.CustomFieldDefWhereInput = {}
    if (q.entityType) where.entityType = q.entityType as EntityType

    const defs = await prisma.customFieldDef.findMany({ where, orderBy: { name: 'asc' } })
    return reply.send({ data: defs })
  })

  // POST /api/v1/custom-fields
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const result = createDefBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      try {
        const def = await prisma.customFieldDef.create({ data: result.data })
        return reply.status(201).send(def)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/custom-fields/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const def = await prisma.customFieldDef.findUnique({ where: { id } })
    if (!def) return reply.status(404).send({ error: 'Custom field not found' })
    return reply.send(def)
  })

  // PATCH /api/v1/custom-fields/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateDefBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      try {
        const def = await prisma.customFieldDef.update({ where: { id }, data: result.data })
        return reply.send(def)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // DELETE /api/v1/custom-fields/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        await prisma.customFieldDef.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // ─── Field Values ──────────────────────────────────────────────────────────

  // GET /api/v1/custom-fields/values?entityId=xxx
  // Returns all custom field values for an entity, merged with their def
  app.get('/values', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    if (!q.entityId) return reply.status(400).send({ error: 'entityId is required' })

    const values = await prisma.customFieldValue.findMany({
      where: { entityId: q.entityId },
      include: { fieldDef: true },
    })
    return reply.send({ data: values })
  })

  // PUT /api/v1/custom-fields/values
  // Batch upsert: { entityId, values: { fieldKey: value, ... } }
  app.put('/values', { preHandler: authenticate }, async (request, reply) => {
    const result = upsertValueBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const { entityId, values } = result.data

    // Resolve field def ids by key
    const keys = Object.keys(values)
    const defs = await prisma.customFieldDef.findMany({ where: { key: { in: keys } } })
    const defByKey = new Map(defs.map(d => [d.key, d]))

    const unknown = keys.filter(k => !defByKey.has(k))
    if (unknown.length) {
      return reply.status(400).send({ error: `Unknown field keys: ${unknown.join(', ')}` })
    }

    await prisma.$transaction(
      keys.map(key => {
        const def = defByKey.get(key)!
        return prisma.customFieldValue.upsert({
          where: { fieldDefId_entityId: { fieldDefId: def.id, entityId } },
          create: { fieldDefId: def.id, entityId, value: values[key] as Prisma.InputJsonValue },
          update: { value: values[key] as Prisma.InputJsonValue },
        })
      }),
    )

    const updated = await prisma.customFieldValue.findMany({
      where: { entityId },
      include: { fieldDef: true },
    })
    return reply.send({ data: updated })
  })
}
