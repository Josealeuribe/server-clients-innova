import { Router } from 'express'
import { asyncHandler } from '../utils/asyncHandler.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/requireAuth.js'
import { registrarPresencia } from '../middleware/presencia.js'
import { listarSedesActivas } from '../utils/sedes.js'

export const cajeroRouter = Router()

// `registrarPresencia` va de último: necesita la sesión que deja requireAuth, y
// no tiene sentido marcar como presente a quien el rol va a rechazar.
cajeroRouter.use(requireAuth, requireRole('admin', 'cajero'), registrarPresencia)

function toCanjePreview(bono: NonNullable<Awaited<ReturnType<typeof buscarPorCodigo>>>) {
  return {
    codigo: bono.codigo,
    estado: bono.estado,
    vigenciaHasta: bono.vigenciaHasta,
    vencido: bono.vigenciaHasta.getTime() < Date.now(),
    premio: { nombre: bono.premio.nombre, detalle: bono.premio.detalle, monetario: bono.premio.monetario },
    // El cajero coteja estos datos con el documento fisico de la persona que
    // tiene enfrente antes de entregar nada.
    cliente: {
      nombres: bono.cliente.nombres,
      apellidos: bono.cliente.apellidos,
      docTipo: bono.cliente.docTipo,
      docNumero: bono.cliente.docNumero,
      email: bono.cliente.email,
      telefono: bono.cliente.telefono,
      ciudad: bono.cliente.ciudad,
      departamento: bono.cliente.departamento,
      registradoEn: bono.cliente.createdAt,
    },
    sedeCanje: bono.sedeCanjeada?.nombre ?? null,
    canjeadoPor: bono.canjeadoPor?.nombre ?? null,
    // Sede donde el premio dice que debe redimirse.
    sedeRedencion: bono.premio.sede ?? null,
  }
}

// El frontend arma el select con esta lista, para no duplicar el catalogo.
cajeroRouter.get('/sedes', asyncHandler(async (_req, res) => {
  return res.json({ sedes: await listarSedesActivas() })
}))

// Busqueda por documento. Es la salida para el caso real de sede: el cliente
// llega sin celular, o no recuerda el codigo, o no logra entrar a su cuenta.
// Con la cedula en la mano el cajero recupera al titular y ve si tiene un
// bono vigente, sin depender de que el cliente traiga nada.
//
// Devuelve el historico completo de su bono (aunque ya este canjeado) para
// poder responderle "esto ya se entrego el dia X en la sede Y" en vez de un
// "no aparece nada" que no explica nada.
cajeroRouter.get('/cliente/:docNumero', asyncHandler(async (req, res) => {
  const docNumero = req.params.docNumero.trim()
  if (!docNumero) {
    return res.status(400).json({ error: 'Ingresa el número de documento.' })
  }

  const cliente = await prisma.cliente.findUnique({
    where: { docNumero },
    include: {
      bono: {
        include: {
          premio: { include: { sede: { select: { clave: true, nombre: true, direccion: true } } } },
          sedeCanjeada: { select: { nombre: true } },
          canjeadoPor: { select: { nombre: true } },
        },
      },
    },
  })

  if (!cliente) {
    return res.status(404).json({ error: 'No hay ningún cliente registrado con ese documento.' })
  }

  return res.json({
    cliente: {
      nombres: cliente.nombres,
      apellidos: cliente.apellidos,
      docTipo: cliente.docTipo,
      docNumero: cliente.docNumero,
      email: cliente.email,
      telefono: cliente.telefono,
      ciudad: cliente.ciudad,
      departamento: cliente.departamento,
      registradoEn: cliente.createdAt,
    },
    bono: cliente.bono
      ? {
          codigo: cliente.bono.codigo,
          estado: cliente.bono.estado,
          creadoEn: cliente.bono.creadoEn,
          canjeadoEn: cliente.bono.canjeadoEn,
          vigenciaHasta: cliente.bono.vigenciaHasta,
          vencido: cliente.bono.vigenciaHasta.getTime() < Date.now(),
          canjeadoPor: cliente.bono.canjeadoPor?.nombre ?? null,
          sede: cliente.bono.sedeCanjeada?.nombre ?? null,
          sedeRedencion: cliente.bono.premio.sede ?? null,
          premio: {
            nombre: cliente.bono.premio.nombre,
            detalle: cliente.bono.premio.detalle,
            monetario: cliente.bono.premio.monetario,
          },
        }
      : null,
  })
}))

function buscarPorCodigo(codigo: string) {
  return prisma.bonoGanado.findUnique({
    where: { codigo },
    include: {
      premio: { include: { sede: { select: { clave: true, nombre: true, direccion: true } } } },
      cliente: true,
      sedeCanjeada: { select: { nombre: true } },
      canjeadoPor: { select: { nombre: true } },
    },
  })
}

// Vista previa antes de confirmar el canje: el cajero verifica que el
// nombre/documento del bono coincidan con la persona que tiene enfrente
// antes de dar clic en "Confirmar canje".
cajeroRouter.get('/codigo/:codigo', asyncHandler(async (req, res) => {
  const bono = await buscarPorCodigo(req.params.codigo.trim().toUpperCase())
  if (!bono) {
    return res.status(404).json({ error: 'No existe ningún bono con ese código.' })
  }
  return res.json(toCanjePreview(bono))
}))

