import type { Request, Response, NextFunction } from 'express'
import { verifySessionToken, type SessionPayload, type StaffRol } from '../utils/jwt.js'

declare global {
  namespace Express {
    interface Request {
      session?: SessionPayload
    }
  }
}

// Exige "Authorization: Bearer <token>" válido y adjunta req.session (puede
// ser una sesión de cliente o de personal admin/cajero — ver SessionPayload).
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' })
  }

  try {
    req.session = verifySessionToken(token)
    next()
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' })
  }
}

// Debe usarse siempre después de requireAuth. Exige que la sesión sea de
// personal (staff) con uno de los roles indicados.
export function requireRole(...roles: StaffRol[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session || req.session.tipo !== 'staff' || !roles.includes(req.session.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para acceder a este recurso.' })
    }
    next()
  }
}
