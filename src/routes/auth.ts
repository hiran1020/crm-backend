import type { FastifyInstance } from 'fastify'
import { auth, db, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { config } from '../config.js'

export async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/sign-in  (public — no token required)
  // Proxies email/password sign-in to either the Auth emulator or real Firebase,
  // so callers (e.g. the /docs page) never need to know which mode is active.
  app.post('/sign-in', async (request, reply) => {
    const { email, password } = (request.body ?? {}) as { email?: string; password?: string }
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' })
    }

    let authUrl: string
    if (config.isEmulator) {
      authUrl = 'http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key'
    } else {
      if (!config.firebaseWebApiKey) {
        return reply.status(503).send({ error: 'FIREBASE_WEB_API_KEY is not set on this server. Add it to .env and restart.' })
      }
      authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.firebaseWebApiKey}`
    }

    try {
      const res = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      })
      const data = await res.json() as { idToken?: string; email?: string; displayName?: string; error?: { message: string } }
      if (!data.idToken) {
        return reply.status(401).send({ error: data.error?.message ?? 'Invalid credentials' })
      }
      return reply.send({ idToken: data.idToken, email: data.email, displayName: data.displayName })
    } catch (err) {
      return reply.status(502).send({ error: 'Firebase Auth unreachable', detail: String(err) })
    }
  })

  // GET /api/v1/auth/me — return the current user's profile from Firestore
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const ref = db.collection('users').doc(request.user.id)
    const snap = await ref.get()
    const profile = toDoc(snap)

    // Stamp lastLoginAt — fire-and-forget, don't block the response
    void ref.set({ lastLoginAt: now() }, { merge: true })

    if (!profile) {
      return reply.send({
        id: request.user.id,
        email: request.user.email,
        name: request.user.name,
        role: request.user.role,
        lastLoginAt: null,
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
