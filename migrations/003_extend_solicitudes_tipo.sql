
-- Si existe la restricción, la borramos para poder reemplazarla.
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Solicitudes_Tipo'
      AND parent_object_id = OBJECT_ID(N'[EDI].[Solicitudes_Familia]')
)
BEGIN
    ALTER TABLE EDI.Solicitudes_Familia
        DROP CONSTRAINT CK_Solicitudes_Tipo;
    PRINT 'CK_Solicitudes_Tipo eliminado.';
END
ELSE
BEGIN
    PRINT 'CK_Solicitudes_Tipo no existe; se omite el DROP.';
END;
GO

-- Agregamos el constraint con los valores válidos.
ALTER TABLE EDI.Solicitudes_Familia
    ADD CONSTRAINT CK_Solicitudes_Tipo
    CHECK (tipo_solicitud IN ('Solicitud', 'Invitación', 'RENOVACION_CICLO'));
PRINT 'CK_Solicitudes_Tipo creado con RENOVACION_CICLO incluido.';
GO
