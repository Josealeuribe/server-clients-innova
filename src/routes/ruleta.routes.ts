import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { weightedRandomIndex } from '../utils/weightedRandom.js'
import { signPrizeTicket } from '../utils/jwt.js'

export const ruletaRouter = Router()

// Giro anónimo: cualquier visitante puede girar sin haberse registrado
// (así funciona hoy la promoción). El servidor hace el sorteo ponderado
// real (el frontend ya NO decide el premio, solo la animación visual de
// la ruleta) y devuelve un ticket firmado que el registro usará para
// asignar el bono a la cuenta que se cree. El ticket expira en
// TICKET_TTL_MINUTES minutos.
ruletaRouter.post('/girar-anonimo', async (_req, res) => {
  const premios = await prisma.premio.findMany({ where: { activo: true } })
  if (premios.length === 0) {
    return res.status(503).json({ error: 'No hay premios disponibles en este momento.' })
  }

  const index = weightedRandomIndex(premios.map((p) => p.weight))
  const premio = premios[index]
  const ticket = signPrizeTicket({ premioClave: premio.clave })

  return res.json({
    premio: {
      clave: premio.clave,
      nombre: premio.nombre,
      detalle: premio.detalle,
      monetario: premio.monetario,
    },
    ticket,
  })
})
