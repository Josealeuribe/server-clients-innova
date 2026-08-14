-- Presencia del personal: "Activo" / "Fuera de línea" en el módulo de Personal.
--
-- La sesión del panel es un JWT sin estado, así que hasta ahora nada en la base
-- sabía que alguien había entrado. Esta columna guarda la última señal de vida
-- de la cuenta y de ahí se deduce el estado: hay actividad reciente o no la hay.
--
-- No se usa un booleano "conectado" a propósito: nadie le avisa al servidor
-- cuando se cierra el navegador o se cae el internet, así que un booleano
-- quedaría encendido para siempre en esos casos.
--
-- Aditiva: una sola columna nullable. NULL significa "nunca ha entrado, o cerró
-- sesión", que es exactamente el estado correcto para todas las cuentas
-- existentes en el momento de aplicar esto.

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `ultimaActividad` DATETIME(3) NULL;
