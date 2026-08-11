import { createHmac } from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'

if (!process.env.JWT_SECRET || !process.env.TICKET_SECRET) {
  throw new Error('Faltan JWT_SECRET o TICKET_SECRET en las variables de entorno (.env)')
}

const JWT_SECRET: string = process.env.JWT_SECRET
const TICKET_SECRET: string = process.env.TICKET_SECRET

// Secretos derivados, no configurados. Se sacan del JWT_SECRET con HMAC en vez
// de pedir dos variables de entorno más: un despliegue con una variable menos
// es un despliegue menos frágil, y el resultado es igual de independiente —
// conocer uno no permite firmar con el otro.
//
// La separación importa de verdad: si el token de recuperación se firmara con
// JWT_SECRET a secas, requireAuth lo aceptaría como si fuera una sesión.
function derivar(proposito: string): string {
  return createHmac('sha256', JWT_SECRET).update(proposito).digest('hex')
}

const RESET_SECRET = derivar('recuperacion-password')
const VISITANTE_SECRET = derivar('visitante-anonimo')
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

export interface ResetPayload {
  clienteId: number
  /** Fila de codigos_recuperacion que se validó. Ata el token a ESE código. */
  codigoId: number
}

// Prueba firmada de que alguien acertó el código que se envió al correo. Vive
// entre el paso "verificar código" y el paso "escribir la nueva contraseña",
// para no tener que mandar el código otra vez ni guardarlo en el navegador.
//
// 10 minutos: es tiempo de sobra para escribir una contraseña, y corto para
// que sirva de poco si la pantalla queda abierta en un celular prestado.
export function signResetToken(payload: ResetPayload): string {
  return jwt.sign(payload, RESET_SECRET, { expiresIn: '10m' })
}

export function verifyResetToken(token: string): ResetPayload {
  return jwt.verify(token, RESET_SECRET) as unknown as ResetPayload
}

export interface VisitantePayload {
  /** El mismo id que viaja en la cookie gcc_visitante. */
  vid: string
}

// Identidad del visitante anónimo, firmada, para poder contarle los giros
// cuando el navegador NO guarda la cookie (ver utils/visitante.ts). Va firmada
// justamente para que no se pueda inventar: sin firma, cualquiera mandaría un
// id nuevo en cada giro y el tope de 3 no serviría de nada.
//
// Un año, igual que la cookie: debe durar más que la promoción.
export function signVisitanteToken(payload: VisitantePayload): string {
  return jwt.sign(payload, VISITANTE_SECRET, { expiresIn: '365d' })
}

export function verifyVisitanteToken(token: string): VisitantePayload {
  return jwt.verify(token, VISITANTE_SECRET) as unknown as VisitantePayload
}
