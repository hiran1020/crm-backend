import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { verifyPassword } from '../lib/password.js'
import { authenticate } from '../middleware/authenticate.js'

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/login
  app.post('/login', async (request, reply) => {
    const result = loginBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }
    const { email, password } = result.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.status === 'inactive') {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const payload = { id: user.id, email: user.email, name: user.name, role: user.role }

    const accessToken = await reply.accessSign(payload)
    const refreshToken = await reply.refreshSign(payload)

    return reply
      .setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/v1/auth/refresh',
        maxAge: 60 * 60 * 24 * 7,
      })
      .send({
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          avatarInitials: user.avatarInitials,
          phone: user.phone,
          jobTitle: user.jobTitle,
          department: user.department,
        },
      })
  })

  // POST /api/v1/auth/refresh
  app.post('/refresh', async (request, reply) => {
    try {
      await request.refreshVerify({ onlyCookie: true })
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' })
    }

    const { id, email, name, role } = request.user
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user || user.status === 'inactive') {
      return reply.status(401).send({ error: 'User not found or inactive' })
    }

    const accessToken = await reply.accessSign({ id, email, name, role })
    return reply.send({ accessToken })
  })

  // POST /api/v1/auth/logout
  app.post('/logout', { preHandler: authenticate }, async (_request, reply) => {
    return reply
      .clearCookie('refreshToken', { path: '/api/v1/auth/refresh' })
      .send({ message: 'Logged out' })
  })
}
