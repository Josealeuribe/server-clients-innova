import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'

// Presencia del personal: lo que hace posible el "Activo / Fuera de línea" del
// módulo de Personal.
//
// CÓMO SE SABE QUE ALGUIEN ESTÁ DENTRO
//
// La sesión es un JWT sin estado: el servidor no tiene lista de conectados y
// nadie le avisa cuando un navegador se cierra. Así que la presencia no se
// declara, se deduce de la última señal de vida (Usuario.ultimaActividad).
//
// Hay dos fuentes de señal, y se necesitan las dos:
//
//   1. Cualquier petición autenticada al panel (este middleware). Cubre a quien
//      está trabajando de verdad: buscar un código, canjear, listar clientes.
//
//   2. Un latido que el panel manda cada minuto mientras está abierto
//      (POST /api/auth/actividad). Sin esto, una cajera con el panel abierto
//      esperando clientes aparecería fuera de línea justo cuando sí está ahí.
//
// LO QUE ESTE ESTADO SIGNIFICA Y LO QUE NO
//
// Significa "hubo actividad de esta cuenta en los últimos
// VENTANA_EN_LINEA_SEGUNDOS". No significa que la persona esté mirando la
// pantalla. Hay dos desfases inevitables que conviene tener claros:
//
//   - Al salir: si alguien cierra sesión, el logout limpia la marca y el estado
//     cae de inmediato. Pero si cierra la pestaña de golpe, se le va el internet
//     o se le apaga el equipo, nadie avisa: la cuenta sigue "Activo" hasta que
//     vence la ventana (unos 3 minutos).
//
//   - En segundo plano: el navegador congela los temporizadores de las pestañas
//     ocultas, así que una pestaña de fondo deja de latir y la cuenta cae a
//     fuera de línea. Es el comportamiento buscado — con la pestaña escondida no
//     se está en el aplicativo — y al volver a ella el panel late enseguida.

// Cuánto vale una señal de vida antes de considerarse vieja. Es el triple del
// intervalo del latido (60 s): así un latido perdido por una red lenta o por el
// throttling del navegador no marca a nadie como ausente por error.
export const VENTANA_EN_LINEA_SEGUNDOS = 180

// Cada cuánto se permite ESCRIBIR en base, como máximo, por cuenta.
//
// Sin este freno, el panel del cajero —que dispara varias peticiones por
// búsqueda— provocaría un UPDATE por cada una. La base es un plan pequeño de
// Aiven con conexiones contadas; gastarlas en marcar presencia sería un
// autogol. Con 30 s la marca nunca queda más de 30 s desactualizada, muy por
// dentro de la ventana de 180 s.
const GUARDAR_CADA_SEGUNDOS = 30

// Última escritura por cuenta, en memoria del proceso.
//
// En memoria y no en base a propósito: consultar la base para decidir si hay
// que escribir en la base no ahorraría nada. Se acepta que sea por proceso: si
// algún día hay varias instancias, cada una escribe como máximo una vez cada
// GUARDAR_CADA_SEGUNDOS, y el resultado es igual de correcto — solo se escribe
// un poco más. El mapa está acotado por el número de cuentas de personal (~15),
// así que no crece sin control.
const ultimaEscritura = new Map<number, number>()

/** ¿Cuenta esta marca como presencia ahora mismo? */
export function estaEnLinea(ultimaActividad: Date | null): boolean {
  if (!ultimaActividad) return false
  return Date.now() - ultimaActividad.getTime() < VENTANA_EN_LINEA_SEGUNDOS * 1000
}

// Debe usarse SIEMPRE después de requireAuth: lee req.session.
//
// No espera a la base ni la deja fallar hacia el cliente. Marcar presencia es
// accesorio: si la base va lenta, la cajera no tiene por qué esperar, y si el
// UPDATE falla, la petición que estaba atendiendo debe seguir su curso.
export function registrarPresencia(req: Request, _res: Response, next: NextFunction) {
  const sesion = req.session
  if (sesion?.tipo !== 'staff') return next()

  const id = sesion.usuarioId
  const ahora = Date.now()
  if (ahora - (ultimaEscritura.get(id) ?? 0) < GUARDAR_CADA_SEGUNDOS * 1000) return next()

  // Se apunta ANTES de escribir para que dos peticiones simultáneas no lancen
  // dos UPDATE iguales.
  ultimaEscritura.set(id, ahora)

  // El .catch() NO es decorativo: esta promesa queda flotando, y una promesa
  // rechazada sin manejar mata el proceso (ver process.on('unhandledRejection')
  // en index.ts). Sin él, un hipo de la base tumbaría la API entera.
  prisma.usuario
    .update({ where: { id }, data: { ultimaActividad: new Date(ahora) } })
    .catch((error: unknown) => {
      // Se borra la marca para poder reintentar en la siguiente petición en vez
      // de quedarse callado GUARDAR_CADA_SEGUNDOS segundos.
      ultimaEscritura.delete(id)
      console.warn(`No se pudo registrar la presencia del usuario ${id}:`, error)
    })

  return next()
}

// Cierre de sesión: la cuenta pasa a fuera de línea de inmediato en vez de
// esperar a que venza la ventana.
//
// OJO CON LO QUE ESTO NO HACE: no invalida el token. La sesión es un JWT sin
// estado y sigue siendo válido hasta que expire; lo único que se apaga aquí es
// el indicador de presencia. Cerrar sesión de verdad del lado del servidor
// exigiría una lista de tokens revocados, que hoy no existe.
export async function marcarFueraDeLinea(usuarioId: number): Promise<void> {
  ultimaEscritura.delete(usuarioId)
  await prisma.usuario.update({ where: { id: usuarioId }, data: { ultimaActividad: null } })
}
