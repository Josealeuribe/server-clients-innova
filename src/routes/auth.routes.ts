import { Router } from 'express'
import { asyncHandler } from '../utils/asyncHandler.js'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { signSessionToken, verifyPrizeTicket } from '../utils/jwt.js'
import { generarCodigoCanje } from '../utils/codigoCanje.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const authRouter = Router()

// Chequeo de disponibilidad en tiempo real (antes de enviar el formulario):
// el frontend lo llama con debounce mientras el usuario escribe su correo o
// documento, para avisarle de inmediato si ya existe una cuenta, en vez de
// que se entere solo hasta que intente enviar el registro completo.
authRouter.get('/disponibilidad', asyncHandler(async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : undefined
  const docNum = typeof req.query.docNum === 'string' ? req.query.docNum.trim() : undefined

  if (!email && !docNum) {
    return res.status(400).json({ error: 'Debes enviar email o docNum.' })
  }

  const result: { emailDisponible?: boolean; docNumDisponible?: boolean } = {}

  if (email) {
    const existente = await prisma.cliente.findUnique({ where: { email } })
    result.emailDisponible = !existente
  }
  if (docNum) {
    const existente = await prisma.cliente.findUnique({ where: { docNumero: docNum } })
    result.docNumDisponible = !existente
  }

  return res.json(result)
}))

const registerSchema = z
  .object({
    nombres: z.string().trim().min(1, 'Nombres requeridos.'),
    apellidos: z.string().trim().min(1, 'Apellidos requeridos.'),
    docType: z.enum(['Cédula de Ciudadanía', 'Pasaporte', 'Tarjeta de Extranjería']),
    docNum: z.string().trim().min(3, 'Número de documento inválido.'),
    birth: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha de nacimiento inválida.'),
    phone: z.string().trim().min(7, 'Número de celular inválido.'),
    dept: z.string().trim().min(1, 'Departamento requerido.'),
    city: z.string().trim().min(1, 'Ciudad requerida.'),
    email: z.string().trim().toLowerCase().email('Correo inválido.'),
    pass: z
      .string()
      .min(8, 'Mínimo 8 caracteres.')
      .regex(/[A-Z]/, 'Debe incluir una mayúscula.')
      .regex(/[0-9]/, 'Debe incluir un número.'),
    passConfirm: z.string(),
    terminos: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos.' }) }),
    datos: z.literal(true, { errorMap: () => ({ message: 'Debes autorizar el tratamiento de datos.' }) }),
    edad: z.literal(true, { errorMap: () => ({ message: 'Debes confirmar que eres mayor de edad.' }) }),
    promo: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar las condiciones de la promoción.' }) }),
    comms: z.boolean().default(false),
    ticket: z.string().optional(),
  })
  .refine((data) => data.pass === data.passConfirm, {
    message: 'Las contraseñas no coinciden.',
    path: ['passConfirm'],
  })

function toSafeCliente(cliente: {
  id: number
  nombres: string
  apellidos: string
  email: string
  docNumero: string
  telefono: string
  departamento: string
  ciudad: string
}) {
  return {
    id: cliente.id,
    nombres: cliente.nombres,
    apellidos: cliente.apellidos,
    email: cliente.email,
    docNumero: cliente.docNumero,
    telefono: cliente.telefono,
    departamento: cliente.departamento,
    ciudad: cliente.ciudad,
  }
}

function toSafeStaff(usuario: { id: number; nombre: string; email: string; rol: string }) {
  return { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }
}

// `bono` se oculta en cuanto el cajero lo canjea (ver toSafeBono), asi que
// por si solo no distingue "nunca participo" de "ya redimio". La ruleta
// necesita esa diferencia para bloquear un segundo giro, y para eso esta
// este flag: es true si el cliente tiene un BonoGanado en cualquier estado.
// La regla de negocio real la impone la base (BonoGanado.clienteId @unique):
// un cliente no puede acumular mas de un bono en toda su vida.
function toEstadoParticipacion(bono: { estado: string } | null) {
  if (!bono) return { yaParticipo: false, bonoCanjeado: false }
  return { yaParticipo: true, bonoCanjeado: bono.estado === 'reclamado' }
}

