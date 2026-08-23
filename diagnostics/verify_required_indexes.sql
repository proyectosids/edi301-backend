/* Verificación de solo lectura para las migraciones 005 y 006. */
WITH required_indexes AS (
  SELECT N'EDI.Miembros_Familia' AS table_name, N'IX_Miembros_Usuario_Activo' AS index_name
  UNION ALL SELECT N'EDI.Miembros_Familia', N'IX_MiembrosFamilia_Activos_Familia_Tipo'
  UNION ALL SELECT N'EDI.Familias_EDI', N'IX_FamiliasEDI_Activas_Nombre'
  UNION ALL SELECT N'EDI.Notificaciones', N'IX_Notificaciones_Usuario_Fecha'
  UNION ALL SELECT N'EDI.Usuario_Sesiones', N'IX_Sesiones_Usuario_Activo_Fcm'
)
SELECT
  required.table_name,
  required.index_name,
  CASE WHEN indexes.index_id IS NULL THEN N'FALTANTE' ELSE N'INSTALADO' END AS estado,
  indexes.is_disabled
FROM required_indexes required
LEFT JOIN sys.indexes indexes
  ON indexes.object_id = OBJECT_ID(required.table_name)
 AND indexes.name = required.index_name
ORDER BY required.table_name, required.index_name;
