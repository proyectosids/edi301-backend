-- Límite global de hijos EDI por familia. Los hijos sanguíneos se almacenan
-- en EDI.Hijos_Hogar y no se contabilizan para este límite.
IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[EDI].[App_Config]') AND type = N'U'
)
BEGIN
    CREATE TABLE EDI.App_Config (
        clave       NVARCHAR(100) PRIMARY KEY,
        valor       NVARCHAR(500) NULL,
        descripcion NVARCHAR(500) NULL,
        updated_at  DATETIME NOT NULL DEFAULT GETDATE()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = 'limite_hijos_edi_por_familia')
BEGIN
    INSERT INTO EDI.App_Config (clave, valor, descripcion)
    VALUES (
        'limite_hijos_edi_por_familia',
        '7',
        'Máximo global de hijos EDI por familia. No incluye hijos sanguíneos. Rango permitido: 1 a 20.'
    );
END;
GO
