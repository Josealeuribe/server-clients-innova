import 'dotenv/config'
import express from 'express'
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

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api/ruleta', ruletaRouter)
app.use('/api/ubicaciones', ubicacionesRouter)
app.use('/api/admin', adminRouter)
app.use('/api/cajero', cajeroRouter)

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' })
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
