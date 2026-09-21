import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

// Webhooks are stored in a generic JSON table using a Workflow record as backing store.
// We use a dedicated Prisma model-free approach: store configs in a custom table via raw.
// Since the schema has no dedicated webhooks table, we model them as serialised JSON in the
// existing `workflows` table with entityType scoped to a special sentinel — OR we add a new
// table via migration. For now, implement in-memory + DB via a simple JSON store in the
// `workflows` table with name prefix "webhook:".
//
// Production: add a `webhooks` table in a follow-up migration. The API contract below is stable.

const createBody = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
})

const updateBody = createBody.partial()

type WebhookConfig = {
  url: string
  events: string[]
  secret?: string
  description?: string
  enabled: boolean
}

function toWebhook(w: { id: string; name: string; actions: unknown; enabled: boolean; createdAt: Date; updatedAt: Date }) {
  const cfg = w.actions as WebhookConfig
  return {
    id: w.id,
    url: cfg.url,
    events: cfg.events,
    secret: cfg.secret ? '***' : undefined,
    description: cfg.description,
    enabled: w.enabled,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }
}

export async function webhooksRoutes(app: FastifyInstance) {
  // GET /api/v1/webhooks
  app.get(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_request, reply) => {
      const rows = await prisma.workflow.findMany({
        where: { name: { startsWith: 'webhook:' } },
        orderBy: { createdAt: 'desc' },
      })
      return reply.send({ data: rows.map(toWebhook) })
    },
  )

  // POST /api/v1/webhooks
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const { url, events, secret, description, enabled } = result.data
      try {
        const row = await prisma.workflow.create({
          data: {
            name: `webhook:${url}`,
            entityType: 'customer',
            trigger: { event: 'created', entityType: 'customer' },
            actions: { url, events, secret, description, enabled } as object,
            enabled,
          },
        })
        return reply.status(201).send(toWebhook(row))
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/webhooks/:id
  app.get(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const row = await prisma.workflow.findFirst({ where: { id, name: { startsWith: 'webhook:' } } })
      if (!row) return reply.status(404).send({ error: 'Webhook not found' })
      return reply.send(toWebhook(row))
    },
  )

  // PATCH /api/v1/webhooks/:id
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }

      const existing = await prisma.workflow.findFirst({ where: { id, name: { startsWith: 'webhook:' } } })
      if (!existing) return reply.status(404).send({ error: 'Webhook not found' })

      const prev = existing.actions as WebhookConfig
      const merged: WebhookConfig = { ...prev, ...result.data }

      try {
        const row = await prisma.workflow.update({
          where: { id },
          data: {
            enabled: merged.enabled,
            actions: merged as object,
            ...(merged.url ? { name: `webhook:${merged.url}` } : {}),
          },
        })
        return reply.send(toWebhook(row))
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // DELETE /api/v1/webhooks/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const existing = await prisma.workflow.findFirst({ where: { id, name: { startsWith: 'webhook:' } } })
      if (!existing) return reply.status(404).send({ error: 'Webhook not found' })

      try {
        await prisma.workflow.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // POST /api/v1/webhooks/:id/test  — fire a test ping to the webhook URL
  app.post(
    '/:id/test',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const row = await prisma.workflow.findFirst({ where: { id, name: { startsWith: 'webhook:' } } })
      if (!row) return reply.status(404).send({ error: 'Webhook not found' })

      const cfg = row.actions as WebhookConfig
      const payload = { event: 'ping', timestamp: new Date().toISOString() }

      try {
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        })
        return reply.send({ success: res.ok, status: res.status })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        return reply.status(502).send({ success: false, error: msg })
      }
    },
  )
}
