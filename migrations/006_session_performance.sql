-- Ejecutar una vez en producción después de 001_create_usuario_sesiones.sql.
-- Acelera el límite de sesiones y la limpieza de sesiones inactivas.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_Sesiones_Usuario_Activo_UltimaActividad'
    AND object_id = OBJECT_ID(N'EDI.Usuario_Sesiones')
)
BEGIN
  CREATE INDEX IX_Sesiones_Usuario_Activo_UltimaActividad
    ON EDI.Usuario_Sesiones(id_usuario, activo, last_active_at DESC, id_sesion DESC);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_Sesiones_Inactivas_UltimaActividad'
    AND object_id = OBJECT_ID(N'EDI.Usuario_Sesiones')
)
BEGIN
  CREATE INDEX IX_Sesiones_Inactivas_UltimaActividad
    ON EDI.Usuario_Sesiones(last_active_at)
    WHERE activo = 0;
END;
GO
