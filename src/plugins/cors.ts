import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'

// In dev/emulator: allow any localhost or 127.0.0.1 origin so the /docs page,
// a frontend dev server, and Postman can all reach the API without config.
// In prod: lock down to the explicit CORS_ORIGIN env var.
function originPolicy(config: typeof import('../config.js').config) {
  if (config.isDev || config.isEmulator) {
    return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (!origin) return cb(null, true) // server-to-server / curl
      const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      cb(null, allowed)
    }
  }
  return config.corsOrigin || false
}

export default fp(async function corsPlugin(app: FastifyInstance) {
  await app.register(cors, {
    origin: originPolicy(config),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
})
