import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'

// Freno de fuerza bruta sobre el login.
//
// POR QUÉ SE BLOQUEA POR IDENTIFICADOR Y NO POR IP
//
// Bloquear por IP parecería más fuerte, pero en un casino los equipos de caja
// y el wifi salen por una sola IP: bloquearla dejaría fuera a todo el
// personal por culpa de un intento ajeno. La IP se registra para auditar, no
// para decidir.
//
// EL COSTO DE ESTA DECISIÓN, DICHO CLARAMENTE
//
// Bloquear por identificador abre una negación de servicio: alguien que
// conozca el correo de una cajera puede fallar cinco veces a propósito y
// dejarla sin entrar quince minutos. Es un mal menor frente a que le
// adivinen la contraseña —que hoy se deriva de la cédula— y el bloqueo es
// corto justamente para acotarlo.
//
// La solución de fondo no es esta: es que cada quien cambie su contraseña
// inicial. Mientras esa pantalla no exista, esto es la contención.

const MAX_FALLOS = 5
const BLOQUEO_MINUTOS = 15
// Los fallos viejos no cuentan: si alguien se equivocó dos veces ayer, hoy
// arranca de cero. Sin esto, un usuario despistado acumularía bloqueos.
const VENTANA_MINUTOS = 15

export interface EstadoBloqueo {
  bloqueado: boolean
  segundosRestantes: number
}

// El identificador se normaliza para que "Admin@X.com" y "admin@x.com" sean
// el mismo cubo y no se pueda esquivar el conteo cambiando mayúsculas.
function normalizar(identificador: string): string {
  return identificador.trim().toLowerCase().slice(0, 190)
}

function ipDe(req: Request): string | null {
  const reenviada = req.headers['x-forwarded-for']
  if (typeof reenviada === 'string' && reenviada.length > 0) {
    return reenviada.split(',')[0]!.trim().slice(0, 190)
  }
  return req.ip?.slice(0, 190) ?? null
}

// Se consulta ANTES de comprobar la contraseña: a una cuenta bloqueada ni
// siquiera se le evalúa la clave.
export async function estadoDeBloqueo(identificador: string): Promise<EstadoBloqueo> {
  const registro = await prisma.intentoLogin.findUnique({
    where: { id: normalizar(identificador) },
    select: { bloqueadoHasta: true },
  })

  const hasta = registro?.bloqueadoHasta?.getTime() ?? 0
  const restante = hasta - Date.now()
  if (restante <= 0) return { bloqueado: false, segundosRestantes: 0 }

  return { bloqueado: true, segundosRestantes: Math.ceil(restante / 1000) }
}

// Suma un fallo y bloquea si se llegó al tope. Devuelve cuántos intentos
// quedan, para poder avisarlo antes de que sea tarde.
export async function registrarFallo(req: Request, identificador: string): Promise<{ restantes: number }> {
  const id = normalizar(identificador)
  const ahora = new Date()
  const ip = ipDe(req)

  const previo = await prisma.intentoLogin.findUnique({
    where: { id },
    select: { fallos: true, ultimoFallo: true },
  })

  // Si el último fallo quedó fuera de la ventana, el conteo arranca de nuevo.
  const dentroDeVentana =
    previo != null && ahora.getTime() - previo.ultimoFallo.getTime() < VENTANA_MINUTOS * 60_000
  const fallos = (dentroDeVentana ? previo!.fallos : 0) + 1

  const bloqueadoHasta =
    fallos >= MAX_FALLOS ? new Date(ahora.getTime() + BLOQUEO_MINUTOS * 60_000) : null

  await prisma.intentoLogin.upsert({
    where: { id },
    update: { fallos, bloqueadoHasta, ultimaIp: ip },
    create: { id, fallos, bloqueadoHasta, ultimaIp: ip },
  })

  if (bloqueadoHasta) {
    console.warn(`Login bloqueado por ${BLOQUEO_MINUTOS} min tras ${fallos} fallos: ${id} (ip ${ip ?? 'desconocida'})`)
  }

  return { restantes: Math.max(0, MAX_FALLOS - fallos) }
}

// Entrar bien borra el historial: quien conoce su contraseña no arrastra
// fallos anteriores.
export async function limpiarFallos(identificador: string): Promise<void> {
  await prisma.intentoLogin.deleteMany({ where: { id: normalizar(identificador) } })
}

export const LIMITES_LOGIN = { MAX_FALLOS, BLOQUEO_MINUTOS, VENTANA_MINUTOS }
