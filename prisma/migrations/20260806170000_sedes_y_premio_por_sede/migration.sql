-- Sedes como tabla real, premios asignados a una sede, y la sede de canje
-- convertida de texto suelto a llave foránea.
--
-- El orden importa: `sedes` se crea y se puebla ANTES de tocar
-- `bonos_ganados`, porque la columna vieja `sedeCanje` (que guardaba la clave
-- como texto) se migra a `sedeCanjeId` haciendo match por clave. Si se
-- eliminara primero, se perderían los canjes ya registrados.

-- 1) Tabla de sedes
CREATE TABLE `sedes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clave` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `direccion` VARCHAR(191) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `sedes_clave_key`(`clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) Los 3 casinos. Van aquí y no solo en el seed porque el backfill del
--    paso 5 los necesita existiendo. El seed los vuelve a sincronizar (upsert)
--    para que sigan siendo administrables desde ahí.
INSERT INTO `sedes` (`clave`, `nombre`, `direccion`, `orden`) VALUES
  ('ventura-plaza', 'Gran Casino Cúcuta Ventura Plaza', 'CCial Ventura Plaza, Local 228', 1),
  ('av-5',          'Gran Casino Cúcuta Av. 5',         'Av. 5 # 9-30, Centro',           2),
  ('avenida-0',     'Gran Casino Cúcuta Av. 0',         'Av. 0 con calle 13, esquina',    3);

-- 3) Premios: a qué sede pertenece cada uno
ALTER TABLE `premios` ADD COLUMN `sedeId` INTEGER NULL;
CREATE INDEX `premios_sedeId_idx` ON `premios`(`sedeId`);
ALTER TABLE `premios` ADD CONSTRAINT `premios_sedeId_fkey`
  FOREIGN KEY (`sedeId`) REFERENCES `sedes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Bonos: nueva columna de sede de canje como FK
ALTER TABLE `bonos_ganados` ADD COLUMN `sedeCanjeId` INTEGER NULL;

-- 5) Backfill: los canjes ya hechos guardaban la clave como texto
UPDATE `bonos_ganados` b
  JOIN `sedes` s ON s.`clave` = b.`sedeCanje`
  SET b.`sedeCanjeId` = s.`id`;

-- 6) Recién ahora se puede soltar la columna vieja
ALTER TABLE `bonos_ganados` DROP COLUMN `sedeCanje`;

ALTER TABLE `bonos_ganados` ADD CONSTRAINT `bonos_ganados_sedeCanjeId_fkey`
  FOREIGN KEY (`sedeCanjeId`) REFERENCES `sedes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
