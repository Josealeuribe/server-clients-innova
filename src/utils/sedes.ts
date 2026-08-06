import { prisma } from '../lib/prisma.js'

// El catálogo de sedes vive en la tabla `sedes` (ver prisma/schema.prisma).
// Antes era un array quemado en este archivo; se movió a base para que el
// select del cajero, la asignación de premios y la validación del canje salgan
// todos de la misma fuente, y para poder abrir o cerrar una sede sin desplegar.

export function listarSedesActivas() {
  return prisma.sede.findMany({
    where: { activo: true },
    orderBy: { orden: 'asc' },
    select: { clave: true, nombre: true, direccion: true },
  })
}

// Resuelve la clave que manda el frontend al id real, validando de paso que
// exista y esté activa. Devuelve null si no, y quien llama responde 400.
export async function idDeSedeActiva(clave: unknown): Promise<number | null> {
  if (typeof clave !== 'string' || !clave.trim()) return null
  const sede = await prisma.sede.findFirst({
    where: { clave: clave.trim(), activo: true },
    select: { id: true },
  })
  return sede?.id ?? null
}
