

-- EDI.App_Config (clave/valor)
IF NOT EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[EDI].[App_Config]') AND type = N'U'
)
BEGIN
    CREATE TABLE EDI.App_Config (
        clave        NVARCHAR(100) PRIMARY KEY,
        valor        NVARCHAR(500) NULL,
        descripcion  NVARCHAR(500) NULL,
        updated_at   DATETIME NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Tabla EDI.App_Config creada.';
END
ELSE
BEGIN
    PRINT 'Tabla EDI.App_Config ya existe; se omite creación.';
END;
GO

-- Seed: la ventana inicia cerrada
IF NOT EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = 'renovacion_ciclo_abierta')
BEGIN
    INSERT INTO EDI.App_Config (clave, valor, descripcion)
    VALUES (
        'renovacion_ciclo_abierta',
        'false',
        'Si está abierta la ventana para que los alumnos soliciten renovación de familia para el próximo ciclo.'
    );
    PRINT 'Config renovacion_ciclo_abierta sembrada en false.';
END;
GO

--  Columna renovacion_aprobada_at en Miembros_Familia
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[EDI].[Miembros_Familia]')
      AND name = 'renovacion_aprobada_at'
)
BEGIN
    ALTER TABLE EDI.Miembros_Familia
    ADD renovacion_aprobada_at DATETIME NULL;
    PRINT 'Columna renovacion_aprobada_at agregada a Miembros_Familia.';
END
ELSE
BEGIN
    PRINT 'Columna renovacion_aprobada_at ya existe; se omite.';
END;
GO