// Confirma el canje. Es la única operación que cambia el estado del bono a
// 'reclamado'. El cliente lo sigue viendo en su cuenta como constancia de la
// entrega, con la fecha y la sede (ver toSafeBono en auth.routes.ts).
cajeroRouter.post('/codigo/:codigo/canjear', asyncHandler(async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase()
  const usuarioId = req.session!.tipo === 'staff' ? req.session!.usuarioId : undefined

  // La sede que se registra es la del CAJERO, no la del premio: el bono se
  // entregó físicamente donde está quien lo entregó. El premio dice a dónde
  // debía ir el cliente (Premio.sedeId); esto dice dónde acabó yendo.
  // Guardar ambas es lo que permite ver que se redimió en otro casino.
  //
  // Si la cuenta no tiene sede (el admin), se cae a la del premio para no
  // dejar el registro sin sede.
  const operador = usuarioId
    ? await prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { sedeId: true, rol: true, sede: { select: { nombre: true } } },
      })
    : null
  const existente = await buscarPorCodigo(codigo)
  if (!existente) {
    return res.status(404).json({ error: 'No existe ningún bono con ese código.' })
  }
  if (existente.estado !== 'pendiente') {
    return res.status(409).json({ error: 'Este bono ya fue canjeado anteriormente.' })
  }
  if (existente.vigenciaHasta.getTime() < Date.now()) {
    const vence = existente.vigenciaHasta.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
    return res.status(410).json({ error: `Este bono venció el ${vence} y ya no puede redimirse.` })
  }

  // El bono SOLO se redime en el casino al que fue asignado. Antes se permitía
  // el canje cruzado y solo se advertía, porque únicamente Av. 0 tenía
  // personal y bloquearlo habría dejado sin poder entregar ~68% de los bonos.
  // Ya con cajeras en las 3 sedes, la regla se aplica de verdad: es lo que se
  // le prometió al cliente y lo que hace que el reparto por sede signifique
  // algo.
  //
  // El admin queda exento: no pertenece a un casino y debe poder resolver
  // casos puntuales.
  const esAdministrador = operador?.rol === 'admin'
  if (!esAdministrador && existente.premio.sedeId != null && operador?.sedeId !== existente.premio.sedeId) {
    return res.status(403).json({
      error:
        `Este bono solo puede redimirse en ${existente.premio.sede?.nombre ?? 'su casino asignado'}. ` +
        `Indícale al cliente que se dirija allí.`,
      sedeRequerida: existente.premio.sede?.nombre ?? null,
      sedeActual: operador?.sede?.nombre ?? null,
    })
  }

  const resultado = await prisma.bonoGanado.updateMany({
    // El estado va en el WHERE a proposito: si dos cajeros confirman el mismo
    // codigo a la vez, solo uno actualiza una fila y el otro recibe el 409.
    where: { codigo, estado: 'pendiente' },
    data: {
      estado: 'reclamado',
      canjeadoEn: new Date(),
      canjeadoPorId: usuarioId,
      sedeCanjeId: operador?.sedeId ?? existente.premio.sedeId,
    },
  })

  if (resultado.count === 0) {
    return res.status(409).json({ error: 'Este bono ya fue canjeado anteriormente.' })
  }

  const bono = await buscarPorCodigo(codigo)
  return res.json({ ok: true, ...toCanjePreview(bono!) })
}))

// Historial de canjes, más reciente primero.
//
// Cada cajera ve ÚNICAMENTE los bonos que ella entregó: su panel es su propia
// caja y no tiene por qué ver el movimiento de sus compañeras. La visión
// completa del negocio es del admin, en /admin/canjes.
//
// Un admin que entre por este panel sí ve todo, porque para él no hay nada
// que aislar.
cajeroRouter.get('/historial', asyncHandler(async (req, res) => {
  const sesion = req.session!
  const esAdmin = sesion.tipo === 'staff' && sesion.rol === 'admin'
  const propios = sesion.tipo === 'staff' ? { canjeadoPorId: sesion.usuarioId } : {}

  const canjes = await prisma.bonoGanado.findMany({
    where: { estado: 'reclamado', ...(esAdmin ? {} : propios) },
    orderBy: { canjeadoEn: 'desc' },
    include: {
      premio: { include: { sede: { select: { nombre: true } } } },
      cliente: true,
      sedeCanjeada: { select: { nombre: true } },
      canjeadoPor: { select: { nombre: true } },
    },
  })

  return res.json({
    // `soloPropios` le permite al frontend titular la vista correctamente:
    // "Mis canjes" para una cajera, "Todos los canjes" para un admin.
    soloPropios: !esAdmin,
    canjes: canjes.map((bono) => ({
      codigo: bono.codigo,
      canjeadoEn: bono.canjeadoEn,
      canjeadoPor: bono.canjeadoPor?.nombre ?? null,
      sede: bono.sedeCanjeada?.nombre ?? null,
      premio: { nombre: bono.premio.nombre, monetario: bono.premio.monetario },
      cliente: { nombres: bono.cliente.nombres, apellidos: bono.cliente.apellidos, docNumero: bono.cliente.docNumero },
    })),
  })
}))
