import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { weightedRandomIndex } from '../utils/weightedRandom.js'
import { signPrizeTicket, verifySessionToken } from '../utils/jwt.js'
import { girosUsadosPor, registrarGiro } from '../utils/visitante.js'

export const ruletaRouter = Router()

// Giros que puede hacer un mismo visitante. Recargar la página ya no sirve
// para volver a tirar: el conteo lo lleva el servidor contra una cookie
// httpOnly (ver utils/visitante.ts, que documenta hasta dónde llega esto).
export const GIROS_MAXIMOS = 3

// Cuántos giros le quedan al visitante. El frontend lo consulta al entrar
// para mostrar el contador sin tener que gastar un giro para averiguarlo.
ruletaRouter.get('/giros-restantes', async (req, res) => {
  const usados = await girosUsadosPor(req)
  return res.json({
    usados,
    maximo: GIROS_MAXIMOS,
    restantes: Math.max(0, GIROS_MAXIMOS - usados),
  })
})

// Giro anónimo: cualquier visitante puede girar sin haberse registrado
// (así funciona hoy la promoción). El servidor hace el sorteo ponderado
// real (el frontend ya NO decide el premio, solo la animación visual de
// la ruleta) y devuelve un ticket firmado que el registro usará para
// asignar el bono a la cuenta que se cree. El ticket expira en
// TICKET_TTL_MINUTES minutos.
ruletaRouter.post('/girar-anonimo', async (req, res) => {
  // La promocion es de captacion: gira unicamente quien no tiene sesion
  // abierta. Se rechaza a CUALQUIER sesion valida — clientes porque ya estan
  // registrados, y personal (admin/cajero) porque no participa en la
  // promocion y no debe poder generar tickets de premio.
  //
  // La regla vive aqui y no solo en el navegador: el frontend se puede
  // saltar, la API no.
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (token) {
    try {
      const sesion = verifySessionToken(token)
      const mensaje =
        sesion.tipo === 'cliente'
          ? 'La ruleta es solo para quienes aún no tienen cuenta. Consulta tus beneficios desde tu perfil.'
          : 'El personal de Gran Casino Cúcuta no participa en la promoción.'
      return res.status(409).json({ error: mensaje })
    } catch {
      // Token vencido o corrupto: se trata como visitante anonimo, que es el
      // caso normal de alguien cuya sesion expiro.
    }
  }

  // Se comprueba ANTES de sortear: si ya agotó sus giros, no tiene sentido
  // gastar un premio ni firmar un ticket que no va a poder usar.
  const yaUsados = await girosUsadosPor(req)
  if (yaUsados >= GIROS_MAXIMOS) {
    return res.status(429).json({
      error: `Ya usaste tus ${GIROS_MAXIMOS} giros de la promoción. Regístrate para reclamar el premio que obtuviste.`,
      usados: yaUsados,
      maximo: GIROS_MAXIMOS,
      restantes: 0,
    })
  }

  const premios = await prisma.premio.findMany({ where: { activo: true } })
  if (premios.length === 0) {
    return res.status(503).json({ error: 'No hay premios disponibles en este momento.' })
  }

  // El giro se cuenta aquí, cuando ya se sabe que hay premios que sortear:
  // así un 503 no le consume un intento a nadie.
  const { girosUsados } = await registrarGiro(req, res)

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
    usados: girosUsados,
    maximo: GIROS_MAXIMOS,
    restantes: Math.max(0, GIROS_MAXIMOS - girosUsados),
  })
})
