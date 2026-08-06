import { Router } from 'express'
import { asyncHandler } from '../utils/asyncHandler.js'
import { prisma } from '../lib/prisma.js'

export const ubicacionesRouter = Router()

// Público a propósito: el formulario de registro lo consume antes de que
// exista una cuenta, así que no puede exigir sesión.
//
// Devuelve el árbol completo en una sola llamada. Son ~140 municipios: cabe
// de sobra en una respuesta y evita un ida y vuelta cada vez que el usuario
// cambia de departamento.
ubicacionesRouter.get('/', asyncHandler(async (_req, res) => {
  const departamentos = await prisma.departamento.findMany({
    where: { activo: true },
    orderBy: { orden: 'asc' },
    select: {
      nombre: true,
      municipios: { orderBy: { orden: 'asc' }, select: { nombre: true } },
    },
  })

  // Excepción a la política de no-store: es un catálogo público que no
  // cambia casi nunca y lo pide cada visitante al abrir el registro. Cinco
  // minutos de caché le ahorran a la base una consulta por visita sin
  // arriesgar nada: aquí no hay datos personales.
  res.set('Cache-Control', 'public, max-age=300')

  return res.json({
    departamentos: departamentos.map((d) => ({
      nombre: d.nombre,
      municipios: d.municipios.map((m) => m.nombre),
    })),
  })
}))
