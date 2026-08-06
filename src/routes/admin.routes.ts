import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/requireAuth.js'

export const adminRouter = Router()

adminRouter.use(requireAuth, requireRole('admin'))

// Panel de administrador: toda la información de los clientes registrados,
// incluyendo el estado real de su bono (pendiente/reclamado) — a diferencia
// de lo que ve el propio cliente, aquí SÍ se muestra un bono ya canjeado.
adminRouter.get('/clientes', async (_req, res) => {
  const clientes = await prisma.cliente.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      bono: {
        include: {
          premio: { include: { sede: { select: { nombre: true } } } },
          sedeCanjeada: { select: { nombre: true } },
          canjeadoPor: { select: { nombre: true } },
        },
      },
    },
  })

  return res.json({
    clientes: clientes.map((c) => ({
      id: c.id,
      nombres: c.nombres,
      apellidos: c.apellidos,
      docTipo: c.docTipo,
      docNumero: c.docNumero,
      nacimiento: c.nacimiento,
      telefono: c.telefono,
      departamento: c.departamento,
      ciudad: c.ciudad,
      email: c.email,
      createdAt: c.createdAt,
      bono: c.bono
        ? {
            codigo: c.bono.codigo,
            estado: c.bono.estado,
            creadoEn: c.bono.creadoEn,
            canjeadoEn: c.bono.canjeadoEn,
            canjeadoPor: c.bono.canjeadoPor?.nombre ?? null,
            sede: c.bono.sedeCanjeada?.nombre ?? null,
            sedeRedencion: c.bono.premio.sede?.nombre ?? null,
            premioClave: c.bono.premio.clave,
            premio: { nombre: c.bono.premio.nombre, monetario: c.bono.premio.monetario },
          }
        : null,
    })),
  })
})

// Auditoría de canjes: la traza completa de cada bono entregado, ordenada por
// fecha de canje. Responde "quién entregó qué, a quién, cuándo y en qué sede",
// que es lo que se necesita para cuadrar caja o resolver un reclamo.
//
// El cajero tiene su propio historial (/cajero/historial); este es el mismo
// hecho para el admin, con el dato extra de cuánto tardó el cliente en ir a
// redimir y el correo del titular.
adminRouter.get('/canjes', async (_req, res) => {
  const canjes = await prisma.bonoGanado.findMany({
    where: { estado: 'reclamado' },
    orderBy: { canjeadoEn: 'desc' },
    include: {
      premio: { include: { sede: { select: { nombre: true } } } },
      cliente: true,
      sedeCanjeada: { select: { nombre: true } },
      canjeadoPor: { select: { nombre: true, email: true } },
    },
  })

  return res.json({
    canjes: canjes.map((bono) => ({
      codigo: bono.codigo,
      creadoEn: bono.creadoEn,
      canjeadoEn: bono.canjeadoEn,
      // Horas entre ganar el bono y redimirlo. Null si falta la fecha de
      // canje (no debería pasar en filas 'reclamado', pero la columna es
      // nullable y no vamos a inventar un dato).
      horasHastaCanje:
        bono.canjeadoEn != null
          ? Math.round(((bono.canjeadoEn.getTime() - bono.creadoEn.getTime()) / 3_600_000) * 10) / 10
          : null,
      sede: bono.sedeCanjeada?.nombre ?? null,
      // Sede a la que el premio decia que fuera. Si difiere de `sede`, el bono
      // se entrego en un casino distinto al asignado.
      sedeRedencion: bono.premio.sede?.nombre ?? null,
      canjeadoPor: bono.canjeadoPor?.nombre ?? null,
      canjeadoPorEmail: bono.canjeadoPor?.email ?? null,
      premio: { nombre: bono.premio.nombre, monetario: bono.premio.monetario },
      cliente: {
        nombres: bono.cliente.nombres,
        apellidos: bono.cliente.apellidos,
        docTipo: bono.cliente.docTipo,
        docNumero: bono.cliente.docNumero,
        email: bono.cliente.email,
        telefono: bono.cliente.telefono,
      },
    })),
  })
})
