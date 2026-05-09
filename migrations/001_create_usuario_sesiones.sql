
IF NOT EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[EDI].[Usuario_Sesiones]')
      AND type = N'U'
)
BEGIN
    CREATE TABLE EDI.Usuario_Sesiones (
        id_sesion       INT IDENTITY(1,1) PRIMARY KEY,
        id_usuario      INT          NOT NULL,
        session_token   NVARCHAR(255) NOT NULL,
        fcm_token       NVARCHAR(500) NULL,
        device_info     NVARCHAR(255) NULL,   
        device_id       NVARCHAR(255) NULL,   
        platform        NVARCHAR(20)  NULL,   
        ip_address      NVARCHAR(45)  NULL,
        created_at      DATETIME      NOT NULL DEFAULT GETDATE(),
        last_active_at  DATETIME      NOT NULL DEFAULT GETDATE(),
        activo          BIT           NOT NULL DEFAULT 1,
        CONSTRAINT FK_Sesiones_Usuario FOREIGN KEY (id_usuario)
            REFERENCES EDI.Usuarios(id_usuario)
    );

    CREATE UNIQUE INDEX IX_Sesiones_Token
        ON EDI.Usuario_Sesiones(session_token);

    CREATE INDEX IX_Sesiones_Usuario_Activo
        ON EDI.Usuario_Sesiones(id_usuario, activo);

    PRINT 'Tabla EDI.Usuario_Sesiones creada.';
END
ELSE
BEGIN
    PRINT 'Tabla EDI.Usuario_Sesiones ya existe; se omite la creación.';
END;
GO

-- Migrar tokens existentes una sola vez (solo si la tabla está vacía)
IF NOT EXISTS (SELECT TOP 1 1 FROM EDI.Usuario_Sesiones)
BEGIN
    INSERT INTO EDI.Usuario_Sesiones
        (id_usuario, session_token, fcm_token, device_info, created_at, last_active_at, activo)
    SELECT
        id_usuario,
        session_token,
        fcm_token,
        'Migrated session',
        ISNULL(updated_at, GETDATE()),
        GETDATE(),
        1
    FROM EDI.Usuarios
    WHERE session_token IS NOT NULL AND LEN(session_token) > 0;

    PRINT CONCAT('Sesiones migradas: ', @@ROWCOUNT);
END
ELSE
BEGIN
    PRINT 'Ya hay datos en EDI.Usuario_Sesiones; se omite la migración inicial.';
END;
GO
