import type { UserRole } from '@prisma/client'

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string
      email: string
      name: string
      role: UserRole
    }
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
