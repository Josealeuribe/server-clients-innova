import jwt, { type SignOptions } from 'jsonwebtoken'

if (!process.env.JWT_SECRET || !process.env.TICKET_SECRET) {
  throw new Error('Faltan JWT_SECRET o TICKET_SECRET en las variables de entorno (.env)')
}

const JWT_SECRET: string = process.env.JWT_SECRET
const TICKET_SECRET: string = process.env.TICKET_SECRET
const SESSION_TOKEN_TTL = (process.env.SESSION_TOKEN_TTL || '7d') as SignOptions['expiresIn']
const TICKET_TTL_MINUTES = Number(process.env.TICKET_TTL_MINUTES || 30)

export type StaffRol = 'admin' | 'cajero'

// Sesión discriminada por `tipo`: un cliente autenticado o un miembro del
// personal (admin/cajero). Ambos entran por el mismo endpoint de login;
// el `tipo`/`rol` es lo que decide a qué panel se le da acceso.
export type SessionPayload =
  | { tipo: 'cliente'; clienteId: number; email: string }
  | { tipo: 'staff'; usuarioId: number; email: string; rol: StaffRol }

// Token de sesión: identifica a un cliente ya autenticado (login o
// registro exitoso). Se envía como "Authorization: Bearer <token>".
export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_TOKEN_TTL })
}

export function verifySessionToken(token: string): SessionPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as SessionPayload
}

export interface TicketPayload {
  premioClave: string
}

// Ticket de premio: prueba firmada de que el servidor sorteó este premio
// para un giro anónimo de la ruleta. El frontend lo reenvía al registrarse
// para reclamar el bono. Expira en TICKET_TTL_MINUTES (mismo plazo que se
// le comunica al jugador en el modal de premio).
export function signPrizeTicket(payload: TicketPayload): string {
  return jwt.sign(payload, TICKET_SECRET, { expiresIn: `${TICKET_TTL_MINUTES}m` as SignOptions['expiresIn'] })
}

export function verifyPrizeTicket(token: string): TicketPayload {
  return jwt.verify(token, TICKET_SECRET) as unknown as TicketPayload
}
