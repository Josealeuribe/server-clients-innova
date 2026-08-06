import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { authRouter } from './routes/auth.routes.js'
import { ruletaRouter } from './routes/ruleta.routes.js'
import { adminRouter } from './routes/admin.routes.js'
import { cajeroRouter } from './routes/cajero.routes.js'
import { ubicacionesRouter } from './routes/ubicaciones.routes.js'

const app = express()

// Render sirve detrás de un proxy: sin esto req.ip devuelve la IP interna del
// balanceador en vez de la del visitante.
app.set('trust proxy', 1)

// CORS_ORIGIN acepta varios origenes separados por coma: en produccion el
// front vive en otro dominio de Render, asi que no basta con un valor fijo.
// Se normaliza la barra final porque un origen nunca la lleva: el navegador
// manda "https://sitio.com", asi que "https://sitio.com/" jamas coincidiria.
const normalizarOrigen = (valor: string) => valor.trim().replace(/\/+$/, '')

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8443')
  .split(',')
  .map(normalizarOrigen)
  .filter(Boolean)

console.log('CORS habilitado para:', allowedOrigins.join(', '))

app.use(
  cors({
    origin(origin, callback) {
      // Sin cabecera Origin = health check de Render, curl o same-origin.
      if (!origin || allowedOrigins.includes(normalizarOrigen(origin))) {
        return callback(null, true)
      }
      // Rechazar con `false` y no con un Error: un Error se convierte en un
      // 500 sin cabeceras CORS, que en el navegador se ve identico a un
      // servidor caido. Asi la respuesta es normal, solo sin permiso, y el
      // log deja ver que origen se rechazo.
      console.warn(`CORS: origen rechazado -> ${origin}`)
      return callback(null, false)
    },
    // La cookie de visitante anónimo (límite de giros) es cross-site en
    // producción: front y API viven en dominios distintos. Sin esto el
    // navegador no la manda de vuelta y el conteo nunca avanzaría.
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json())

// `baseRemota` existe para que las pruebas end-to-end puedan negarse a correr
// contra una base que no sea local. Pasó de verdad: el DATABASE_URL apuntaba a
// Aiven y las suites sembraron 319 clientes de prueba en producción.
// Es solo un booleano — no revela host, usuario ni credenciales.
const baseRemota = !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(process.env.DATABASE_URL ?? '')

app.get('/api/health', (_req, res) => res.json({ ok: true, baseRemota })) 
app.use('/api/auth', authRouter)
app.use('/api/ruleta', ruletaRouter)
app.use('/api/ubicaciones', ubicacionesRouter)
app.use('/api/admin', adminRouter)
app.use('/api/cajero', cajeroRouter)

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' })
})

// Manejador de errores. Recibe lo que los handlers async le pasan por next()
// (ver utils/asyncHandler.ts). Antes de esto, un fallo de base tumbaba el
// proceso entero y con él todas las peticiones en curso; ahora solo falla la
// que tuvo el problema.
//
// La firma DEBE tener los 4 parámetros: así es como Express distingue un
// middleware de error de uno normal, aunque `next` no se use.
app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  // Al log va el detalle completo, con la ruta, para poder rastrearlo.
  console.error(`Error no controlado en ${req.method} ${req.originalUrl}:`, error)

  if (res.headersSent) return

  // Al cliente solo un mensaje genérico: los errores de Prisma llevan dentro
  // fragmentos de consulta y nombres de columnas que no deben salir a la red.
  res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo en un momento.' })
})

// Una promesa rechazada sin capturar mata el proceso en Node moderno sin
// dejar rastro útil. Pasó de verdad: un pánico del motor de Prisma tumbó la
// API entera y en los logs solo quedaba el volcado del panic.
//
// No se intenta "seguir vivo" tras un error así — el estado del proceso queda
// dudoso. Se registra con contexto y se sale, para que Render lo reinicie
// limpio; lo que se gana es saber qué pasó.
process.on('unhandledRejection', (motivo) => {
  console.error('Promesa rechazada sin manejar. Cerrando para reinicio limpio:', motivo)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  console.error('Excepción no capturada. Cerrando para reinicio limpio:', error)
  process.exit(1)
})

const port = Number(process.env.PORT || 4000)
app.listen(port, () => {
  console.log(`API de Gran Casino Cucuta escuchando en http://localhost:${port}`)
})
