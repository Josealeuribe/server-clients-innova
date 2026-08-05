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
      bono: { include: { premio: true, canjeadoPor: { select: { nombre: true } } } },
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
            premio: { nombre: c.bono.premio.nombre, monetario: c.bono.premio.monetario },
          }
        : null,
    })),
  })
})
