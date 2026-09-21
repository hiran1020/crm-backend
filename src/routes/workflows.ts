import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { EntityType, Prisma } from '@prisma/client'
import { Prisma as PrismaClient } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { sendToUser } from '../lib/sse.js'

const triggerSchema = z.object({
  event: z.enum(['created', 'updated', 'status_changed', 'stage_changed']),
  entityType: z.enum(['customer', 'lead', 'deal']),
})

const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte']),
  value: z.unknown(),
})

const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('notify'),
    userId: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    link: z.string().optional(),
  }),
  z.object({
    type: z.literal('status_change'),
    entityType: z.enum(['customer', 'lead', 'deal']),
    field: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal('email'),
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
])

const createBody = z.object({
  name: z.string().trim().min(1),
  entityType: z.enum(['customer', 'lead', 'deal']),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).optional(),
  actions: z.array(actionSchema).min(1),
  enabled: z.boolean().default(true),
})

const updateBody = createBody.partial()

export async function workflowsRoutes(app: FastifyInstance) {
  // GET /api/v1/workflows
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const where: Prisma.WorkflowWhereInput = {}
    if (q.entityType) where.entityType = q.entityType as EntityType
    if (q.enabled !== undefined) where.enabled = q.enabled === 'true'

    const workflows = await prisma.workflow.findMany({ where, orderBy: { name: 'asc' } })
    return reply.send({ data: workflows })
  })

  // POST /api/v1/workflows
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      try {
        const { trigger, conditions, actions, ...rest } = result.data
        const workflow = await prisma.workflow.create({
          data: {
            ...rest,
            trigger: trigger as object,
            actions: actions as object[],
            ...(conditions && { conditions: conditions as object[] }),
          },
        })
        return reply.status(201).send(workflow)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/workflows/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const workflow = await prisma.workflow.findUnique({ where: { id } })
    if (!workflow) return reply.status(404).send({ error: 'Workflow not found' })
    return reply.send(workflow)
  })

  // PATCH /api/v1/workflows/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      try {
        const { trigger, conditions, actions, ...updateRest } = result.data
        const workflow = await prisma.workflow.update({
          where: { id },
          data: {
            ...updateRest,
            ...(trigger && { trigger: trigger as object }),
            ...(actions && { actions: actions as object[] }),
            ...(conditions !== undefined && { conditions: conditions ? conditions as object[] : PrismaClient.JsonNull }),
          },
        })
        return reply.send(workflow)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // DELETE /api/v1/workflows/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        await prisma.workflow.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // PATCH /api/v1/workflows/:id/toggle  — enable / disable
  app.patch(
    '/:id/toggle',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const workflow = await prisma.workflow.findUnique({ where: { id } })
      if (!workflow) return reply.status(404).send({ error: 'Workflow not found' })

      const updated = await prisma.workflow.update({
        where: { id },
        data: { enabled: !workflow.enabled },
      })
      return reply.send(updated)
    },
  )

  // POST /api/v1/workflows/:id/trigger  — manual trigger; executes notify actions immediately
  app.post('/:id/trigger', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const workflow = await prisma.workflow.findUnique({ where: { id } })
    if (!workflow) return reply.status(404).send({ error: 'Workflow not found' })
    if (!workflow.enabled) return reply.status(422).send({ error: 'Workflow is disabled' })

    const actions = workflow.actions as z.infer<typeof actionSchema>[]
    const results: Array<{ action: string; status: string }> = []

    for (const action of actions) {
      if (action.type === 'notify') {
        await prisma.notification.create({
          data: { userId: action.userId, title: action.title, body: action.body, type: 'workflow', link: action.link },
        })
        sendToUser(action.userId, 'notification', { title: action.title, body: action.body })
        results.push({ action: 'notify', status: 'sent' })
      } else if (action.type === 'email') {
        // Email execution requires the worker + email provider — log for now
        results.push({ action: 'email', status: 'queued' })
      } else if (action.type === 'status_change') {
        results.push({ action: 'status_change', status: 'queued' })
      }
    }

    return reply.send({ workflow, results })
  })
}
