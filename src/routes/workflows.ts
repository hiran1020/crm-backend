import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const actionSchema = z.object({
  type: z.enum(['send_email', 'create_task', 'update_field', 'create_notification', 'webhook']),
  config: z.record(z.string(), z.unknown()).default({}),
})

const createBody = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  trigger: z.enum(['deal_stage_change', 'lead_status_change', 'ticket_created', 'ticket_closed', 'quote_accepted', 'manual']),
  conditions: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  actions: z.array(actionSchema).min(1),
  active: z.boolean().default(true),
})

const updateBody = createBody.partial()

export async function workflowsRoutes(app: FastifyInstance) {
  // GET /api/v1/workflows
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    let query = db.collection('workflows') as FirebaseFirestore.Query
    if (q.trigger) query = query.where('trigger', '==', q.trigger)
    if (q.active !== undefined) query = query.where('active', '==', q.active === 'true')
    const snap = await query.orderBy('name').get()
    return reply.send({ data: toDocs(snap) })
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
      const docRef = db.collection('workflows').doc()
      const workflow = { id: docRef.id, ...result.data, createdAt: now(), updatedAt: now() }
      await docRef.set(workflow)
      return reply.status(201).send(workflow)
    },
  )

  // GET /api/v1/workflows/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('workflows').doc(id).get()
    const workflow = toDoc(snap)
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
      const snap = await db.collection('workflows').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Workflow not found' })
      await db.collection('workflows').doc(id).update({ ...result.data, updatedAt: now() })
      return reply.send(toDoc(await db.collection('workflows').doc(id).get()))
    },
  )

  // DELETE /api/v1/workflows/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('workflows').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Workflow not found' })
      await db.collection('workflows').doc(id).delete()
      return reply.status(204).send()
    },
  )

  // PATCH /api/v1/workflows/:id/toggle
  app.patch(
    '/:id/toggle',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('workflows').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Workflow not found' })
      const currentActive = snap.data()?.active ?? false
      await db.collection('workflows').doc(id).update({ active: !currentActive, updatedAt: now() })
      return reply.send(toDoc(await db.collection('workflows').doc(id).get()))
    },
  )

  // POST /api/v1/workflows/:id/trigger — manual trigger (scaffold)
  app.post(
    '/:id/trigger',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('workflows').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Workflow not found' })
      const workflow = snap.data()!
      if (!workflow.active) return reply.status(400).send({ error: 'Workflow is not active' })
      if (workflow.trigger !== 'manual') return reply.status(400).send({ error: 'Workflow trigger is not manual' })

      // Log a run record (actual action execution is handled by BullMQ workers)
      const runRef = db.collection('workflow_runs').doc()
      await runRef.set({
        id: runRef.id,
        workflowId: id,
        triggeredBy: request.user.id,
        status: 'queued',
        payload: request.body ?? {},
        createdAt: now(),
      })

      return reply.status(202).send({ message: 'Workflow queued', runId: runRef.id })
    },
  )
}
