-- ===========================================================================
-- Migración: Familia Manual (padre/madre pendientes de registro)
-- Fecha: 2026-05-19
-- Objetivo: permitir crear familias sin que los padres estén registrados.
--           Los nombres se guardan en 4 columnas NULL y se "vacían" cuando
--           el usuario real se registra y la app cruza nombre+apellido.
-- ===========================================================================
USE [Edi301];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE Name = N'papa_nombre_pendiente'
      AND Object_ID = Object_ID(N'EDI.Familias_EDI')
)
BEGIN
    ALTER TABLE [EDI].[Familias_EDI] ADD
        [papa_nombre_pendiente]   NVARCHAR(100) NULL,
        [papa_apellido_pendiente] NVARCHAR(100) NULL,
        [mama_nombre_pendiente]   NVARCHAR(100) NULL,
        [mama_apellido_pendiente] NVARCHAR(100) NULL;

    PRINT 'Columnas pendientes añadidas a EDI.Familias_EDI.';
END
ELSE
BEGIN
    PRINT 'Las columnas pendientes ya existen, no se hicieron cambios.';
END
GO

-- Índice no único para acelerar el match por nombre+apellido pendiente.
-- (No es UNIQUE porque permitimos que ambiguos coexistan hasta que el
--  usuario resuelva manualmente en el modal "Elige tu familia".)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Familias_PendientePapa'
      AND object_id = OBJECT_ID('EDI.Familias_EDI')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Familias_PendientePapa
        ON [EDI].[Familias_EDI]([papa_nombre_pendiente], [papa_apellido_pendiente])
        WHERE [papa_id] IS NULL AND [activo] = 1;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Familias_PendienteMama'
      AND object_id = OBJECT_ID('EDI.Familias_EDI')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Familias_PendienteMama
        ON [EDI].[Familias_EDI]([mama_nombre_pendiente], [mama_apellido_pendiente])
        WHERE [mama_id] IS NULL AND [activo] = 1;
END
GO

PRINT 'Migración 2026_05_19_familia_manual.sql aplicada correctamente.';
GO
