-- Recuperación de contraseña.
--
-- DOS CAMINOS DISTINTOS, A PROPÓSITO
--
-- Cliente: recibe un código de 6 dígitos en el correo que él mismo registró.
--   Ese correo sí es real y sí lo revisa. La tabla `codigos_recuperacion`
--   guarda el código HASHEADO: mientras vive es la credencial de la cuenta,
--   así que no puede quedar legible para quien lea la base.
--
-- Personal: NO recibe correo. Las direcciones @grancasino.com.co son
--   identificadores de acceso, no buzones — el dominio no tiene registros MX
--   y no puede recibir nada. En su lugar el admin le genera una clave
--   temporal desde su panel y `debeCambiarPassword` la obliga a cambiarla al
--   entrar, para que la temporal no termine siendo la definitiva.
--
-- Aditiva: crea una tabla nueva y agrega una columna con DEFAULT. No toca ni
-- borra nada existente.

-- CreateTable
CREATE TABLE `codigos_recuperacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clienteId` INTEGER NOT NULL,
    `codigoHash` VARCHAR(191) NOT NULL,
    `expiraEn` DATETIME(3) NOT NULL,
    `intentos` INTEGER NOT NULL DEFAULT 0,
    `usadoEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ip` VARCHAR(191) NULL,

    INDEX `codigos_recuperacion_clienteId_expiraEn_idx`(`clienteId`, `expiraEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `codigos_recuperacion` ADD CONSTRAINT `codigos_recuperacion_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `debeCambiarPassword` BOOLEAN NOT NULL DEFAULT false;

-- Las cuentas que YA existen entran con la clave inicial derivada de la
-- cédula, que en Colombia es semipública. Se marcan todas para que la cambien
-- en su próximo ingreso: es justo el PENDIENTE anotado en prisma/seed-staff.ts.
UPDATE `usuarios` SET `debeCambiarPassword` = true;
