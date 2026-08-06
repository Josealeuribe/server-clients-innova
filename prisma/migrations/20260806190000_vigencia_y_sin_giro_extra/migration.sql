-- Vigencia de la promoción y eliminación del giro adicional.
--
-- Las columnas van NOT NULL, así que se agregan con DEFAULT para que las
-- filas existentes queden con la fecha de la campaña.
--
-- El valor es 2026-09-01 04:59:59 UTC, que es el 31 de agosto a las 11:59:59
-- p.m. hora de Colombia. MySQL DATETIME no guarda zona horaria y Prisma lo
-- interpreta como UTC, así que la conversión va hecha aquí. El DEFAULT se retira
-- después: de aquí en adelante la vigencia siempre la escribe la aplicación
-- (el premio la define y el bono se lleva una copia al crearse), no la base.

-- 1) Vigencia en el catálogo de premios
ALTER TABLE `premios`
  ADD COLUMN `vigenciaHasta` DATETIME(3) NOT NULL DEFAULT '2026-09-01 04:59:59.000';
ALTER TABLE `premios` ALTER COLUMN `vigenciaHasta` DROP DEFAULT;

-- 2) Vigencia en cada bono ya entregado
ALTER TABLE `bonos_ganados`
  ADD COLUMN `vigenciaHasta` DATETIME(3) NOT NULL DEFAULT '2026-09-01 04:59:59.000';
ALTER TABLE `bonos_ganados` ALTER COLUMN `vigenciaHasta` DROP DEFAULT;

-- 3) El giro adicional se retira de la promoción. Se verificó que ningún
--    BonoGanado lo referencia (nunca generó bono a propósito), así que el
--    DELETE no puede chocar contra la llave foránea.
DELETE FROM `premios` WHERE `clave` = 'giro-extra';
