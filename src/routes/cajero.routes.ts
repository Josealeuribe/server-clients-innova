import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/requireAuth.js'

export const cajeroRouter = Router()

cajeroRouter.use(requireAuth, requireRole('admin', 'cajero'))

function toCanjePreview(bono: NonNullable<Awaited<ReturnType<typeof buscarPorCodigo>>>) {
  return {
    codigo: bono.codigo,
    estado: bono.estado,
    premio: { nombre: bono.premio.nombre, detalle: bono.premio.detalle, monetario: bono.premio.monetario },
    cliente: { nombres: bono.cliente.nombres, apellidos: bono.cliente.apellidos, docTipo: bono.cliente.docTipo, docNumero: bono.cliente.docNumero },
  }
}

function buscarPorCodigo(codigo: string) {
  return prisma.bonoGanado.findUnique({
    where: { codigo },
    include: { premio: true, cliente: true },
  })
}

// Vista previa antes de confirmar el canje: el cajero verifica que el
// nombre/documento del bono coincidan con la persona que tiene enfrente
// antes de dar clic en "Confirmar canje".
cajeroRouter.get('/codigo/:codigo', async (req, res) => {
  const bono = await buscarPorCodigo(req.params.codigo.trim().toUpperCase())
  if (!bono) {
    return res.status(404).json({ error: 'No existe ningún bono con ese código.' })
  }
  return res.json(toCanjePreview(bono))
})

// Confirma el canje. Es la única operación que cambia el estado del bono a
// 'reclamado' — a partir de ahí, el cliente deja de verlo (ver toSafeBono en
// auth.routes.ts) y el proceso termina ahí, tal como se pidió.
cajeroRouter.post('/codigo/:codigo/canjear', async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase()
  const usuarioId = req.session!.tipo === 'staff' ? req.session!.usuarioId : undefined

  const resultado = await prisma.bonoGanado.updateMany({
    where: { codigo, estado: 'pendiente' },
    data: { estado: 'reclamado', canjeadoEn: new Date(), canjeadoPorId: usuarioId },
  })

  if (resultado.count === 0) {
    const bono = await buscarPorCodigo(codigo)
    if (!bono) {
      return res.status(404).json({ error: 'No existe ningún bono con ese código.' })
    }
    return res.status(409).json({ error: 'Este bono ya fue canjeado anteriormente.' })
  }

  const bono = await buscarPorCodigo(codigo)
  return res.json({ ok: true, ...toCanjePreview(bono!) })
})

// Historial de todos los bonos ya canjeados (por cualquier cajero), más
// reciente primero.
cajeroRouter.get('/historial', async (_req, res) => {
  const canjes = await prisma.bonoGanado.findMany({
    where: { estado: 'reclamado' },
    orderBy: { canjeadoEn: 'desc' },
    include: { premio: true, cliente: true, canjeadoPor: { select: { nombre: true } } },
  })

  return res.json({
    canjes: canjes.map((bono) => ({
      codigo: bono.codigo,
      canjeadoEn: bono.canjeadoEn,
      canjeadoPor: bono.canjeadoPor?.nombre ?? null,
      premio: { nombre: bono.premio.nombre, monetario: bono.premio.monetario },
      cliente: { nombres: bono.cliente.nombres, apellidos: bono.cliente.apellidos, docNumero: bono.cliente.docNumero },
    })),
  })
})
