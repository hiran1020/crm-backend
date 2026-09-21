import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const createBody = z.object({
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

const updateBody = createBody.partial()

export async function tagsRoutes(app: FastifyInstance) {
  // GET /api/v1/tags
  app.get('/', { preHandler: authenticate }, async (_request, reply) => {
    const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } })
    return reply.send({ data: tags })
  })

  // POST /api/v1/tags
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }

      try {
        const tag = await prisma.tag.create({ data: result.data })
        return reply.status(201).send(tag)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/tags/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const tag = await prisma.tag.findUnique({ where: { id } })
    if (!tag) return reply.status(404).send({ error: 'Tag not found' })
    return reply.send(tag)
  })

  // PATCH /api/v1/tags/:id
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
        const tag = await prisma.tag.update({ where: { id }, data: result.data })
        return reply.send(tag)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // DELETE /api/v1/tags/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        await prisma.tag.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )
}
