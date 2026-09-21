import type { ServerResponse } from 'http'

// In-process SSE client registry: userId → set of open connections
const clients = new Map<string, Set<ServerResponse>>()

export function addClient(userId: string, res: ServerResponse): void {
  if (!clients.has(userId)) clients.set(userId, new Set())
  clients.get(userId)!.add(res)
}

export function removeClient(userId: string, res: ServerResponse): void {
  clients.get(userId)?.delete(res)
  if (clients.get(userId)?.size === 0) clients.delete(userId)
}

export function sendToUser(userId: string, event: string, data: unknown): void {
  const conns = clients.get(userId)
  if (!conns?.size) return
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of conns) {
    try { res.write(msg) } catch { /* client gone */ }
  }
}

export function broadcastEvent(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const conns of clients.values()) {
    for (const res of conns) {
      try { res.write(msg) } catch { /* client gone */ }
    }
  }
}
