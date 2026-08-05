import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { authRouter } from './routes/auth.routes.js'
import { ruletaRouter } from './routes/ruleta.routes.js'
import { adminRouter } from './routes/admin.routes.js'
import { cajeroRouter } from './routes/cajero.routes.js'

const app = express()

// CORS_ORIGIN acepta varios origenes separados por coma: en produccion el
// front vive en otro dominio de Render, asi que no basta con un valor fijo.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8443')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      // Sin cabecera Origin = health check de Render, curl o same-origin.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      callback(new Error('Origen no permitido por CORS.'))
    },
  }),
)
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api/ruleta', ruletaRouter)
app.use('/api/admin', adminRouter)
app.use('/api/cajero', cajeroRouter)

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' })
})

const port = Number(process.env.PORT || 4000)
app.listen(port, () => {
  console.log(`API de Gran Casino Cucuta escuchando en http://localhost:${port}`)
})
