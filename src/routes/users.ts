import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { auth, db, toDoc, toDocs, countQuery, now } from '../lib/firebase.js'
import { handleFirestoreError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

function toInitials(name: string) {
  return name.split(' ').map(p => p[0]).filter(Boolean).join('').toUpperCase().slice(0, 2)
}

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
      const q = request.query as Record<string, string>
      const page = Math.max(1, parseInt(q.page ?? '1', 10))
      const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

      let query = db.collection('users') as FirebaseFirestore.Query
      if (q.role)   query = query.where('role', '==', q.role)
      if (q.status) query = query.where('status', '==', q.status)

      const total = await countQuery(query)
      const snap = await query.orderBy('name').offset((page - 1) * pageSize).limit(pageSize).get()
      let data = toDocs(snap)

      if (q.search) {
        const s = q.search.toLowerCase()
        data = data.filter(u =>
          u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s),
        )
      }

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
      const { password, name, role, ...rest } = result.data

      try {
        // 1. Create Firebase Auth user
        const fbUser = await auth.createUser({ email: rest.email, password, displayName: name })
        // 2. Set role as custom claim
        await auth.setCustomUserClaims(fbUser.uid, { role })
        // 3. Write profile to Firestore
        const profile = {
          id: fbUser.uid,
          name,
          role,
          ...rest,
          avatarInitials: toInitials(name),
          lastLoginAt: null,
          createdAt: now(),
          updatedAt: now(),
        }
        await db.collection('users').doc(fbUser.uid).set(profile)
        return reply.status(201).send({ ...profile, id: fbUser.uid })
      } catch (err) {
        return handleFirestoreError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/users/:id
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('users').doc(id).get()
    const user = toDoc(snap)
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return reply.send(user)
  })

  // PATCH /api/v1/users/:id
  app.patch('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const caller = request.user
    const isAdmin = caller.role === 'admin'
    const isSelf = caller.id === id

    if (!isAdmin && !isSelf) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const result = updateBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const { password, role, name, email, ...rest } = result.data

    if (role !== undefined && !isAdmin) {
      return reply.status(403).send({ error: 'Forbidden: only admins can change roles' })
    }

    try {
      // Update Firebase Auth
      const authUpdate: Record<string, unknown> = {}
      if (email)    authUpdate.email       = email
      if (password) authUpdate.password    = password
      if (name)     authUpdate.displayName = name
      if (Object.keys(authUpdate).length) await auth.updateUser(id, authUpdate)

      // Update custom claims if role changed
      if (role) await auth.setCustomUserClaims(id, { role })

      // Update Firestore profile
      const update: Record<string, unknown> = { ...rest, updatedAt: now() }
      if (name)  { update.name = name; update.avatarInitials = toInitials(name) }
      if (email) update.email = email
      if (role)  update.role  = role

      await db.collection('users').doc(id).update(update)
      const snap = await db.collection('users').doc(id).get()
      return reply.send(toDoc(snap))
    } catch (err) {
      return handleFirestoreError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

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
        await auth.deleteUser(id)
        await db.collection('users').doc(id).delete()
        return reply.status(204).send()
      } catch (err) {
        return handleFirestoreError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // GET /api/v1/users/:id/stats
  app.get('/:id/stats', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const [customersSnap, leadsSnap, openDealsSnap, wonDealsSnap, activitiesSnap] = await Promise.all([
      db.collection('customers').where('ownerId', '==', id).count().get(),
      db.collection('leads').where('ownerId', '==', id).count().get(),
      db.collection('deals').where('ownerId', '==', id).where('stage', 'not-in', ['Won', 'Lost']).count().get(),
      db.collection('deals').where('ownerId', '==', id).where('stage', '==', 'Won').get(),
      db.collection('activities').where('owner', '==', id).count().get(),
    ])

    const wonRevenue = wonDealsSnap.docs.reduce((sum, d) => sum + (d.data().amount ?? 0), 0)

    return reply.send({
      customersOwned: customersSnap.data().count,
      leadsOwned: leadsSnap.data().count,
      openDeals: openDealsSnap.data().count,
      wonDeals: wonDealsSnap.size,
      wonRevenue,
      activitiesLogged: activitiesSnap.data().count,
    })
  })
}