// El bono se le sigue mostrando al cliente DESPUES de canjeado, como
// constancia de que lo redimio: con la fecha y la sede donde se lo
// entregaron. Antes se ocultaba en cuanto pasaba a 'reclamado', pero eso
// dejaba al cliente sin ningun rastro de su premio, que es justo lo que
// necesita si mas adelante hay un reclamo.
//
// `estado` es lo que distingue "disponible para redimir" de "ya redimido";
// la vista de cliente lo usa para no invitar a presentar un codigo muerto.
function toSafeBono(
  bono:
    | {
        codigo: string
        estado: string
        creadoEn: Date
        canjeadoEn: Date | null
        vigenciaHasta: Date
        sedeCanjeada: { nombre: string; direccion: string } | null
        premio: {
          clave: string
          nombre: string
          detalle: string
          monetario: boolean
          sede: { clave: string; nombre: string; direccion: string } | null
        }
      }
    | null,
) {
  if (!bono) return null
  const { sede, ...premio } = bono.premio
  return {
    codigo: bono.codigo,
    estado: bono.estado,
    creadoEn: bono.creadoEn,
    canjeadoEn: bono.canjeadoEn,
    vigenciaHasta: bono.vigenciaHasta,
    premio,
    // Dónde DEBE ir el cliente a redimirlo: es la sede dueña del premio.
    sedeRedencion: sede,
    // Dónde se redimió de verdad. Normalmente la misma, pero se guarda aparte
    // para que un canje hecho en otra sede quede visible en la auditoría.
    sede: bono.sedeCanjeada?.nombre ?? null,
  }
}

// Include reutilizable: el bono siempre viaja con el premio, la sede donde se
// redime y la sede donde se redimió.
const BONO_INCLUDE = {
  premio: { include: { sede: { select: { clave: true, nombre: true, direccion: true } } } },
  sedeCanjeada: { select: { nombre: true, direccion: true } },
} as const

authRouter.post('/register', asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
  }
  const data = parsed.data

  const nacimiento = new Date(data.birth)
  const edadAnios = Math.floor((Date.now() - nacimiento.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
  if (edadAnios < 18) {
    return res.status(400).json({ error: 'Debes ser mayor de 18 años para registrarte.' })
  }

  // El departamento y la ciudad se validan contra la tabla de ubicaciones.
  // Antes se aceptaba cualquier texto: bastaba con llamar la API a mano para
  // guardar un cliente en una ciudad inexistente.
  const municipio = await prisma.municipio.findFirst({
    where: { nombre: data.city, departamento: { nombre: data.dept, activo: true } },
    select: { id: true },
  })
  if (!municipio) {
    return res.status(400).json({ error: 'El departamento o la ciudad seleccionados no son válidos.' })
  }

  const existente = await prisma.cliente.findFirst({
    where: { OR: [{ email: data.email }, { docNumero: data.docNum }] },
  })
  if (existente) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo o documento.' })
  }

  const passwordHash = await bcrypt.hash(data.pass, 10)

  let premioTicket: { clave: string } | null = null
  let bonoError: string | null = null
  if (data.ticket) {
    try {
      const payload = verifyPrizeTicket(data.ticket)
      premioTicket = { clave: payload.premioClave }
    } catch {
      bonoError = 'Tu premio ya no está disponible (el tiempo para reclamarlo expiró).'
    }
  }

  // El premio se consulta ANTES de abrir la transacción: es catálogo de solo
  // lectura y no tiene por qué alargarla. Las transacciones interactivas de
  // Prisma tienen un tope de tiempo y, si se pasa, el registro completo falla.
  const premio = premioTicket
    ? await prisma.premio.findUnique({ where: { clave: premioTicket.clave } })
    : null
  if (premioTicket && (!premio || !premio.activo)) {
    bonoError = 'Tu premio ya no está disponible.'
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({
        data: {
          nombres: data.nombres,
          apellidos: data.apellidos,
          docTipo: data.docType,
          docNumero: data.docNum,
          nacimiento,
          telefono: data.phone,
          departamento: data.dept,
          ciudad: data.city,
          email: data.email,
          passwordHash,
        },
      })

      await tx.consentimiento.createMany({
        data: [
          { clienteId: cliente.id, tipo: 'terminos', aceptado: data.terminos },
          { clienteId: cliente.id, tipo: 'datos', aceptado: data.datos },
          { clienteId: cliente.id, tipo: 'edad', aceptado: data.edad },
          { clienteId: cliente.id, tipo: 'promo', aceptado: data.promo },
          { clienteId: cliente.id, tipo: 'comms', aceptado: data.comms },
        ],
      })

      let bono = null
      if (premio && premio.activo) {
        // El código debe ser único (columna @unique en BonoGanado). Con 6
        // caracteres hex la colisión es prácticamente imposible, pero el
        // reintento se mantiene: la unicidad la impone la base y hay que
        // saber reaccionar si alguna vez choca.
        for (let intento = 0; intento < 5 && !bono; intento++) {
          try {
            bono = await tx.bonoGanado.create({
              data: {
                clienteId: cliente.id,
                premioId: premio.id,
                codigo: generarCodigoCanje(),
                // Copia de la vigencia del premio: si mañana se extiende o
                // acorta la promoción, este bono conserva la condición con
                // la que se entregó.
                vigenciaHasta: premio.vigenciaHasta,
              },
              include: BONO_INCLUDE,
            })
          } catch (error) {
            const esColisionDeCodigo =
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002' &&
              (error.meta?.target as string[] | undefined)?.includes('codigo')
            if (!esColisionDeCodigo || intento === 4) throw error
          }
        }
      }

      return { cliente, bono }
    },
    {
      // El tope por defecto son 5 s. Un pico de carga o una base remota
      // (Aiven está fuera de Render) puede rozarlo, y pasarse significa
      // perder el registro completo de un cliente. 20 s da margen de sobra
      // sin dejar transacciones colgadas indefinidamente.
      timeout: 20_000,
      maxWait: 10_000,
    })

    const token = signSessionToken({ tipo: 'cliente', clienteId: resultado.cliente.id, email: resultado.cliente.email })

    return res.status(201).json({
      token,
      tipo: 'cliente',
      cliente: toSafeCliente(resultado.cliente),
      bono: toSafeBono(resultado.bono),
      ...toEstadoParticipacion(resultado.bono),
      bonoError,
    })
  } catch (error) {
    console.error('Error creando cliente:', error)
    return res.status(500).json({ error: 'No se pudo crear la cuenta. Intenta de nuevo.' })
  }
}))

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Ingresa tu correo o documento.'),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
})

