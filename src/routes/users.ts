import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { UserRole, UserStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { hashPassword, toInitials } from '../lib/password.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

// Columns safe to return — never include passwordHash
const safeSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  jobTitle: true,
  department: true,
  avatarInitials: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect

const createBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'manager', 'sales_agent', 'support']),
  status: z.enum(['active', 'inactive']).default('active'),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
})

const updateBody = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['admin', 'manager', 'sales_agent', 'support']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
})

export async function usersRoutes(app: FastifyInstance) {
  // GET /api/v1/users
  app.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const query = request.query as Record<string, string>
      const page = Math.max(1, parseInt(query.page ?? '1', 10))
      const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '20', 10)))
      const skip = (page - 1) * pageSize

      const where: Prisma.UserWhereInput = {}
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ]
      }
      if (query.role) where.role = query.role as UserRole
      if (query.status) where.status = query.status as UserStatus

      const [data, total] = await prisma.$transaction([
        prisma.user.findMany({ where, select: safeSelect, skip, take: pageSize, orderBy: { name: 'asc' } }),
        prisma.user.count({ where }),
      ])

      return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
    },
  )

  // POST /api/v1/users
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const result = createBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }
      const { password, name, ...rest } = result.data

      try {
        const user = await prisma.user.create({
          data: {
            ...rest,
            name,
            passwordHash: await hashPassword(password),
            avatarInitials: toInitials(name),
          },
          select: safeSelect,
        })
        return reply.status(201).send(user)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/users/:id
  app.get(
    '/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const user = await prisma.user.findUnique({ where: { id }, select: safeSelect })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      return reply.send(user)
    },
  )

  // PATCH /api/v1/users/:id
  app.patch(
    '/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const caller = request.user

      // Only admins can edit others; managers/agents can edit only themselves
      const isAdmin = caller.role === 'admin'
      const isSelf = caller.id === id
      if (!isAdmin && !isSelf) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      const result = updateBody.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
      }

      const { password, role, name, ...rest } = result.data

      // Only admins may change role
      if (role !== undefined && !isAdmin) {
        return reply.status(403).send({ error: 'Forbidden: only admins can change roles' })
      }

      const data: Prisma.UserUpdateInput = { ...rest }
      if (role) data.role = role
      if (password) data.passwordHash = await hashPassword(password)
      if (name) {
        data.name = name
        data.avatarInitials = toInitials(name)
      }

      try {
        const user = await prisma.user.update({ where: { id }, data, select: safeSelect })
        return reply.send(user)
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // DELETE /api/v1/users/:id
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      if (request.user.id === id) {
        return reply.status(400).send({ error: 'Cannot delete your own account' })
      }

      try {
        await prisma.user.delete({ where: { id } })
        return reply.status(204).send()
      } catch (err) {
        return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/users/:id/stats
  app.get(
    '/:id/stats',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
      if (!user) return reply.status(404).send({ error: 'User not found' })

      const [
        customersOwned,
        leadsOwned,
        openDeals,
        wonDeals,
        wonRevenueAgg,
        activitiesLogged,
      ] = await prisma.$transaction([
        prisma.customer.count({ where: { ownerId: id } }),
        prisma.lead.count({ where: { ownerId: id } }),
        prisma.deal.count({ where: { ownerId: id, stage: { notIn: ['Won', 'Lost'] } } }),
        prisma.deal.count({ where: { ownerId: id, stage: 'Won' } }),
        prisma.deal.aggregate({ where: { ownerId: id, stage: 'Won' }, _sum: { amount: true } }),
        prisma.activity.count({ where: { owner: id } }),
      ])

      return reply.send({
        customersOwned,
        leadsOwned,
        openDeals,
        wonDeals,
        wonRevenue: wonRevenueAgg._sum.amount ?? 0,
        activitiesLogged,
      })
    },
  )
}
