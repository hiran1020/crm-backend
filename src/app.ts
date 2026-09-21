import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { config } from './config.js'
import jwtPlugin from './plugins/jwt.js'
import corsPlugin from './plugins/cors.js'
import { authRoutes } from './routes/auth.js'
import { usersRoutes } from './routes/users.js'
import { customersRoutes } from './routes/customers.js'
import { leadsRoutes } from './routes/leads.js'
import { dealsRoutes } from './routes/deals.js'
import { activitiesRoutes } from './routes/activities.js'
import { ticketsRoutes } from './routes/tickets.js'
import { tagsRoutes } from './routes/tags.js'
import { notificationsRoutes } from './routes/notifications.js'
import { analyticsRoutes } from './routes/analytics.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isDev ? 'info' : 'warn',
      transport: config.isDev
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  // Core plugins
  await app.register(cookie)
  await app.register(corsPlugin)
  await app.register(jwtPlugin)

  // Health check (unauthenticated)
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // API routes
  await app.register(async (api) => {
    await api.register(async (v1) => {
      await v1.register(authRoutes,          { prefix: '/auth' })
      await v1.register(usersRoutes,         { prefix: '/users' })
      await v1.register(customersRoutes,     { prefix: '/customers' })
      await v1.register(leadsRoutes,         { prefix: '/leads' })
      await v1.register(dealsRoutes,         { prefix: '/deals' })
      await v1.register(activitiesRoutes,    { prefix: '/activities' })
      await v1.register(ticketsRoutes,       { prefix: '/tickets' })
      await v1.register(tagsRoutes,          { prefix: '/tags' })
      await v1.register(notificationsRoutes, { prefix: '/notifications' })
      await v1.register(analyticsRoutes,     { prefix: '/analytics' })
    }, { prefix: '/v1' })
  }, { prefix: '/api' })

  return app
}