authRouter.post('/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
  }
  const { identifier, password } = parsed.data

  // El personal (admin/cajero) entra por el mismo formulario de login que
  // los clientes, pero vive en una tabla separada — se identifica por
  // correo, nunca por documento.
  const staff = await prisma.usuario.findUnique({ where: { email: identifier.toLowerCase() } })
  if (staff) {
    if (!staff.activo) {
      return res.status(401).json({ error: 'Esta cuenta está deshabilitada.' })
    }
    const passwordValida = await bcrypt.compare(password, staff.passwordHash)
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales inválidas.' })
    }
    const token = signSessionToken({ tipo: 'staff', usuarioId: staff.id, email: staff.email, rol: staff.rol as 'admin' | 'cajero' })
    return res.json({ token, tipo: 'staff', staff: toSafeStaff(staff) })
  }

  const cliente = await prisma.cliente.findFirst({
    where: { OR: [{ email: identifier.toLowerCase() }, { docNumero: identifier }] },
  })
  if (!cliente) {
    return res.status(401).json({ error: 'Credenciales inválidas.' })
  }

  const passwordValida = await bcrypt.compare(password, cliente.passwordHash)
  if (!passwordValida) {
    return res.status(401).json({ error: 'Credenciales inválidas.' })
  }

  const bono = await prisma.bonoGanado.findUnique({ where: { clienteId: cliente.id }, include: BONO_INCLUDE })
  const token = signSessionToken({ tipo: 'cliente', clienteId: cliente.id, email: cliente.email })

  return res.json({
    token,
    tipo: 'cliente',
    cliente: toSafeCliente(cliente),
    bono: toSafeBono(bono),
    ...toEstadoParticipacion(bono),
  })
}))

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  if (req.session?.tipo === 'staff') {
    const staff = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } })
    if (!staff) return res.status(404).json({ error: 'Usuario no encontrado.' })
    return res.json({ tipo: 'staff', staff: toSafeStaff(staff) })
  }

  const clienteId = req.session?.tipo === 'cliente' ? req.session.clienteId : undefined
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } })
  if (!cliente) {
    return res.status(404).json({ error: 'Cliente no encontrado.' })
  }
  const bono = await prisma.bonoGanado.findUnique({ where: { clienteId: cliente.id }, include: BONO_INCLUDE })

  return res.json({
    tipo: 'cliente',
    cliente: toSafeCliente(cliente),
    bono: toSafeBono(bono),
    ...toEstadoParticipacion(bono),
  })
}))
