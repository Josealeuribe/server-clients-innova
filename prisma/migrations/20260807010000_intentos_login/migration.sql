-- Tope de intentos fallidos de login, contra fuerza bruta.
--
-- Las contraseñas iniciales del personal se derivan de la cédula, que es
-- semipública. Sin este tope, adivinar una cuenta de cajera es cuestión de
-- tiempo, y con ella se marcan bonos como entregados.
--
-- En base y no en memoria: Render reinicia con cada despliegue y un contador
-- en memoria le daría al atacante borrón y cuenta nueva.
--
-- Aditiva: no toca ninguna tabla existente.

-- CreateTable
CREATE TABLE `intentos_login` (
    `id` VARCHAR(191) NOT NULL,
    `fallos` INTEGER NOT NULL DEFAULT 0,
    `ultimoFallo` DATETIME(3) NOT NULL,
    `bloqueadoHasta` DATETIME(3) NULL,
    `ultimaIp` VARCHAR(191) NULL,

    INDEX `intentos_login_bloqueadoHasta_idx`(`bloqueadoHasta`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

