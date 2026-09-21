import { buildApp } from '../src/app.js'

const app = await buildApp()

export default async function handler(req: any, res: any) {
  await app.ready()
  app.server.emit('request', req, res)
}