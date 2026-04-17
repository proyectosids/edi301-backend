exports.Q = {
  // Crea una sala nueva
  createSala: `
    INSERT INTO EDI.Chat_Salas (nombre, tipo) VALUES (@nombre, @tipo);
    SELECT SCOPE_IDENTITY() as id_sala;
  `,

  // Agrega un usuario a una sala
  addParticipante: `
    INSERT INTO EDI.Chat_Participantes (id_sala, id_usuario, es_admin)
    VALUES (@id_sala, @id_usuario, @es_admin);
  `,

  // Guardar mensaje
  sendMessage: `
    INSERT INTO EDI.Chat_Mensajes (id_sala, id_usuario, mensaje, tipo_mensaje)
    VALUES (@id_sala, @id_usuario, @mensaje, @tipo_mensaje);

    DECLARE @id_mensaje INT = SCOPE_IDENTITY();

    SELECT 
    m.id_mensaje,
    m.id_sala,
    m.id_usuario,
    u.nombre as nombre_remitente,
    m.mensaje,
    m.created_at
FROM EDI.Chat_Mensajes m
JOIN EDI.Usuarios u ON u.id_usuario = m.id_usuario
WHERE m.id_mensaje = @id_mensaje;
  `,

  // Listar mis chats (incluye unread_count por sala)
  getMyChats: `
  SELECT
      s.id_sala,
      s.tipo,
      CASE
          WHEN s.tipo = 'GRUPAL' THEN s.nombre
          ELSE other.nombre
      END as titulo_chat,

      CASE
          WHEN s.tipo = 'GRUPAL' THEN NULL
          ELSE other.id_usuario
      END as id_usuario_chat,

      CASE
          WHEN s.tipo = 'GRUPAL' THEN NULL
          ELSE other.foto_perfil
      END as foto_perfil_chat,

      (SELECT TOP 1 m.mensaje
        FROM EDI.Chat_Mensajes m
        WHERE m.id_sala = s.id_sala
        ORDER BY m.created_at DESC) as ultimo_mensaje,

      (SELECT TOP 1 m.created_at
        FROM EDI.Chat_Mensajes m
        WHERE m.id_sala = s.id_sala
        ORDER BY m.created_at DESC) as fecha_ultimo,

      -- Mensajes de otros usuarios recibidos después de la última vez que el usuario leyó esta sala
      (SELECT COUNT(*)
        FROM EDI.Chat_Mensajes m2
        WHERE m2.id_sala = s.id_sala
          AND m2.id_usuario <> @id_usuario
          AND m2.created_at > ISNULL(cp.ultima_lectura, GETDATE())
      ) as unread_count

  FROM EDI.Chat_Salas s
  JOIN EDI.Chat_Participantes cp ON cp.id_sala = s.id_sala

  OUTER APPLY (
      SELECT TOP 1
          u.id_usuario,
          u.nombre,
          u.foto_perfil
      FROM EDI.Chat_Participantes cp2
      JOIN EDI.Usuarios u ON u.id_usuario = cp2.id_usuario
      WHERE cp2.id_sala = s.id_sala
        AND cp2.id_usuario <> @id_usuario
  ) other

  WHERE cp.id_usuario = @id_usuario AND s.activo = 1
  ORDER BY fecha_ultimo DESC
`,

  // Marcar sala como leída: actualiza ultima_lectura del participante
  markRead: `
    IF EXISTS (
      SELECT 1 FROM EDI.Chat_Participantes
      WHERE id_sala = @id_sala AND id_usuario = @id_usuario
    )
    BEGIN
      -- Verificar si la columna ultima_lectura ya existe; si no, agregarla al vuelo
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'EDI' AND TABLE_NAME = 'Chat_Participantes'
          AND COLUMN_NAME = 'ultima_lectura'
      )
      BEGIN
        ALTER TABLE EDI.Chat_Participantes ADD ultima_lectura DATETIME NULL;
      END

      UPDATE EDI.Chat_Participantes
      SET ultima_lectura = SYSDATETIME()
      WHERE id_sala = @id_sala AND id_usuario = @id_usuario;
    END
  `,

  // Total de mensajes no leídos en todos los chats del usuario
  totalUnread: `
    SELECT ISNULL(SUM(
      (SELECT COUNT(*)
       FROM EDI.Chat_Mensajes m
       WHERE m.id_sala = cp.id_sala
         AND m.id_usuario <> @id_usuario
         AND m.created_at > ISNULL(cp.ultima_lectura, GETDATE())
      )
    ), 0) AS total
    FROM EDI.Chat_Participantes cp
    JOIN EDI.Chat_Salas s ON s.id_sala = cp.id_sala
    WHERE cp.id_usuario = @id_usuario AND s.activo = 1
  `,

  // Obtener mensajes de una sala específica
  getMensajes: `
    SELECT 
        m.id_mensaje,
        m.id_sala,
        m.id_usuario,
        u.nombre as nombre_remitente,
        m.mensaje,
        m.created_at,
        CASE WHEN m.id_usuario = @id_usuario THEN 1 ELSE 0 END as es_mio
    FROM EDI.Chat_Mensajes m
    JOIN EDI.Usuarios u ON u.id_usuario = m.id_usuario
    WHERE m.id_sala = @id_sala
    ORDER BY m.created_at ASC
  `,

  // Buscar si ya existe chat privado entre dos personas
  findPrivateChat: `
    SELECT p1.id_sala
    FROM EDI.Chat_Participantes p1
    JOIN EDI.Chat_Participantes p2 ON p1.id_sala = p2.id_sala
    JOIN EDI.Chat_Salas s ON s.id_sala = p1.id_sala
    WHERE s.tipo = 'PRIVADO'
      AND p1.id_usuario = @my_id
      AND p2.id_usuario = @other_id
  `
};