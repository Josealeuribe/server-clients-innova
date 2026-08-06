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
// Sirven para el primer ingreso. Cada cajera debería cambiarla apenas entre;
// hoy no existe pantalla para eso (ver nota al final del archivo).
//
// Re-ejecutar este seed NO pisa las contraseñas: el `update` de abajo solo
// toca nombre y rol. Así, cuando alguien cambie la suya, no se le revierte.
const STAFF = [
  { nombre: 'Administrador', email: 'admin@grancasino.com.co', password: 'AdminCucuta0508', rol: 'admin' },
  // Cuenta genérica de pruebas. Se conserva a propósito: las suites e2e la usan.
  { nombre: 'Cajero', email: 'cajero@grancasino.com.co', password: 'CajeroCucuta0805', rol: 'cajero' },

  // --- Cajeras reales ---
  // El nombre es lo que ve el admin en la auditoría de canjes, así que va
  // completo: es la persona que responde por cada entrega.
  {
    nombre: 'Alisson Nicole Céspedes Figueroa',
    email: 'alisson.cespedes@grancasino.com.co',
    password: 'Alisson1091968222',
    rol: 'cajero',
  },
  {
    nombre: 'Lesly Viviana Naranjo Gordillo',
    email: 'lesly.naranjo@grancasino.com.co',
    password: 'Lesly1093801936',
    rol: 'cajero',
  },
  {
    nombre: 'Liliana Marcela Alfonso Gerena',
    email: 'liliana.alfonso@grancasino.com.co',
    password: 'Liliana1090400663',
    rol: 'cajero',
  },
  {
    nombre: 'Sulay Castro Salas',
    email: 'sulay.castro@grancasino.com.co',
    password: 'Sulay68295264',
    rol: 'cajero',
  },
  {
    nombre: 'Mayeli Paola Rojas García',
    email: 'mayeli.rojas@grancasino.com.co',
    password: 'Mayeli1090494259',
    rol: 'cajero',
  },
  {
    nombre: 'Stefany Daniela Álvarez Cordón',
    email: 'stefany.alvarez@grancasino.com.co',
    password: 'Stefany1005035932',
    rol: 'cajero',
  },
  {
    nombre: 'Lorena Jaimes Gauta',
    email: 'lorena.jaimes@grancasino.com.co',
    password: 'Lorena60264827',
    rol: 'cajero',
  },
]

async function main() {
  for (const staff of STAFF) {
    const passwordHash = await bcrypt.hash(staff.password, 10)
    await prisma.usuario.upsert({
      where: { email: staff.email },
      update: { nombre: staff.nombre, rol: staff.rol },
      create: { nombre: staff.nombre, email: staff.email, passwordHash, rol: staff.rol },
    })
  }
  const porRol = STAFF.reduce<Record<string, number>>((acc, s) => {
    acc[s.rol] = (acc[s.rol] ?? 0) + 1
    return acc
  }, {})
  console.log(`Seed de staff completo: ${STAFF.length} cuentas sincronizadas.`)
  console.log(`  ${Object.entries(porRol).map(([rol, n]) => `${rol}: ${n}`).join(' · ')}`)
}

// PENDIENTE: no existe forma de que una cajera cambie su propia contraseña.
// Mientras no la haya, las claves iniciales derivadas de la cédula son las
// definitivas, que es justo lo que no debería pasar.

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
