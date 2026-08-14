import { randomInt } from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { asyncHandler } from '../utils/asyncHandler.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/requireAuth.js'
import { estaEnLinea, registrarPresencia, VENTANA_EN_LINEA_SEGUNDOS } from '../middleware/presencia.js'

export const adminRouter = Router()

// `registrarPresencia` va de último: necesita la sesión que deja requireAuth, y
// no tiene sentido marcar como presente a quien el rol va a rechazar.
adminRouter.use(requireAuth, requireRole('admin'), registrarPresencia)

// Panel de administrador: toda la información de los clientes registrados,
// incluyendo el estado real de su bono (pendiente/reclamado) — a diferencia
// de lo que ve el propio cliente, aquí SÍ se muestra un bono ya canjeado.
adminRouter.get('/clientes', asyncHandler(async (_req, res) => {
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
}))

// --- Personal ---
//
// POR QUÉ EL RESET DEL PERSONAL VIVE AQUÍ Y NO EN EL CORREO
//
// Las direcciones @grancasino.com.co son identificadores de acceso, no
// buzones: el dominio no tiene registros MX y no puede recibir nada. Un
// "olvidé mi contraseña" por correo dejaría a la cajera esperando un mensaje
// que nunca llega, y sin poder entregar bonos en su turno.
//
// El administrador le genera una clave temporal, se la dice en persona o por
// el canal interno, y `debeCambiarPassword` obliga a cambiarla al entrar. Así
// la temporal no se queda puesta, que es exactamente lo que pasó con las
// claves iniciales derivadas de la cédula.

adminRouter.get('/usuarios', asyncHandler(async (_req, res) => {
  const usuarios = await prisma.usuario.findMany({
    orderBy: [{ rol: 'asc' }, { nombre: 'asc' }],
    include: { sede: { select: { nombre: true } }, _count: { select: { canjes: true } } },
  })

  return res.json({
    usuarios: usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      sede: u.sede?.nombre ?? null,
      debeCambiarPassword: u.debeCambiarPassword,
      canjes: u._count.canjes,
      createdAt: u.createdAt,
      // Presencia. `enLinea` lo decide el SERVIDOR y no el navegador: comparar
      // la marca contra el reloj del equipo del admin daría un estado distinto
      // en cada máquina mal sincronizada, y en un mostrador eso pasa.
      //
      // Se manda además la marca cruda para poder decir "hace 12 min", que es
      // el dato que de verdad sirve cuando alguien NO está: distingue "acaba de
      // salir" de "no ha entrado en todo el turno".
      ultimaActividad: u.ultimaActividad,
      enLinea: estaEnLinea(u.ultimaActividad),
    })),
    // Va en la respuesta para que el panel pueda explicar el criterio sin
    // repetir la constante en el frontend, donde se desincronizaría.
    ventanaEnLineaSegundos: VENTANA_EN_LINEA_SEGUNDOS,
  })
}))

// Alfabeto sin caracteres que se confunden al dictarlos: nada de O/0, I/l/1.
// La clave se transmite de viva voz en el mostrador, así que un carácter
// ambiguo se traduce en una cajera que no puede entrar.
const ALFABETO_TEMPORAL = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

// Cumple la misma política que exige el registro (8+, una mayúscula, un
// número): la temporal no puede ser más débil que la definitiva.
function generarPasswordTemporal(): string {
  const cuerpo = Array.from({ length: 8 }, () => ALFABETO_TEMPORAL[randomInt(0, ALFABETO_TEMPORAL.length)]).join('')
  return `Gcc${cuerpo}${randomInt(0, 10)}`
}

adminRouter.post('/usuarios/:id/restablecer-password', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Usuario inválido.' })
  }

  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { id: true, nombre: true, email: true } })
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' })

  const temporal = generarPasswordTemporal()
  await prisma.usuario.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(temporal, 10), debeCambiarPassword: true },
  })

  // Queda en el log del servidor quién restableció a quién. Sin la clave, por
  // supuesto: el log lo lee más gente de la que debería poder entrar a esa
  // cuenta.
  console.warn(
    `Contraseña restablecida: ${usuario.email} por admin ${req.session?.tipo === 'staff' ? req.session.email : 'desconocido'}`,
  )

  // La temporal se devuelve UNA sola vez, en esta respuesta, y no se guarda en
  // ningún lado en claro. Si el admin la pierde, genera otra.
  return res.json({ ok: true, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email }, temporal })
}))

// Auditoría de canjes: la traza completa de cada bono entregado, ordenada por
// fecha de canje. Responde "quién entregó qué, a quién, cuándo y en qué sede",
// que es lo que se necesita para cuadrar caja o resolver un reclamo.
//
// El cajero tiene su propio historial (/cajero/historial); este es el mismo
// hecho para el admin, con el dato extra de cuánto tardó el cliente en ir a
// redimir y el correo del titular.
adminRouter.get('/canjes', asyncHandler(async (_req, res) => {
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
}))
