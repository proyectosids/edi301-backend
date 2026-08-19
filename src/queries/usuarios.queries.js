exports.Q = {
  byLogin: `
    SELECT TOP 1 
      u.id_usuario,
      u.nombre,
      u.apellido,
      u.correo,
      u.contrasena,
      u.foto_perfil,
      u.tipo_usuario,
      u.matricula,
      u.num_empleado,
      u.id_rol,
      u.estado,
      u.activo,
      u.created_at,
      u.updated_at,
      u.telefono,
      u.residencia,
      u.direccion,
      u.fecha_nacimiento,
      u.carrera,
      u.session_token,
      r.nombre_rol,
      (SELECT TOP 1 mf.id_familia 
       FROM EDI.Miembros_Familia mf
       WHERE mf.id_usuario = u.id_usuario AND mf.activo = 1
       ORDER BY mf.id_miembro DESC) AS id_familia,
      (SELECT TOP 1 f.nombre_familia 
       FROM EDI.Miembros_Familia mf
       JOIN EDI.Familias_EDI f ON f.id_familia = mf.id_familia
       WHERE mf.id_usuario = u.id_usuario AND mf.activo = 1 AND f.activo = 1
       ORDER BY mf.id_miembro DESC) AS nombre_familia
    FROM EDI.Usuarios u
    JOIN EDI.Roles r ON r.id_rol = u.id_rol
    WHERE u.correo = @Login
       OR (TRY_CONVERT(INT, @Login) IS NOT NULL AND u.matricula = TRY_CONVERT(INT, @Login))
       OR (TRY_CONVERT(INT, @Login) IS NOT NULL AND u.num_empleado = TRY_CONVERT(INT, @Login))
  `,
  insert: `
    DECLARE @out TABLE (
      id_usuario        INT,
      nombre            NVARCHAR(100),
      apellido          NVARCHAR(100),
      tipo_usuario      NVARCHAR(50),
      matricula         INT,
      num_empleado      INT,
      correo            NVARCHAR(255),
      estado            NVARCHAR(50),
      created_at        DATETIME,
      updated_at        DATETIME,
      telefono          NVARCHAR(20),
      residencia        NVARCHAR(50),
      direccion         NVARCHAR(200),
      fecha_nacimiento  DATE,
      carrera           NVARCHAR(120)
    );

    INSERT INTO EDI.Usuarios
    (
      nombre, apellido, correo, contrasena, foto_perfil, tipo_usuario,
      matricula, num_empleado, id_rol,
      telefono, residencia, direccion, fecha_nacimiento, carrera
    )
    OUTPUT
      INSERTED.id_usuario,
      INSERTED.nombre,
      INSERTED.apellido,
      INSERTED.tipo_usuario,
      INSERTED.matricula,
      INSERTED.num_empleado,
      INSERTED.correo,
      INSERTED.estado,
      INSERTED.created_at,
      INSERTED.updated_at,
      INSERTED.telefono,
      INSERTED.residencia,
      INSERTED.direccion,
      INSERTED.fecha_nacimiento,
      INSERTED.carrera
    INTO @out
    VALUES
    (
      @nombre, @apellido, @correo, @contrasena, @foto_perfil, @tipo_usuario,
      @matricula, @num_empleado, @id_rol,
      @telefono, @residencia, @direccion, @fecha_nacimiento, @carrera
    );

    SELECT * FROM @out;
  `,
  updateBasic: `
    DECLARE @out TABLE (
      id_usuario        INT,
      nombre            NVARCHAR(100),
      apellido          NVARCHAR(100),
      tipo_usuario      NVARCHAR(50),
      matricula         INT,
      num_empleado      INT,
      correo            NVARCHAR(255),
      estado            NVARCHAR(50),
      updated_at        DATETIME,
      telefono          NVARCHAR(20),
      residencia        NVARCHAR(50),
      direccion         NVARCHAR(200),
      fecha_nacimiento  DATE,
      carrera           NVARCHAR(120)
    );

    UPDATE EDI.Usuarios
    SET
      nombre            = COALESCE(@nombre, nombre),
      apellido          = COALESCE(@apellido, apellido),
      foto_perfil       = COALESCE(@foto_perfil, foto_perfil),
      estado            = COALESCE(@estado, estado),
      activo            = COALESCE(@activo, activo),
      telefono          = COALESCE(@telefono, telefono),
      residencia        = COALESCE(@residencia, residencia),
      direccion         = COALESCE(@direccion, direccion),
      fecha_nacimiento  = COALESCE(@fecha_nacimiento, fecha_nacimiento),
      carrera           = COALESCE(@carrera, carrera),
      updated_at        = GETDATE()
    OUTPUT
      INSERTED.id_usuario,
      INSERTED.nombre,
      INSERTED.apellido,
      INSERTED.tipo_usuario,
      INSERTED.matricula,
      INSERTED.num_empleado,
      INSERTED.correo,
      INSERTED.estado,
      INSERTED.updated_at,
      INSERTED.telefono,
      INSERTED.residencia,
      INSERTED.direccion,
      INSERTED.fecha_nacimiento,
      INSERTED.carrera
    INTO @out
    WHERE id_usuario = @id_usuario;

    SELECT * FROM @out;
  `,

  list: `SELECT u.id_usuario,u.nombre,u.apellido,u.correo,u.tipo_usuario,u.matricula,u.num_empleado,u.estado,u.activo,r.nombre_rol
         FROM EDI.Usuarios u JOIN EDI.Roles r ON r.id_rol = u.id_rol`,
  byId: `
    SELECT TOP 1 
      u.*, 
      r.nombre_rol, 
      f.nombre_familia,
      f.id_familia,
      CE.color as color_estado  
    FROM EDI.Usuarios u
    JOIN EDI.Roles r ON r.id_rol = u.id_rol
    LEFT JOIN EDI.Miembros_Familia mf ON mf.id_usuario = u.id_usuario AND mf.activo = 1
    LEFT JOIN EDI.Familias_EDI f ON f.id_familia = mf.id_familia AND f.activo = 1
    LEFT JOIN EDI.Cat_Estados CE ON CE.descripcion = u.estado 
    WHERE u.id_usuario = @id_usuario
  `,
  // ===========================================================================
  // SESIONES MULTI-DISPOSITIVO (EDI.Usuario_Sesiones)
  // ===========================================================================

  // Inserta una nueva sesión activa.
  insertSession: `
    INSERT INTO EDI.Usuario_Sesiones
      (id_usuario, session_token, fcm_token, device_info, device_id, platform, ip_address, activo)
    OUTPUT INSERTED.id_sesion
    VALUES
      (@id_usuario, @session_token, @fcm_token, @device_info, @device_id, @platform, @ip_address, 1);
  `,

  // Un dispositivo conserva una sola sesión activa. Esto evita crear una fila
  // nueva por cada login repetido desde el mismo teléfono.
  deactivateSessionsForDevice: `
    UPDATE EDI.Usuario_Sesiones
    SET activo = 0
    WHERE id_usuario = @id_usuario
      AND device_id = @device_id
      AND activo = 1;
  `,

  // Cuenta las sesiones activas de un usuario.
  countActiveSessions: `
    SELECT COUNT(*) AS total
    FROM EDI.Usuario_Sesiones
    WHERE id_usuario = @id_usuario AND activo = 1;
  `,

  // Devuelve los IDs de sesiones a evictar para mantener el límite (5).
  // Las más antiguas (last_active_at más viejo) son las primeras en irse.
  // @keep = cuántas dejar vivas (típicamente 5).
  evictOldestSessions: `
    UPDATE EDI.Usuario_Sesiones
    SET activo = 0
    WHERE id_sesion IN (
      SELECT id_sesion FROM (
        SELECT id_sesion,
               ROW_NUMBER() OVER (ORDER BY last_active_at DESC, id_sesion DESC) AS rn
        FROM EDI.Usuario_Sesiones
        WHERE id_usuario = @id_usuario AND activo = 1
      ) ranked
      WHERE rn > @keep
    );
  `,

  // Lookup principal de authGuard: obtiene usuario + sesión activa por token.
  sessionByToken: `
    SELECT TOP 1
      s.id_sesion,
      s.id_usuario,
      s.session_token,
      s.device_info,
      s.created_at  AS sesion_created_at,
      s.last_active_at,
      u.nombre, u.apellido, u.correo, u.tipo_usuario,
      u.id_rol, u.foto_perfil, u.estado, u.activo AS usuario_activo,
      r.nombre_rol
    FROM EDI.Usuario_Sesiones s
    JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
    JOIN EDI.Roles r ON r.id_rol = u.id_rol
    WHERE s.session_token = @session_token
      AND s.activo = 1;
  `,

  // Marca como inactiva la sesión que coincida con el token (logout).
  deactivateSessionByToken: `
    UPDATE EDI.Usuario_Sesiones
    SET activo = 0
    WHERE session_token = @session_token;
  `,

  // Marca como inactivas TODAS las sesiones del usuario (eliminar cuenta).
  deactivateAllSessionsOfUser: `
    UPDATE EDI.Usuario_Sesiones
    SET activo = 0
    WHERE id_usuario = @id_usuario AND activo = 1;
  `,

  // Lista las sesiones activas de un usuario para la pantalla "Mis dispositivos".
  listMySessions: `
    SELECT id_sesion,
           device_info,
           platform,
           ip_address,
           created_at,
           last_active_at
    FROM EDI.Usuario_Sesiones
    WHERE id_usuario = @id_usuario AND activo = 1
    ORDER BY last_active_at DESC;
  `,

  // Cierra una sesión específica (solo si pertenece al usuario).
  revokeSession: `
    UPDATE EDI.Usuario_Sesiones
    SET activo = 0
    OUTPUT DELETED.id_sesion
    WHERE id_sesion = @id_sesion AND id_usuario = @id_usuario AND activo = 1;
  `,

  // Cierra TODAS las sesiones del usuario excepto la actual.
  revokeAllOtherSessions: `
    UPDATE EDI.Usuario_Sesiones
    SET activo = 0
    OUTPUT DELETED.id_sesion
    WHERE id_usuario = @id_usuario AND activo = 1 AND id_sesion <> @id_sesion_actual;
  `,

  // Actualiza last_active_at en cada request autenticado (lo llama authGuard).
  touchSession: `
    UPDATE EDI.Usuario_Sesiones
    SET last_active_at = GETDATE()
    WHERE id_sesion = @id_sesion;
  `,

  purgeInactiveSessions: `
    DELETE FROM EDI.Usuario_Sesiones
    WHERE activo = 0
      AND last_active_at < DATEADD(DAY, -@days, GETDATE());
  `,

  // Actualiza el fcm_token de una sesión específica.
  updateSessionFcmToken: `
    UPDATE EDI.Usuario_Sesiones
    SET fcm_token = @fcm_token
    WHERE id_sesion = @id_sesion AND activo = 1;
  `,

  softDelete: `UPDATE EDI.Usuarios SET activo = 0, updated_at = GETDATE() WHERE id_usuario = @id_usuario`,
  selfDeactivate: `
    UPDATE EDI.Usuarios
    SET activo        = 0,
        estado        = 'CUENTA ELIMINADA',
        correo        = CONCAT('__deleted_', id_usuario, '_',
                               CAST(DATEDIFF(SECOND, '1970-01-01', GETUTCDATE()) AS NVARCHAR(20)),
                               '__', correo),
        matricula     = NULL,
        num_empleado  = NULL,
        session_token = NULL,
        fcm_token     = NULL,
        updated_at    = GETDATE()
    OUTPUT INSERTED.id_usuario AS id_usuario,
           INSERTED.correo     AS correo_archivado
    WHERE id_usuario = @id_usuario AND activo = 1;
  `,
  updateSession: `UPDATE EDI.Usuarios SET session_token = @token, updated_at = GETDATE() WHERE id_usuario = @id_usuario`,
  updateFcm:     `UPDATE EDI.Usuarios SET fcm_token = @token, updated_at = GETDATE() WHERE id_usuario = @id_usuario`,
  clearToken: `UPDATE EDI.Usuarios SET session_token = NULL, updated_at = GETDATE() WHERE session_token = @token`,
  // Multi-dispositivo: una fila por sesión activa de cada padre/tutor de la
  // familia. El controller que itera sobre las filas ya hace fan-out por
  // dispositivo automáticamente.
  getTokensPadresPorFamilia: `
    SELECT u.id_usuario, s.fcm_token AS session_token
    FROM EDI.Usuario_Sesiones s
    JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
    JOIN EDI.Miembros_Familia mf ON mf.id_usuario = u.id_usuario
    JOIN EDI.Roles r ON r.id_rol = u.id_rol
    WHERE mf.id_familia = @id_familia
      AND mf.activo = 1
      AND u.activo = 1
      AND s.activo = 1
      AND r.nombre_rol IN ('Padre', 'Madre', 'Tutor', 'Admin', 'PapaEDI', 'MamaEDI')
      AND s.fcm_token IS NOT NULL
      AND LEN(s.fcm_token) > 10
  `,
  
  createNotificacion: `
      INSERT INTO EDI.Notificaciones (id_usuario_destino, titulo, cuerpo, tipo, id_referencia)
      VALUES (@id_usuario_destino, @titulo, @cuerpo, @tipo, @id_referencia)
  `,
  birthdaysToday: `
    SELECT 
      id_usuario, 
      nombre, 
      apellido, 
      foto_perfil, 
      fecha_nacimiento 
    FROM EDI.Usuarios 
    WHERE DAY(fecha_nacimiento) = DAY(GETDATE()) 
    AND MONTH(fecha_nacimiento) = MONTH(GETDATE()) 
    AND activo = 1
    ORDER BY nombre
  `,
  birthdaysUpcoming: `
    SELECT
      id_usuario, nombre, apellido, foto_perfil, fecha_nacimiento,
      DATEDIFF(DAY, CAST(GETDATE() AS DATE),
        DATEFROMPARTS(
          CASE WHEN MONTH(fecha_nacimiento) < MONTH(GETDATE())
                 OR  (MONTH(fecha_nacimiento) = MONTH(GETDATE()) AND DAY(fecha_nacimiento) <= DAY(GETDATE()))
               THEN YEAR(GETDATE()) + 1
               ELSE YEAR(GETDATE())
          END,
          MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
        )
      ) AS dias_para_cumple
    FROM EDI.Usuarios
    WHERE activo = 1
      AND DATEDIFF(DAY, CAST(GETDATE() AS DATE),
            DATEFROMPARTS(
              CASE WHEN MONTH(fecha_nacimiento) < MONTH(GETDATE())
                     OR (MONTH(fecha_nacimiento) = MONTH(GETDATE()) AND DAY(fecha_nacimiento) <= DAY(GETDATE()))
                   THEN YEAR(GETDATE()) + 1
                   ELSE YEAR(GETDATE())
              END,
              MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
            )
          ) BETWEEN 1 AND 5
    ORDER BY dias_para_cumple
  `,
  birthdaysPast: `
    SELECT
      id_usuario, nombre, apellido, foto_perfil, fecha_nacimiento,
      DATEDIFF(DAY,
        DATEFROMPARTS(YEAR(GETDATE()), MONTH(fecha_nacimiento), DAY(fecha_nacimiento)),
        CAST(GETDATE() AS DATE)
      ) AS dias_cumplidos
    FROM EDI.Usuarios
    WHERE activo = 1
      AND MONTH(fecha_nacimiento) <= MONTH(GETDATE())
      AND DATEFROMPARTS(YEAR(GETDATE()), MONTH(fecha_nacimiento), DAY(fecha_nacimiento))
            BETWEEN DATEFROMPARTS(YEAR(GETDATE()), 1, 1)
                AND DATEADD(DAY, -1, CAST(GETDATE() AS DATE))
    ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
  `,
};
