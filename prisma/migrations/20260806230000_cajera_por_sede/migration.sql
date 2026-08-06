-- Cada cuenta de personal pertenece a un casino.
--
-- Es lo que determina la sede que queda registrada al canjear: el bono se
-- entregó físicamente donde está la cajera, no donde decía el premio.
-- Nullable porque el admin no pertenece a una sede concreta.
--
-- Aditiva: no toca ninguna columna existente.

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `sedeId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `usuarios_sedeId_idx` ON `usuarios`(`sedeId`);

-- AddForeignKey
ALTER TABLE `usuarios` ADD CONSTRAINT `usuarios_sedeId_fkey` FOREIGN KEY (`sedeId`) REFERENCES `sedes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

