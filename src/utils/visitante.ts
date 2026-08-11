import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { signVisitanteToken, verifyVisitanteToken } from './jwt.js'

// Identificación del visitante anónimo para poder limitar los giros.
//
// POR QUÉ NO BASTA CON LA COOKIE (el bug del celular)
//
// La cookie funcionaba en el navegador de escritorio y NO en el celular: allí
// el contador bajaba a "te quedan 2" y se quedaba ahí para siempre, dejando
// girar sin límite. La causa no era el celular: era que la cookie es de
// TERCEROS.
//
// En producción el front vive en gran-casino-cucuta1.onrender.com y la API en
// otro subdominio de onrender.com. Como onrender.com está en la Public Suffix
// List, esos dos subdominios NO son el mismo sitio: la cookie viaja como
// cookie de tercero. Safari en iOS las bloquea por completo desde hace años, y
// Chrome en Android va por el mismo camino. Resultado: el navegador nunca
// guardaba `gcc_visitante`, cada giro llegaba sin identificación, el servidor
// creaba un visitante nuevo y respondía "llevas 1 giro" — eternamente.
//
// LA SOLUCIÓN: la misma identidad por dos vías
//
// Junto a la cookie, el servidor devuelve el MISMO id en un token firmado que
// el frontend guarda en localStorage y reenvía en la cabecera `X-Visitante`
// (ver CABECERA_VISITANTE). El servidor acepta cualquiera de las dos: si el
// navegador guarda la cookie, se usa la cookie; si la bloquea, se usa el
// token. Ninguna petición cross-site queda sin identificar.
//
// El token va FIRMADO, no es el id pelado: si no, cualquiera mandaría un id
// nuevo en cada giro y el tope de 3 no serviría de nada.
//
// HASTA DÓNDE LLEGA ESTO, CON HONESTIDAD
//
// El endpoint de la ruleta es anónimo por diseño (se gira antes de tener
// cuenta), así que no existe forma infalible de reconocer a una persona.
//
//   · Resiste recargar, cerrar y reabrir la pestaña o el navegador, y ahora
//     también el bloqueo de cookies de terceros del celular, que era el
//     agujero real.
//   · NO resiste modo incógnito ni borrar los datos del sitio a mano (eso se
//     lleva cookie y localStorage a la vez). Quien haga eso empieza de cero.
//
// Un bloqueo por IP cerraría ese hueco, pero en un casino con wifi compartido
// dejaría por fuera a clientes legítimos, así que la IP solo se registra para
// poder auditar abusos (muchas identidades distintas desde la misma IP).
//
// El candado duro sigue estando más adelante: un cliente solo puede tener UN
// bono en toda su vida (BonoGanado.clienteId es @unique), así que por más que
// alguien vuelva a girar, solo puede reclamar uno.

export const COOKIE_VISITANTE = 'gcc_visitante'
export const CABECERA_VISITANTE = 'x-visitante'

// Un año: el objetivo es que dure más que la promoción.
const UN_ANIO_MS = 365 * 24 * 60 * 60 * 1000

// Lee la identidad de donde haya llegado. La cookie manda cuando existe: es la
// vía que el navegador no puede tocar desde JavaScript.
export function leerIdVisitante(req: Request): string | null {
  const deCookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE_VISITANTE]
  if (typeof deCookie === 'string' && deCookie.length > 0) return deCookie

  const token = req.headers[CABECERA_VISITANTE]
  if (typeof token === 'string' && token.length > 0) {
    try {
      return verifyVisitanteToken(token).vid
    } catch {
      // Token vencido, manipulado o de otro despliegue: se ignora y se trata
      // como visitante nuevo. No se responde error: el visitante no tiene
      // forma de arreglarlo ni tiene por qué enterarse.
    }
  }

  return null
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
    //
    // Aun así el navegador puede rechazarla (es cookie de tercero): para eso
    // está el token de `X-Visitante`, que va por el mismo camino que cualquier
    // otra cabecera y nadie bloquea.
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

export interface IdentidadVisitante {
  id: string
  /** Token firmado que el frontend guarda y reenvía en `X-Visitante`. */
  token: string
}

// Devuelve la identidad del visitante, creándola si es la primera vez. NO
// escribe en la base: la fila de VisitanteAnonimo solo nace cuando alguien
// gira de verdad, así que abrir la ruleta y salirse no deja rastro.
//
// Se llama también al consultar los giros restantes, para que la identidad
// quede establecida al cargar la página y el primer giro ya la traiga.
export function asegurarIdentidad(req: Request, res: Response): IdentidadVisitante {
  const id = leerIdVisitante(req) ?? randomUUID()
  // La cookie se reemite siempre, no solo al crearla: así se renueva el año de
  // vigencia en cada visita, y si la identidad venía por token se intenta
  // dejar además la cookie, por si este navegador sí la acepta.
  emitirCookieVisitante(res, id)
  return { id, token: signVisitanteToken({ vid: id }) }
}

export interface RegistroDeGiro extends IdentidadVisitante {
  girosUsados: number
}

// Cuenta un giro para el visitante y devuelve cuántos lleva.
export async function registrarGiro(req: Request, res: Response): Promise<RegistroDeGiro> {
  const identidad = asegurarIdentidad(req, res)
  const ip = ipDe(req)

  // upsert y no update: si la identidad apunta a un registro que ya no existe
  // (base recreada, limpieza) o es la primera vez, se crea en vez de reventar.
  const visitante = await prisma.visitanteAnonimo.upsert({
    where: { id: identidad.id },
    update: { giros: { increment: 1 }, ip },
    create: { id: identidad.id, giros: 1, ip },
  })

  return { ...identidad, girosUsados: visitante.giros }
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
