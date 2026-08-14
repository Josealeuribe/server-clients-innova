import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Cuentas de personal interno. No hay auto-registro para admin/cajero — se
// siembran una sola vez aquí. Para agregar más cajeros/admins más adelante,
// añade entradas a esta lista y vuelve a correr `npm run prisma:seed-staff`
// (usa upsert, así que es seguro re-ejecutarlo).
// OJO CON LAS CONTRASEÑAS INICIALES
//
// Se generan como {PrimerNombre}{Cédula}, tal como se pidió. Hay que ser
// claros en que eso es débil: en Colombia la cédula circula en formularios,
// fotocopias y bases de terceros, así que quien conozca el nombre y el
// documento de una cajera puede deducir su clave — y con esa cuenta se
// pueden marcar bonos como entregados.
//
// Sirven para el primer ingreso y NADA MÁS: las cuentas se crean con
// `debeCambiarPassword: true`, así que el panel obliga a cambiarla antes de
// dejar trabajar. Si alguien la olvida, el admin le genera una temporal desde
// su panel (Personal → Restablecer clave); no hay recuperación por correo
// porque estas direcciones no son buzones reales.
//
// Re-ejecutar este seed NO pisa las contraseñas: el `update` de abajo solo
// toca nombre y rol. Así, cuando alguien cambie la suya, no se le revierte.
// `sede` es la clave del casino donde trabaja cada persona (ver tabla `sedes`).
// Determina qué sede queda registrada al canjear: el bono se entregó donde
// está la cajera, no donde decía el premio. El admin va sin sede porque no
// pertenece a un casino concreto.
const STAFF = [
  { nombre: 'Administrador', email: 'admin@grancasino.com.co', password: 'AdminCucuta0508', rol: 'admin', sede: null },

  // Cuenta de soporte y monitoreo. Va con rol 'admin' a propósito: es la misma
  // vista del administrador, que es lo que se necesita para monitorear.
  //
  // No se creó un rol 'soporte' aparte porque el rol es un conjunto cerrado que
  // vive en cuatro capas — StaffRol en utils/jwt.ts, requireRole en las rutas,
  // el tipo del frontend y el enrutamiento tras el login. Un rol nuevo con los
  // mismos permisos que 'admin' habría costado tocar todo eso y desplegar front
  // y back, a cambio de ninguna diferencia de comportamiento.
  //
  // La consecuencia hay que tenerla clara: en la auditoría esta cuenta es
  // indistinguible de un administrador y puede restablecer contraseñas del
  // personal. Si algún día soporte debe poder ver sin poder tocar, ahí sí hace
  // falta el rol propio.
  { nombre: 'José Alejandro Uribe', email: 'jose@grancasino.com.co', password: 'SoporteGcc2026', rol: 'admin', sede: null },

  // Cuenta genérica de pruebas. Se conserva a propósito: las suites e2e la usan.
  { nombre: 'Cajero', email: 'cajero@grancasino.com.co', password: 'CajeroCucuta0805', rol: 'cajero', sede: 'avenida-0' },

  // --- Cajeras reales, todas de Gran Casino Cúcuta Av. 0 ---
  // El nombre es lo que ve el admin en la auditoría de canjes, y también el
  // cliente en su comprobante: es la persona que responde por cada entrega.
  {
    nombre: 'Alisson Nicole Céspedes Figueroa',
    email: 'alisson.cespedes@grancasino.com.co',
    password: 'Alisson1091968222',
    rol: 'cajero',
    sede: 'avenida-0',
  },
  {
    nombre: 'Lesly Viviana Naranjo Gordillo',
    email: 'lesly.naranjo@grancasino.com.co',
    password: 'Lesly1093801936',
    rol: 'cajero',
    sede: 'avenida-0',
  },
  {
    nombre: 'Liliana Marcela Alfonso Gerena',
    email: 'liliana.alfonso@grancasino.com.co',
    password: 'Liliana1090400663',
    rol: 'cajero',
    sede: 'avenida-0',
  },
  {
    nombre: 'Sulay Castro Salas',
    email: 'sulay.castro@grancasino.com.co',
    password: 'Sulay68295264',
    rol: 'cajero',
    sede: 'avenida-0',
  },
  {
    nombre: 'Mayeli Paola Rojas García',
    email: 'mayeli.rojas@grancasino.com.co',
    password: 'Mayeli1090494259',
    rol: 'cajero',
    sede: 'avenida-0',
  },
  {
    nombre: 'Stefany Daniela Álvarez Cordón',
    email: 'stefany.alvarez@grancasino.com.co',
    password: 'Stefany1005035932',
    rol: 'cajero',
    sede: 'avenida-0',
  },
  {
    nombre: 'Lorena Jaimes Gauta',
    email: 'lorena.jaimes@grancasino.com.co',
    password: 'Lorena60264827',
    rol: 'cajero',
    sede: 'avenida-0',
  },

  // --- Cajeras de Gran Casino Cúcuta Ventura Plaza ---
  {
    nombre: 'Katalina Soto',
    email: 'katalina.soto@grancasino.com.co',
    password: 'Katalina1093788802',
    rol: 'cajero',
    sede: 'ventura-plaza',
  },
  {
    nombre: 'Fernanda Carrillo',
    email: 'fernanda.carrillo@grancasino.com.co',
    password: 'Fernanda1092940982',
    rol: 'cajero',
    sede: 'ventura-plaza',
  },
  {
    nombre: 'Leidy Zapardiel',
    email: 'leidy.zapardiel@grancasino.com.co',
    password: 'Leidy60449024',
    rol: 'cajero',
    sede: 'ventura-plaza',
  },

  // --- Cajeras de Gran Casino Cúcuta Av. 5 ---
  {
    nombre: 'Yesica Lorena Moreno Carreño',
    email: 'yesica.moreno@grancasino.com.co',
    password: 'Yesica1090178677',
    rol: 'cajero',
    sede: 'av-5',
  },
  {
    nombre: 'Leidy Yulieth Fiallo Montañez',
    email: 'leidy.fiallo@grancasino.com.co',
    password: 'Leidy1090447613',
    rol: 'cajero',
    sede: 'av-5',
  },
]

