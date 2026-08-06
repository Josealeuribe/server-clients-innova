import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

// Identificación del visitante anónimo para poder limitar los giros.
//
// HASTA DÓNDE LLEGA ESTO, CON HONESTIDAD
//
// El endpoint de la ruleta es anónimo por diseño (se gira antes de tener
// cuenta), así que no existe forma infalible de reconocer a una persona. Lo
// que sí se puede hacer, y es lo que hace este módulo, es que el conteo lo
// lleve el SERVIDOR y no el navegador:
//
//   · Resiste recargar la página, cerrar y volver a abrir la pestaña, cerrar
//     el navegador y volver, y borrar localStorage. Que era el caso concreto
//     del que había que defenderse: recargar hasta sacar el premio deseado.
//   · NO resiste modo incógnito ni borrar las cookies a mano. Quien haga eso
//     empieza de cero.
//
// Un bloqueo por IP cerraría ese hueco, pero en un casino con wifi compartido
// dejaría por fuera a clientes legítimos, así que la IP solo se registra para
// poder auditar abusos (muchas cookies distintas desde la misma IP).
//
// El candado duro sigue estando más adelante: un cliente solo puede tener UN
// bono en toda su vida (BonoGanado.clienteId es @unique), así que por más que
// alguien vuelva a girar, solo puede reclamar uno.

export const COOKIE_VISITANTE = 'gcc_visitante'

// Un año: el objetivo es que dure más que la promoción.
const UN_ANIO_MS = 365 * 24 * 60 * 60 * 1000

export function leerIdVisitante(req: Request): string | null {
  const valor = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE_VISITANTE]
  return typeof valor === 'string' && valor.length > 0 ? valor : null
}

export function emitirCookieVisitante(res: Response, id: string) {
  const enProduccion = process.env.NODE_ENV === 'production'
  res.cookie(COOKIE_VISITANTE, id, {
    httpOnly: true, // el JavaScript de la página no puede leerla ni borrarla
    maxAge: UN_ANIO_MS,
    // En producción el front y la API viven en dominios distintos, así que la
    // cookie es cross-site y necesita SameSite=None, que a su vez exige
    // Secure. En local todo pasa por el proxy de Vite (mismo origen) y Lax
    // funciona sin necesidad de HTTPS.
    sameSite: enProduccion ? 'none' : 'lax',
    secure: enProduccion,
    path: '/',
  })
}

function ipDe(req: Request): string | null {
  const reenviada = req.headers['x-forwarded-for']
  if (typeof reenviada === 'string' && reenviada.length > 0) {
    // Render pone la IP real de primera en la lista.
    return reenviada.split(',')[0]!.trim().slice(0, 190)
  }
  return req.ip?.slice(0, 190) ?? null
}

export interface RegistroDeGiro {
  girosUsados: number
  id: string
}

// Cuenta un giro para el visitante y devuelve cuántos lleva. Crea el registro
// (y la cookie) si es su primer giro.
export async function registrarGiro(req: Request, res: Response): Promise<RegistroDeGiro> {
  const existente = leerIdVisitante(req)
  const ip = ipDe(req)

  if (existente) {
    // upsert y no update: si la cookie apunta a un registro que ya no existe
    // (base recreada, limpieza), se vuelve a crear en vez de reventar.
    const visitante = await prisma.visitanteAnonimo.upsert({
      where: { id: existente },
      update: { giros: { increment: 1 }, ip },
      create: { id: existente, giros: 1, ip },
    })
    return { girosUsados: visitante.giros, id: visitante.id }
  }

  const id = randomUUID()
  const visitante = await prisma.visitanteAnonimo.create({ data: { id, giros: 1, ip } })
  emitirCookieVisitante(res, id)
  return { girosUsados: visitante.giros, id: visitante.id }
}

// Cuántos giros lleva ya, sin contar uno nuevo. Se usa para responder antes
// de sortear, y para que el frontend sepa cuántos le quedan.
export async function girosUsadosPor(req: Request): Promise<number> {
  const id = leerIdVisitante(req)
  if (!id) return 0
  const visitante = await prisma.visitanteAnonimo.findUnique({
    where: { id },
    select: { giros: true },
  })
  return visitante?.giros ?? 0
}
