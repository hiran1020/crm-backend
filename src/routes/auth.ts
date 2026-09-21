import type { FastifyInstance } from 'fastify'
import { auth, db, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'

export async function authRoutes(app: FastifyInstance) {
  // GET /api/v1/auth/me — return the current user's profile from Firestore
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const snap = await db.collection('users').doc(request.user.id).get()
    const profile = toDoc(snap)
    if (!profile) {
      // First login — build a minimal profile from the token
      return reply.send({
        id: request.user.id,
        email: request.user.email,
        name: request.user.name,
        role: request.user.role,
      })
    }
    return reply.send(profile)
  })

  // POST /api/v1/auth/logout — revoke all refresh tokens for the current user
  app.post('/logout', { preHandler: authenticate }, async (request, reply) => {
    await auth.revokeRefreshTokens(request.user.id)
    return reply.send({ message: 'Logged out' })
  })

  // POST /api/v1/auth/set-role — admin sets a role as a custom claim (admin only)
  app.post('/set-role', { preHandler: authenticate }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden' })
    }
    const { uid, role } = request.body as { uid?: string; role?: string }
    if (!uid || !role || !['admin', 'manager', 'sales_agent', 'support'].includes(role)) {
      return reply.status(400).send({ error: 'uid and a valid role are required' })
    }
    await auth.setCustomUserClaims(uid, { role })
    // Sync to Firestore user doc
    await db.collection('users').doc(uid).set({ role, updatedAt: now() }, { merge: true })
    return reply.send({ uid, role })
  })
}