async function main() {
  const idPorClave = new Map(
    (await prisma.sede.findMany({ select: { id: true, clave: true } })).map((s) => [s.clave, s.id]),
  )

  for (const staff of STAFF) {
    if (staff.sede && !idPorClave.has(staff.sede)) {
      throw new Error(
        `${staff.email} apunta a la sede "${staff.sede}", que no existe. Corre antes "npm run prisma:seed".`,
      )
    }
    const sedeId = staff.sede ? idPorClave.get(staff.sede)! : null
    const passwordHash = await bcrypt.hash(staff.password, 10)
    await prisma.usuario.upsert({
      where: { email: staff.email },
      // La contraseña no se toca: si alguien ya cambió la suya, no se revierte.
      // `debeCambiarPassword` tampoco: quien ya la cambió no vuelve a la
      // pantalla de cambio obligatorio solo por re-ejecutar el seed.
      update: { nombre: staff.nombre, rol: staff.rol, sedeId },
      create: {
        nombre: staff.nombre,
        email: staff.email,
        passwordHash,
        rol: staff.rol,
        sedeId,
        // La clave inicial se deriva de la cédula, que es semipública: sirve
        // para entrar una vez y cambiarla, no para quedarse.
        debeCambiarPassword: true,
      },
    })
  }
  const porRol = STAFF.reduce<Record<string, number>>((acc, s) => {
    acc[s.rol] = (acc[s.rol] ?? 0) + 1
    return acc
  }, {})
  console.log(`Seed de staff completo: ${STAFF.length} cuentas sincronizadas.`)
  console.log(`  ${Object.entries(porRol).map(([rol, n]) => `${rol}: ${n}`).join(' · ')}`)
}

// Resuelto: el panel de cajero y el de admin tienen "Mi cuenta → Cambiar
// contraseña" (POST /api/auth/cambiar-password), y el cambio es obligatorio
// mientras `debeCambiarPassword` esté en true. Las claves de esta lista ya no
// pueden quedarse puestas.

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
