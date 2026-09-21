import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { config } from './config.js'
import jwtPlugin from './plugins/jwt.js'
import corsPlugin from './plugins/cors.js'
import { authRoutes } from './routes/auth.js'
import { usersRoutes } from './routes/users.js'

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
      await v1.register(authRoutes, { prefix: '/auth' })
      await v1.register(usersRoutes, { prefix: '/users' })
    }, { prefix: '/v1' })
  }, { prefix: '/api' })

  return app
}
