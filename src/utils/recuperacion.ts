import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'

// Reglas del código de recuperación de contraseña de los clientes.
//
// Durante los minutos que vive, este código ES la credencial de la cuenta:
// quien lo tenga puede cambiar la contraseña. Por eso se trata como tal —
// se guarda hasheado, vence rápido, se usa una sola vez y tiene tope de
// intentos.

const LONGITUD = 6
export const VIGENCIA_MINUTOS = 15
// Intentos para acertar UN código. Un código de 6 dígitos son 10^6
// combinaciones: sin tope, un script lo saca por fuerza bruta en minutos.
const MAX_INTENTOS = 5
// Cuántos códigos se le pueden pedir a una misma cuenta por hora. Frena tanto
// el uso de la API como buzón de spam contra un cliente, como el gasto de
// cuota del proveedor de correo.
const MAX_SOLICITUDES_POR_HORA = 3

export interface CodigoEmitido {
  /** En claro. Solo existe en memoria el tiempo que tarda en irse al correo. */
  codigo: string
  id: number
  expiraEn: Date
}

function ipDe(req: Request): string | null {
  const reenviada = req.headers['x-forwarded-for']
  if (typeof reenviada === 'string' && reenviada.length > 0) {
    return reenviada.split(',')[0]!.trim().slice(0, 190)
  }
  return req.ip?.slice(0, 190) ?? null
}

// randomInt y no Math.random: este número protege una cuenta. Math.random no
// es criptográficamente seguro y su secuencia se puede predecir.
function generarCodigo(): string {
  return String(randomInt(0, 10 ** LONGITUD)).padStart(LONGITUD, '0')
}

export interface ResultadoSolicitud {
  emitido: CodigoEmitido | null
  /** true cuando se rechazó por haber pedido demasiados códigos seguidos. */
  demasiadasSolicitudes: boolean
}

// Emite un código nuevo para el cliente e invalida los anteriores: si alguien
// pide dos, solo el último sirve. Sin esto quedarían varios códigos vivos a la
// vez, que es multiplicar las oportunidades de acertar uno.
export async function emitirCodigo(req: Request, clienteId: number): Promise<ResultadoSolicitud> {
  const haceUnaHora = new Date(Date.now() - 60 * 60_000)
  const recientes = await prisma.codigoRecuperacion.count({
    where: { clienteId, creadoEn: { gt: haceUnaHora } },
  })
  if (recientes >= MAX_SOLICITUDES_POR_HORA) {
    return { emitido: null, demasiadasSolicitudes: true }
  }

  const codigo = generarCodigo()
  const codigoHash = await bcrypt.hash(codigo, 10)
  const expiraEn = new Date(Date.now() + VIGENCIA_MINUTOS * 60_000)

  const fila = await prisma.$transaction(async (tx) => {
    // Los anteriores se marcan usados, no se borran: queda el rastro de
    // cuántas veces se pidió recuperar esta cuenta.
    await tx.codigoRecuperacion.updateMany({
      where: { clienteId, usadoEn: null },
      data: { usadoEn: new Date() },
    })
    return tx.codigoRecuperacion.create({
      data: { clienteId, codigoHash, expiraEn, ip: ipDe(req) },
    })
  })

  return { emitido: { codigo, id: fila.id, expiraEn }, demasiadasSolicitudes: false }
}

export type ResultadoVerificacion =
  | { ok: true; codigoId: number }
  | { ok: false; motivo: 'sin-codigo' | 'vencido' | 'agotado' | 'incorrecto'; intentosRestantes: number }

// Comprueba el código que escribió el cliente. Devuelve el id de la fila para
// que quien llame ate el token de cambio a ESE código concreto.
export async function verificarCodigo(clienteId: number, codigo: string): Promise<ResultadoVerificacion> {
  const fila = await prisma.codigoRecuperacion.findFirst({
    where: { clienteId, usadoEn: null },
    orderBy: { creadoEn: 'desc' },
  })

  if (!fila) return { ok: false, motivo: 'sin-codigo', intentosRestantes: 0 }
  if (fila.expiraEn.getTime() <= Date.now()) return { ok: false, motivo: 'vencido', intentosRestantes: 0 }
  if (fila.intentos >= MAX_INTENTOS) return { ok: false, motivo: 'agotado', intentosRestantes: 0 }

  const acierta = await bcrypt.compare(codigo, fila.codigoHash)
  if (!acierta) {
    const actualizada = await prisma.codigoRecuperacion.update({
      where: { id: fila.id },
      data: { intentos: { increment: 1 } },
      select: { intentos: true },
    })
    return {
      ok: false,
      motivo: 'incorrecto',
      intentosRestantes: Math.max(0, MAX_INTENTOS - actualizada.intentos),
    }
  }

  return { ok: true, codigoId: fila.id }
}

// Marca el código como consumido. Devuelve false si otra petición se le
// adelantó: `updateMany` con `usadoEn: null` en el filtro hace que solo una de
// dos peticiones simultáneas afecte una fila, así que el mismo código no puede
// cambiar la contraseña dos veces.
export async function consumirCodigo(codigoId: number, clienteId: number): Promise<boolean> {
  const { count } = await prisma.codigoRecuperacion.updateMany({
    where: { id: codigoId, clienteId, usadoEn: null, expiraEn: { gt: new Date() } },
    data: { usadoEn: new Date() },
  })
  return count === 1
}

export const LIMITES_RECUPERACION = { LONGITUD, VIGENCIA_MINUTOS, MAX_INTENTOS, MAX_SOLICITUDES_POR_HORA }
