-- ============================================================================
-- Migración: Multi-sesión por usuario (login multi-dispositivo)
--
-- Crea la tabla EDI.Usuario_Sesiones para permitir que un mismo usuario
-- tenga su cuenta abierta en varios dispositivos. Cada sesión tiene su
-- propio session_token y fcm_token.
--
-- Las columnas EDI.Usuarios.session_token y EDI.Usuarios.fcm_token quedan
-- como DEPRECATED (no se borran para no romper scripts viejos).
--
-- Esta migración es idempotente: se puede correr varias veces sin daño.
-- ============================================================================

-- 1) Crear la tabla si no existe
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
        device_info     NVARCHAR(255) NULL,   -- "iPhone 17 Pro Max - iOS 18"
        device_id       NVARCHAR(255) NULL,   -- identificador único del dispositivo
        platform        NVARCHAR(20)  NULL,   -- "ios" / "android" / "web"
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

-- 2) Migrar tokens existentes una sola vez (solo si la tabla está vacía)
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
