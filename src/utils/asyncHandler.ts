import type { NextFunction, Request, RequestHandler, Response } from 'express'

// Express 4 no captura los rechazos de los handlers `async`. Si dentro de una
// ruta falla una consulta a Prisma, la promesa queda rechazada sin manejar y
// Node cierra el PROCESO ENTERO: se cae toda la API, no solo esa petición.
//
// Con la base en Aiven —fuera de Render— un corte de red momentáneo es
// cuestión de tiempo, así que no es un escenario teórico.
//
// Este envoltorio reenvía el error a Express con next(), que lo entrega al
// middleware de errores de index.ts. Resultado: la petición que falló
// responde 500 y el servidor sigue atendiendo a todos los demás.
//
// Cuando se migre a Express 5 esto deja de hacer falta: allí los rechazos de
// handlers async ya van a next() automáticamente.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}
