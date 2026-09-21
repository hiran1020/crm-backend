import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'

export default fp(async function jwtPlugin(app: FastifyInstance) {
  // Access token — short-lived, sent in Authorization: Bearer header
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtAccessExpiry },
    namespace: 'access',
    jwtVerify: 'accessVerify',
    jwtSign: 'accessSign',
    decoratorName: 'user',
  })

  // Refresh token — long-lived, stored in httpOnly cookie
  await app.register(jwt, {
    secret: config.jwtRefreshSecret,
    sign: { expiresIn: config.jwtRefreshExpiry },
    namespace: 'refresh',
    jwtVerify: 'refreshVerify',
    jwtSign: 'refreshSign',
    cookie: { cookieName: 'refreshToken', signed: false },
  })
})
