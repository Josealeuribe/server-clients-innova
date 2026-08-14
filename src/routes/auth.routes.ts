import { Router } from 'express'
import { asyncHandler } from '../utils/asyncHandler.js'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { signSessionToken, verifyPrizeTicket } from '../utils/jwt.js'
import { generarCodigoCanje } from '../utils/codigoCanje.js'
import { signResetToken, verifyResetToken } from '../utils/jwt.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { marcarFueraDeLinea, registrarPresencia } from '../middleware/presencia.js'
import { estadoDeBloqueo, limpiarFallos, registrarFallo } from '../utils/intentosLogin.js'
import { consumirCodigo, emitirCodigo, LIMITES_RECUPERACION, verificarCodigo } from '../utils/recuperacion.js'
import { enviarCodigoRecuperacion } from '../utils/correo.js'

export const authRouter = Router()

// Una sola definición de "contraseña aceptable", usada por el registro, por la
// recuperación y por el cambio desde el panel. Estaba escrita solo en el
// registro, y así se podía terminar con una contraseña más débil de la que se
// exigió al crear la cuenta.
const passwordSchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres.')
  .regex(/[A-Z]/, 'Debe incluir una mayúscula.')
  .regex(/[0-9]/, 'Debe incluir un número.')

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
    pass: passwordSchema,
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

// `sede` va en la sesion para que el panel de la cajera pueda mostrar en que
// casino esta trabajando, sin tener que consultarlo aparte.
function toSafeStaff(usuario: {
  id: number
  nombre: string
  email: string
  rol: string
  debeCambiarPassword: boolean
  sede?: { clave: string; nombre: string; direccion: string } | null
}) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    sede: usuario.sede ?? null,
    // El panel lo usa para obligar el cambio antes de dejar trabajar: es lo
    // que impide que una clave temporal (o la inicial derivada de la cédula)
    // se quede puesta para siempre.
    debeCambiarPassword: usuario.debeCambiarPassword,
  }
}

const STAFF_INCLUDE = { sede: { select: { clave: true, nombre: true, direccion: true } } } as const

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
        canjeadoPor: { nombre: string } | null
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
    // Dónde se redimió de verdad: el casino de quien lo entregó. Suele
    // coincidir con sedeRedencion, pero se guarda aparte para que un canje
    // hecho en otro casino quede visible.
    sede: bono.sedeCanjeada?.nombre ?? null,
    // Quién se lo entregó. Va en el comprobante del cliente: si más adelante
    // hay un reclamo, sabe con quién lo atendieron.
    canjeadoPor: bono.canjeadoPor?.nombre ?? null,
  }
}

