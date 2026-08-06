-- Departamentos y municipios en base (antes vivían en un archivo del
-- frontend, así que el backend no podía validar contra ellos), y registro
-- de visitantes anónimos para poder limitar los giros de la ruleta.
--
-- Migración puramente aditiva: no toca ninguna tabla existente.

-- CreateTable
CREATE TABLE `departamentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `activo` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `departamentos_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `municipios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `departamentoId` INTEGER NOT NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,

    INDEX `municipios_departamentoId_idx`(`departamentoId`),
    UNIQUE INDEX `municipios_departamentoId_nombre_key`(`departamentoId`, `nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `visitantes_anonimos` (
    `id` VARCHAR(191) NOT NULL,
    `giros` INTEGER NOT NULL DEFAULT 0,
    `primerGiro` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ultimoGiro` DATETIME(3) NOT NULL,
    `ip` VARCHAR(191) NULL,

    INDEX `visitantes_anonimos_ip_idx`(`ip`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `municipios` ADD CONSTRAINT `municipios_departamentoId_fkey` FOREIGN KEY (`departamentoId`) REFERENCES `departamentos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

