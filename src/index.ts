import 'dotenv/config'
import { buildApp } from './app.js'
import { config } from './config.js'

const app = await buildApp()

// Local dev — start the HTTP server directly.
// On Vercel the default export is used instead; listen() is never called there.
if (process.env.VERCEL !== '1') {
  await app.listen({ port: config.port, host: '0.0.0.0' })
}

export default async function handler(req: any, res: any) {
  await app.ready()
  app.server.emit('request', req, res)
}