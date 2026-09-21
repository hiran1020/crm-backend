import type { UserRole } from '@prisma/client'
import type { VerifyPayloadType } from '@fastify/jwt'

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string
      email: string
      name: string
      role: UserRole
    }
    // access-token namespace
    accessVerify(options?: { onlyCookie?: boolean }): Promise<VerifyPayloadType>
    // refresh-token namespace
    refreshVerify(options?: { onlyCookie?: boolean }): Promise<VerifyPayloadType>
  }

  interface FastifyReply {
    accessSign(payload: object): Promise<string>
    refreshSign(payload: object): Promise<string>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string
      email: string
      name: string
      role: UserRole
    }
    user: {
      id: string
      email: string
      name: string
      role: UserRole
    }
  }
}
