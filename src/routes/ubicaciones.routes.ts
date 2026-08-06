import { Router } from 'express'
import { prisma } from '../lib/prisma.js'

export const ubicacionesRouter = Router()

// Público a propósito: el formulario de registro lo consume antes de que
// exista una cuenta, así que no puede exigir sesión.
//
// Devuelve el árbol completo en una sola llamada. Son ~140 municipios: cabe
// de sobra en una respuesta y evita un ida y vuelta cada vez que el usuario
// cambia de departamento.
ubicacionesRouter.get('/', async (_req, res) => {
  const departamentos = await prisma.departamento.findMany({
    where: { activo: true },
    orderBy: { orden: 'asc' },
    select: {
      nombre: true,
      municipios: { orderBy: { orden: 'asc' }, select: { nombre: true } },
    },
  })

  return res.json({
    departamentos: departamentos.map((d) => ({
      nombre: d.nombre,
      municipios: d.municipios.map((m) => m.nombre),
    })),
  })
})
