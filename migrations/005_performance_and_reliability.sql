/*
  EDI301 - Rendimiento y confiabilidad

  Migracion idempotente. No elimina ni modifica datos existentes.
  Ejecutar primero en staging y luego en produccion fuera de hora pico,
  porque la creacion de indices puede consumir IO y bloquear brevemente.
*/
SET XACT_ABORT ON;
GO

IF COL_LENGTH('EDI.Chat_Participantes', 'ultima_lectura') IS NULL
BEGIN
    ALTER TABLE EDI.Chat_Participantes
        ADD ultima_lectura DATETIME NULL;
END;
GO

IF OBJECT_ID(N'EDI.Job_Ejecuciones', N'U') IS NULL
BEGIN
    CREATE TABLE EDI.Job_Ejecuciones (
        clave_job       NVARCHAR(180) NOT NULL PRIMARY KEY,
        completado_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Chat_Participantes')
      AND name = N'IX_ChatParticipantes_Usuario_Sala'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_ChatParticipantes_Usuario_Sala
        ON EDI.Chat_Participantes(id_usuario, id_sala)
        INCLUDE (ultima_lectura);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Chat_Mensajes')
      AND name = N'IX_ChatMensajes_Sala_Fecha'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_ChatMensajes_Sala_Fecha
        ON EDI.Chat_Mensajes(id_sala, created_at DESC)
        INCLUDE (id_usuario, tipo_mensaje, leido);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Notificaciones')
      AND name = N'IX_Notificaciones_Usuario_Fecha'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Notificaciones_Usuario_Fecha
        ON EDI.Notificaciones(id_usuario_destino, fecha_creacion DESC)
        INCLUDE (titulo, cuerpo, tipo, id_referencia, leido);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Notificaciones')
      AND name = N'IX_Notificaciones_Usuario_NoLeidas'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Notificaciones_Usuario_NoLeidas
        ON EDI.Notificaciones(id_usuario_destino, leido)
        WHERE leido = 0;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Publicaciones')
      AND name = N'IX_Publicaciones_Familia_Feed'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Publicaciones_Familia_Feed
        ON EDI.Publicaciones(id_familia, activo, estado, created_at DESC, id_post DESC)
        INCLUDE (id_usuario, categoria_post, tipo, url_imagen);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Publicaciones')
      AND name = N'IX_Publicaciones_Feed_Global'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Publicaciones_Feed_Global
        ON EDI.Publicaciones(activo, estado, created_at DESC, id_post DESC)
        INCLUDE (id_familia, id_usuario, categoria_post, tipo, url_imagen);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Publicaciones_Comentarios')
      AND name = N'IX_PublicacionesComentarios_Post_Activo_Fecha'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_PublicacionesComentarios_Post_Activo_Fecha
        ON EDI.Publicaciones_Comentarios(id_post, activo, created_at)
        INCLUDE (id_usuario);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Miembros_Familia')
      AND name = N'IX_Miembros_Usuario_Activo'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Miembros_Usuario_Activo
        ON EDI.Miembros_Familia(id_usuario, activo)
        INCLUDE (id_familia, tipo_miembro);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Usuario_Sesiones')
      AND name = N'IX_Sesiones_Usuario_Activo_Fcm'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Sesiones_Usuario_Activo_Fcm
        ON EDI.Usuario_Sesiones(id_usuario, activo)
        INCLUDE (fcm_token, last_active_at);
END;
GO

/* Evita nuevos likes duplicados sin borrar datos existentes. */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Publicaciones_Likes')
      AND name = N'UX_PublicacionesLikes_Post_Usuario'
)
AND NOT EXISTS (
    SELECT 1
    FROM EDI.Publicaciones_Likes
    GROUP BY id_post, id_usuario
    HAVING COUNT_BIG(*) > 1
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_PublicacionesLikes_Post_Usuario
        ON EDI.Publicaciones_Likes(id_post, id_usuario);
END
ELSE IF EXISTS (
    SELECT 1
    FROM EDI.Publicaciones_Likes
    GROUP BY id_post, id_usuario
    HAVING COUNT_BIG(*) > 1
)
BEGIN
    PRINT 'ADVERTENCIA: hay likes duplicados; no se creo UX_PublicacionesLikes_Post_Usuario.';
END;
GO

/* Evita participantes duplicados si la base actual esta limpia. */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'EDI.Chat_Participantes')
      AND name = N'UX_ChatParticipantes_Sala_Usuario'
)
AND NOT EXISTS (
    SELECT 1
    FROM EDI.Chat_Participantes
    GROUP BY id_sala, id_usuario
    HAVING COUNT_BIG(*) > 1
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_ChatParticipantes_Sala_Usuario
        ON EDI.Chat_Participantes(id_sala, id_usuario);
END
ELSE IF EXISTS (
    SELECT 1
    FROM EDI.Chat_Participantes
    GROUP BY id_sala, id_usuario
    HAVING COUNT_BIG(*) > 1
)
BEGIN
    PRINT 'ADVERTENCIA: hay participantes duplicados; no se creo UX_ChatParticipantes_Sala_Usuario.';
END;
GO

PRINT 'Migracion 005_performance_and_reliability completada.';
GO
