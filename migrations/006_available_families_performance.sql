/* Índices para GET /api/familias/available. Idempotente y sin borrar datos. */
SET XACT_ABORT ON;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'EDI.Miembros_Familia')
    AND name = N'IX_MiembrosFamilia_Activos_Familia_Tipo'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_MiembrosFamilia_Activos_Familia_Tipo
    ON EDI.Miembros_Familia(id_familia, tipo_miembro)
    INCLUDE (id_usuario)
    WHERE activo = 1;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'EDI.Familias_EDI')
    AND name = N'IX_FamiliasEDI_Activas_Nombre'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_FamiliasEDI_Activas_Nombre
    ON EDI.Familias_EDI(nombre_familia, id_familia)
    INCLUDE (residencia, descripcion)
    WHERE activo = 1;
END;
GO

PRINT 'Migración 006_available_families_performance completada.';
GO