// Include reutilizable: el bono siempre viaja con el premio, la sede donde se
// redime y la sede donde se redimió.
const BONO_INCLUDE = {
  premio: { include: { sede: { select: { clave: true, nombre: true, direccion: true } } } },
  sedeCanjeada: { select: { nombre: true, direccion: true } },
  canjeadoPor: { select: { nombre: true } },
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

  // Se comprueba ANTES de tocar la base de usuarios: a una cuenta bloqueada
  // ni siquiera se le evalúa la contraseña.
  const bloqueo = await estadoDeBloqueo(identifier)
  if (bloqueo.bloqueado) {
    const minutos = Math.ceil(bloqueo.segundosRestantes / 60)
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Vuelve a intentarlo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`,
      segundosRestantes: bloqueo.segundosRestantes,
    })
  }

  // Mensaje único para todos los fallos: no debe poder deducirse si un correo
  // está registrado. Se agrega cuántos intentos quedan, que es información
  // que el atacante ya puede contar por su cuenta y al usuario legítimo le
  // evita quedar bloqueado sin entender por qué.
  const rechazar = async () => {
    const { restantes } = await registrarFallo(req, identifier)
    return res.status(401).json({
      error: 'Credenciales inválidas.',
      intentosRestantes: restantes,
    })
  }

  // El personal (admin/cajero) entra por el mismo formulario de login que
  // los clientes, pero vive en una tabla separada — se identifica por
  // correo, nunca por documento.
  const staff = await prisma.usuario.findUnique({
    where: { email: identifier.toLowerCase() },
    include: STAFF_INCLUDE,
  })
  if (staff) {
    if (!staff.activo) {
      return res.status(401).json({ error: 'Esta cuenta está deshabilitada.' })
    }
    const passwordValida = await bcrypt.compare(password, staff.passwordHash)
    if (!passwordValida) {
      return rechazar()
    }
    await limpiarFallos(identifier)
    const token = signSessionToken({ tipo: 'staff', usuarioId: staff.id, email: staff.email, rol: staff.rol as 'admin' | 'cajero' })
    return res.json({ token, tipo: 'staff', staff: toSafeStaff(staff) })
  }

  const cliente = await prisma.cliente.findFirst({
    where: { OR: [{ email: identifier.toLowerCase() }, { docNumero: identifier }] },
  })
  if (!cliente) {
    return rechazar()
  }

  const passwordValida = await bcrypt.compare(password, cliente.passwordHash)
  if (!passwordValida) {
    return rechazar()
  }
  await limpiarFallos(identifier)

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

// --- Recuperación de contraseña (clientes) ---
//
// El personal NO pasa por aquí: sus direcciones @grancasino.com.co son
// identificadores de acceso, no buzones — el dominio no tiene registros MX y
// no puede recibir correo. A una cajera que pida recuperar se le dice
// explícitamente qué hacer (pedirle al administrador que se la restablezca),
// porque mandarla a revisar un correo que nunca va a llegar es peor: la deja
// sin poder trabajar y sin saber por qué.
//
// Eso revela que una dirección es de personal. Se acepta a sabiendas: las
// direcciones del staff son predecibles por construcción (nombre.apellido@) y
// el mensaje no dice si esa cuenta existe.

const recuperarSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ingresa un correo válido.'),
})

authRouter.post('/recuperar', asyncHandler(async (req, res) => {
  const parsed = recuperarSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
  }
  const { email } = parsed.data

  const staff = await prisma.usuario.findUnique({ where: { email }, select: { id: true } })
  if (staff) {
    return res.status(400).json({
      error:
        'Las cuentas del personal no recuperan contraseña por correo. Pídele al administrador que te genere una temporal desde su panel.',
      esStaff: true,
    })
  }

  const cliente = await prisma.cliente.findUnique({
    where: { email },
    select: { id: true, nombres: true, email: true },
  })

  // Respuesta idéntica exista o no la cuenta. Si se distinguiera, esta ruta se
  // convertiría en un comprobador de qué correos están registrados en un
  // casino — un dato que no le corresponde a nadie de fuera.
  const respuestaGenerica = {
    ok: true,
    mensaje: 'Si el correo está registrado, te enviamos un código para restablecer tu contraseña.',
    vigenciaMinutos: LIMITES_RECUPERACION.VIGENCIA_MINUTOS,
  }

  if (!cliente) return res.json(respuestaGenerica)

  const { emitido, demasiadasSolicitudes } = await emitirCodigo(req, cliente.id)
  if (demasiadasSolicitudes || !emitido) {
    // Este 429 sí distingue una cuenta existente de una que no (a la
    // inexistente nunca se le limita). Es un escape del anonimato de arriba, y
    // se acepta a cambio de no dejar al cliente legítimo pidiendo códigos que
    // no se van a enviar sin explicarle por qué. El escape además es menor que
    // /auth/disponibilidad, que dice sin rodeos si un correo está registrado.
    return res.status(429).json({
      error: `Ya pediste varios códigos seguidos. Espera unos minutos e intenta de nuevo, o revisa tu bandeja de spam.`,
    })
  }

  try {
    await enviarCodigoRecuperacion({
      para: cliente.email,
      nombre: cliente.nombres,
      codigo: emitido.codigo,
      minutos: LIMITES_RECUPERACION.VIGENCIA_MINUTOS,
    })
  } catch (error) {
    // El fallo del proveedor de correo se registra completo y se le dice al
    // cliente que no llegó. Devolver el mensaje genérico aquí lo dejaría
    // esperando indefinidamente un correo que ya se sabe que no salió.
    console.error('No se pudo enviar el código de recuperación:', error)
    return res.status(502).json({
      error: 'No pudimos enviar el correo en este momento. Intenta de nuevo en unos minutos.',
    })
  }

  return res.json(respuestaGenerica)
}))

const verificarSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ingresa un correo válido.'),
  codigo: z.string().trim().regex(/^\d{6}$/, 'El código son 6 dígitos.'),
})

authRouter.post('/recuperar/verificar', asyncHandler(async (req, res) => {
  const parsed = verificarSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
  }
  const { email, codigo } = parsed.data

  const cliente = await prisma.cliente.findUnique({ where: { email }, select: { id: true } })
  // Mismo mensaje que un código equivocado: si el correo no existe no debe
  // notarse la diferencia.
  const codigoInvalido = () =>
    res.status(400).json({ error: 'El código no es correcto o ya venció. Pide uno nuevo.' })

  if (!cliente) return codigoInvalido()

  const resultado = await verificarCodigo(cliente.id, codigo)
  if (!resultado.ok) {
    if (resultado.motivo === 'incorrecto' && resultado.intentosRestantes > 0) {
      return res.status(400).json({
        error: `El código no es correcto. Te ${resultado.intentosRestantes === 1 ? 'queda 1 intento' : `quedan ${resultado.intentosRestantes} intentos`}.`,
        intentosRestantes: resultado.intentosRestantes,
      })
    }
    if (resultado.motivo === 'agotado' || resultado.intentosRestantes === 0) {
      return res.status(400).json({
        error: 'Superaste los intentos permitidos para este código. Pide uno nuevo.',
        intentosRestantes: 0,
      })
    }
    return codigoInvalido()
  }

  return res.json({ token: signResetToken({ clienteId: cliente.id, codigoId: resultado.codigoId }) })
}))

const cambiarConCodigoSchema = z
  .object({
    token: z.string().min(1, 'Falta el token de verificación.'),
    pass: passwordSchema,
    passConfirm: z.string(),
  })
  .refine((data) => data.pass === data.passConfirm, {
    message: 'Las contraseñas no coinciden.',
    path: ['passConfirm'],
  })

authRouter.post('/recuperar/cambiar', asyncHandler(async (req, res) => {
  const parsed = cambiarConCodigoSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
  }

  let payload
  try {
    payload = verifyResetToken(parsed.data.token)
  } catch {
    return res.status(401).json({ error: 'La verificación expiró. Vuelve a pedir un código.' })
  }

  // El código se consume ANTES de tocar la contraseña. Si dos peticiones
  // llegan a la vez, solo una gana el `updateMany` y la otra se queda sin
  // cambiar nada: un mismo código no puede usarse dos veces.
  const consumido = await consumirCodigo(payload.codigoId, payload.clienteId)
  if (!consumido) {
    return res.status(400).json({ error: 'Ese código ya se usó o venció. Pide uno nuevo.' })
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: payload.clienteId },
    select: { id: true, email: true, docNumero: true },
  })
  if (!cliente) return res.status(404).json({ error: 'La cuenta ya no existe.' })

  const passwordHash = await bcrypt.hash(parsed.data.pass, 10)
  await prisma.cliente.update({ where: { id: cliente.id }, data: { passwordHash } })

  // Quien acaba de probar que controla el correo de la cuenta no debería
  // quedar bloqueado por los intentos fallidos que lo trajeron hasta aquí. Se
  // limpian los dos identificadores porque al login se entra con cualquiera.
  await limpiarFallos(cliente.email)
  await limpiarFallos(cliente.docNumero)

  return res.json({ ok: true })
}))

// --- Cambio de contraseña con la sesión abierta (clientes y personal) ---
//
// Para el personal es la única vía de cambiarla por sí mismo, y es la que
// cierra el PENDIENTE anotado en prisma/seed-staff.ts: hasta ahora la clave
// inicial derivada de la cédula era, en la práctica, la definitiva.

const cambiarPasswordSchema = z
  .object({
    actual: z.string().min(1, 'Ingresa tu contraseña actual.'),
    nueva: passwordSchema,
    confirmar: z.string(),
  })
  .refine((data) => data.nueva === data.confirmar, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmar'],
  })
  .refine((data) => data.nueva !== data.actual, {
    message: 'La nueva contraseña debe ser distinta de la actual.',
    path: ['nueva'],
  })

authRouter.post('/cambiar-password', requireAuth, asyncHandler(async (req, res) => {
  const parsed = cambiarPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
  }
  const { actual, nueva } = parsed.data
  const sesion = req.session!

  // Se exige la contraseña actual aunque ya haya sesión: una pantalla
  // desatendida en el mostrador de caja no debe alcanzar para adueñarse de la
  // cuenta de la cajera.
  if (sesion.tipo === 'staff') {
    const usuario = await prisma.usuario.findUnique({ where: { id: sesion.usuarioId } })
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' })

    if (!(await bcrypt.compare(actual, usuario.passwordHash))) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' })
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await bcrypt.hash(nueva, 10), debeCambiarPassword: false },
    })
    await limpiarFallos(usuario.email)
    return res.json({ ok: true })
  }

  const cliente = await prisma.cliente.findUnique({ where: { id: sesion.clienteId } })
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' })

  if (!(await bcrypt.compare(actual, cliente.passwordHash))) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta.' })
  }

  await prisma.cliente.update({
    where: { id: cliente.id },
    data: { passwordHash: await bcrypt.hash(nueva, 10) },
  })
  await limpiarFallos(cliente.email)
  await limpiarFallos(cliente.docNumero)

  return res.json({ ok: true })
}))

// --- Presencia del personal ---
//
// El latido que sostiene el "Activo" del módulo de Personal. El panel lo manda
// cada minuto mientras está abierto.
//
// POR QUÉ NO BASTA CON LAS PETICIONES NORMALES
//
// Una cajera puede pasar veinte minutos en el mostrador sin tocar el panel,
// esperando a que llegue alguien con un bono. Sin latido aparecería fuera de
// línea justo cuando sí está en su puesto, que es el caso que más importa
// acertar. Con él, el estado dice lo que se espera: el panel está abierto.
//
// El middleware `registrarPresencia` hace todo el trabajo (incluido el freno de
// escrituras); este handler solo confirma. Sirve para cualquier sesión: si
// llega de un cliente, el middleware la ignora y la respuesta es la misma, para
// no revelar qué tipo de cuenta hay detrás del token.
authRouter.post('/actividad', requireAuth, registrarPresencia, asyncHandler(async (_req, res) => {
  return res.json({ ok: true })
}))

// Cierre de sesión. Apaga la presencia de una vez, en vez de dejar la cuenta
// como "Activo" hasta que venza la ventana.
//
// LO QUE ESTE ENDPOINT NO HACE, DICHO CLARO: no invalida el token. La sesión es
// un JWT sin estado y sigue siendo válido hasta que expire — quien tenga ese
// token copiado puede seguir usándolo. Lo único que se apaga aquí es el
// indicador de presencia. Revocar de verdad exigiría una lista de tokens
// anulados, que hoy no existe.
//
// No falla si no hay nada que apagar: el navegador llama esto mientras cierra
// sesión y no tiene sentido mostrarle un error a alguien que ya se está yendo.
authRouter.post('/salir', requireAuth, asyncHandler(async (req, res) => {
  if (req.session?.tipo === 'staff') {
    await marcarFueraDeLinea(req.session.usuarioId)
  }
  return res.json({ ok: true })
}))

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  if (req.session?.tipo === 'staff') {
    const staff = await prisma.usuario.findUnique({
      where: { id: req.session.usuarioId },
      include: STAFF_INCLUDE,
    })
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
