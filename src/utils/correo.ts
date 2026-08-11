// Envío de correo transaccional (hoy: el código de recuperación de contraseña).
//
// POR QUÉ NO HAY DEPENDENCIA NUEVA
//
// Resend se usa por su API HTTP con `fetch`, que Node 22 ya trae de fábrica.
// Agregar el SDK habría metido otro paquete al build de Render a cambio de
// nada: son treinta líneas.
//
// SI NO HAY API KEY, NO SE CAE NADA
//
// Sin RESEND_API_KEY el envío entra en MODO CONSOLA: el código se imprime en
// el log del servidor y el flujo sigue funcionando completo. Es lo que
// permite desarrollar y probar en local sin credenciales, y que un despliegue
// al que se le olvidó la variable falle de forma visible en el log en vez de
// dejar al cliente esperando un correo que nunca se envió.
//
// LÍMITE ACTUAL, DICHO CLARO
//
// El front está en gran-casino-cucuta1.onrender.com, un dominio de Render
// sobre el que no se pueden crear registros DNS. Sin DNS propio no se puede
// verificar un dominio remitente, y el remitente de pruebas de Resend
// (onboarding@resend.dev) SOLO entrega al correo del dueño de la cuenta de
// Resend. Es decir: el flujo queda completo y probado, pero hasta que exista
// un dominio propio con SPF/DKIM verificados, los correos a clientes reales
// no van a llegar. Ver RESEND_FROM en .env.example.

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim()
const RESEND_FROM = process.env.RESEND_FROM?.trim() || 'Gran Casino Cúcuta <onboarding@resend.dev>'

export interface ResultadoEnvio {
  /** false cuando se imprimió en consola en vez de enviarse de verdad. */
  enviado: boolean
  modo: 'resend' | 'consola'
}

interface Mensaje {
  para: string
  asunto: string
  html: string
  texto: string
}

async function enviar(mensaje: Mensaje): Promise<ResultadoEnvio> {
  if (!RESEND_API_KEY) {
    console.warn(
      `[correo] RESEND_API_KEY no configurada — no se envió nada.\n` +
        `         Para: ${mensaje.para}\n` +
        `         Asunto: ${mensaje.asunto}\n` +
        `         ${mensaje.texto.replace(/\n/g, '\n         ')}`,
    )
    return { enviado: false, modo: 'consola' }
  }

  // El timeout es explícito: sin él, una API lenta deja colgada la petición
  // del cliente, que está mirando un botón en "Enviando...".
  const corte = AbortSignal.timeout(10_000)

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [mensaje.para],
      subject: mensaje.asunto,
      html: mensaje.html,
      text: mensaje.texto,
    }),
    signal: corte,
  })

  if (!respuesta.ok) {
    // El cuerpo del error de Resend dice exactamente qué pasó (dominio sin
    // verificar, destinatario no permitido en modo pruebas, cuota). Va al log
    // completo; al cliente nunca, porque nombra el remitente y la cuenta.
    const detalle = await respuesta.text().catch(() => '')
    throw new Error(`Resend respondió ${respuesta.status}: ${detalle.slice(0, 500)}`)
  }

  return { enviado: true, modo: 'resend' }
}

// El correo se ve igual que la landing (fondo oscuro, dorado) para que el
// cliente lo reconozca y no lo tome por phishing. Va con versión de texto
// plano porque hay clientes de correo que no cargan HTML.
export function enviarCodigoRecuperacion(params: {
  para: string
  nombre: string
  codigo: string
  minutos: number
}): Promise<ResultadoEnvio> {
  const { para, nombre, codigo, minutos } = params

  const texto = [
    `Hola ${nombre},`,
    '',
    `Tu código para restablecer la contraseña de Gran Casino Cúcuta es: ${codigo}`,
    '',
    `El código vence en ${minutos} minutos y solo se puede usar una vez.`,
    'Si no pediste este cambio, ignora este mensaje: tu contraseña sigue igual.',
    '',
    'Gran Casino Cúcuta — Nunca te pediremos este código por teléfono ni por WhatsApp.',
  ].join('\n')

  const html = `
<div style="margin:0;padding:32px 16px;background:#0a0805;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:linear-gradient(145deg,#1C1810,#121009);border:1px solid rgba(212,175,55,0.25);border-radius:20px;padding:32px">
    <p style="margin:0 0 4px;color:#D4AF37;font-size:11px;font-weight:bold;letter-spacing:3px;text-transform:uppercase">Gran Casino Cúcuta</p>
    <h1 style="margin:0 0 16px;color:#F5E6C8;font-size:22px">Restablece tu contraseña</h1>
    <p style="margin:0 0 20px;color:#C4A97A;font-size:14px;line-height:1.6">
      Hola ${escaparHtml(nombre)}, usa este código para crear tu nueva contraseña:
    </p>
    <div style="margin:0 0 20px;padding:18px;text-align:center;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.3);border-radius:14px">
      <span style="color:#D4AF37;font-size:34px;font-weight:bold;letter-spacing:10px;font-family:'Courier New',monospace">${escaparHtml(codigo)}</span>
    </div>
    <p style="margin:0 0 12px;color:#9A7B50;font-size:13px;line-height:1.6">
      Vence en <strong style="color:#C4A97A">${minutos} minutos</strong> y solo se puede usar una vez.
    </p>
    <p style="margin:0 0 20px;color:#9A7B50;font-size:13px;line-height:1.6">
      Si no pediste este cambio, ignora este mensaje: tu contraseña sigue igual.
    </p>
    <hr style="border:0;border-top:1px solid rgba(212,175,55,0.15);margin:0 0 16px">
    <p style="margin:0;color:#6B5D3F;font-size:11px;line-height:1.6">
      Nunca te pediremos este código por teléfono ni por WhatsApp. Juega responsablemente. Prohibido para menores de 18 años.
    </p>
  </div>
</div>`.trim()

  return enviar({
    para,
    asunto: `${codigo} es tu código para restablecer la contraseña`,
    html,
    texto,
  })
}

// El nombre viene de la base y termina dentro del HTML del correo. Escaparlo
// evita que un nombre con `<` rompa la plantilla.
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
