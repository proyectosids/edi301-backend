exports.Q = {
  create: `
    INSERT INTO EDI.Mensajes_Chat (id_familia, id_usuario, contenido, activo)
    VALUES (@id_familia, @id_usuario, @mensaje, 1);
    
    SELECT id_mensaje, contenido as mensaje, created_at, id_usuario 
    FROM EDI.Mensajes_Chat 
    WHERE id_mensaje = SCOPE_IDENTITY();
  `,

  listByFamilia: `
    SELECT * FROM (
      SELECT TOP (@limit) m.id_mensaje,
           m.contenido as mensaje, 
           m.created_at, 
           m.id_usuario,
           u.nombre, u.apellido, u.foto_perfil, 
           ISNULL(r.nombre_rol, 'Usuario') as nombre_rol
    FROM EDI.Mensajes_Chat m
    JOIN EDI.Usuarios u ON u.id_usuario = m.id_usuario
    LEFT JOIN EDI.Roles r ON r.id_rol = u.id_rol
    WHERE m.id_familia = @id_familia 
      AND m.activo = 1 
      AND (@before_id IS NULL OR m.id_mensaje < @before_id)
    ORDER BY m.id_mensaje DESC
    ) recent
    ORDER BY id_mensaje ASC
  `,

  // Multi-dispositivo: regresa el fcm_token de TODAS las sesiones activas
  // de los miembros de la familia (excluyendo al emisor).
  getFamilyTokens: `
    SELECT s.fcm_token
    FROM EDI.Usuario_Sesiones s
    JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
    JOIN EDI.Miembros_Familia mf ON mf.id_usuario = u.id_usuario
    WHERE mf.id_familia = @id_familia
      AND u.id_usuario != @id_sender
      AND u.activo = 1
      AND s.activo = 1
      AND s.fcm_token IS NOT NULL
      AND LEN(s.fcm_token) > 10
  `,

  countUnread: `
    SELECT COUNT(*) AS total
    FROM EDI.Mensajes_Chat
    WHERE id_familia = @id_familia
      AND id_usuario != @id_usuario
      AND activo = 1
      AND created_at > @desde
  `
};
