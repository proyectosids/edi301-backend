exports.Q = {
  base: `
    SELECT
      f.id_familia,
      f.nombre_familia,
      f.residencia,
      f.papa_id,
      f.mama_id,
      f.direccion,
      f.foto_portada_url,
      f.foto_perfil_url,
      f.descripcion,
      (p.nombre + ' ' + p.apellido) AS papa_nombre,
      (m.nombre + ' ' + m.apellido) AS mama_nombre,
      p.num_empleado     AS papa_num_empleado,
      m.num_empleado     AS mama_num_empleado,
      p.telefono         AS papa_telefono,
      m.telefono         AS mama_telefono,
      p.foto_perfil      AS papa_foto_perfil_url,
      m.foto_perfil      AS mama_foto_perfil_url,
      p.fecha_nacimiento AS papa_fecha_nacimiento,
      m.fecha_nacimiento AS mama_fecha_nacimiento,
      -- Datos "pendientes" (familias creadas manualmente sin usuario aún)
      f.papa_nombre_pendiente,
      f.papa_apellido_pendiente,
      f.mama_nombre_pendiente,
      f.mama_apellido_pendiente

    FROM EDI.Familias_EDI AS f
    LEFT JOIN EDI.Usuarios AS p ON p.id_usuario = f.papa_id
    LEFT JOIN EDI.Usuarios AS m ON m.id_usuario = f.mama_id
  `,

  list: `
    {{BASE}}
    WHERE f.activo = 1
    ORDER BY f.nombre_familia
  `,

  byId: `
    {{BASE}}
    WHERE f.id_familia = @id_familia AND f.activo = 1
  `,

  insert: `
    INSERT INTO EDI.Familias_EDI (nombre_familia, residencia, direccion, papa_id, mama_id)
    VALUES (@nombre_familia, @residencia, @direccion, @papa_id, @mama_id);

    SELECT CAST(SCOPE_IDENTITY() AS INT) AS id_familia;
  `,

  update: `
    UPDATE EDI.Familias_EDI
    SET
      nombre_familia = COALESCE(@nombre_familia, nombre_familia),
      residencia     = COALESCE(@residencia, residencia),
      direccion      = CASE WHEN @residencia = 'INTERNA' THEN NULL ELSE COALESCE(@direccion, direccion) END,
      papa_id        = COALESCE(@papa_id, papa_id),
      mama_id        = COALESCE(@mama_id, mama_id),
      descripcion    = COALESCE(@descripcion, descripcion)
    WHERE id_familia = @id_familia AND activo = 1;

    SELECT @@ROWCOUNT AS affected;
  `,

  softDelete: `
    UPDATE EDI.Familias_EDI SET activo = 0 WHERE id_familia = @id_familia
  `,

  reactivate: `
    UPDATE EDI.Familias_EDI SET activo = 1 WHERE id_familia = @id_familia
  `,

  listInactive: `
    SELECT
      f.id_familia,
      f.nombre_familia,
      f.foto_portada_url AS portada,
      f.residencia,
      f.descripcion,
      (SELECT COUNT(*) FROM EDI.Miembros_Familia mf
       WHERE mf.id_familia = f.id_familia
         AND mf.activo = 1
         AND mf.tipo_miembro = 'ALUMNO_ASIGNADO') AS num_miembros,
      ISNULL((
        SELECT u.nombre + ' ' + u.apellido + ' & '
        FROM EDI.Usuarios u
        WHERE u.id_usuario IN (f.papa_id, f.mama_id)
          AND u.activo = 1
        FOR XML PATH('')
      ), 'Sin padres asignados') AS padres
    FROM EDI.Familias_EDI f
    WHERE f.activo = 0
    ORDER BY f.nombre_familia
  `,

  byIdent: `
    {{BASE}}
    JOIN EDI.Miembros_Familia mf ON mf.id_familia = f.id_familia
    JOIN EDI.Usuarios u          ON u.id_usuario = mf.id_usuario
    WHERE (u.matricula = @ident OR u.num_empleado = @ident)
      AND f.activo = 1
  `,

  byName: `
    {{BASE}}
    WHERE f.nombre_familia LIKE @like
    ORDER BY f.nombre_familia
  `,

  reporteCompleto: `
    SELECT
      f.id_familia, f.nombre_familia, f.residencia,
      (p.nombre + ' ' + p.apellido) AS papa_nombre,
      (m.nombre + ' ' + m.apellido) AS mama_nombre,
      miembros.id_usuario,
      (u.nombre + ' ' + u.apellido) AS miembro_nombre,
      miembros.tipo_miembro,
      (SELECT COUNT(*) FROM EDI.Hijos_Hogar hh
       WHERE hh.id_familia = f.id_familia AND hh.activo = 1) AS ninos_hogar_count
    FROM EDI.Familias_EDI AS f
    LEFT JOIN EDI.Usuarios AS p ON p.id_usuario = f.papa_id
    LEFT JOIN EDI.Usuarios AS m ON m.id_usuario = f.mama_id
    LEFT JOIN EDI.Miembros_Familia AS miembros ON miembros.id_familia = f.id_familia
                                              AND miembros.activo = 1
                                              AND miembros.tipo_miembro IN ('HIJO', 'ALUMNO_ASIGNADO')
    LEFT JOIN EDI.Usuarios AS u ON u.id_usuario = miembros.id_usuario
    WHERE f.activo = 1
    ORDER BY f.nombre_familia
  `,
  updateFotos: `
  UPDATE EDI.Familias_EDI
  SET
    foto_portada_url = COALESCE(@foto_portada_url, foto_portada_url),
    foto_perfil_url  = COALESCE(@foto_perfil_url,  foto_perfil_url)
  WHERE id_familia = @id_familia AND activo = 1
`,
  updateFotoPerfil: "UPDATE familias SET foto_perfil = ? WHERE id = ?",
  updateFotoPortada: "UPDATE familias SET foto_portada = ? WHERE id = ?",

listAvailable: `
  SELECT
    f.id_familia,
    f.nombre_familia,
    f.foto_portada_url AS portada,
    f.residencia,
    f.descripcion,
    (SELECT COUNT(*) FROM EDI.Miembros_Familia mf
     WHERE mf.id_familia = f.id_familia
       AND mf.activo = 1
       AND mf.tipo_miembro IN ('HIJO', 'ALUMNO_ASIGNADO')) as num_alumnos,
    ISNULL(TRY_CONVERT(INT, (
      SELECT valor FROM EDI.App_Config
      WHERE clave = 'limite_hijos_edi_por_familia'
    )), 7) AS limite_hijos_edi,
    ISNULL((
      SELECT u.nombre + ' ' + u.apellido + ' & '
      FROM EDI.Usuarios u
      JOIN EDI.Miembros_Familia mf ON u.id_usuario = mf.id_usuario
      JOIN EDI.Roles r ON u.id_rol = r.id_rol
      WHERE mf.id_familia = f.id_familia
        AND r.nombre_rol IN ('Padre', 'Madre', 'Tutor', 'PapaEDI', 'MamaEDI')
      FOR XML PATH('')
    ), 'Sin padres asignados') as padres
  FROM EDI.Familias_EDI f
  WHERE f.activo = 1
  ORDER BY num_alumnos ASC
`,

  // ── FAMILIA MANUAL ────────────────────────────────────────────────────────
  // Inserta una familia "manual": papa_id/mama_id en NULL y los nombres
  // se quedan en las columnas *_pendiente para hacer match en el futuro.
  insertManual: `
    INSERT INTO EDI.Familias_EDI (
      nombre_familia, residencia, direccion, papa_id, mama_id,
      papa_nombre_pendiente, papa_apellido_pendiente,
      mama_nombre_pendiente, mama_apellido_pendiente
    )
    OUTPUT INSERTED.id_familia
    VALUES (
      @nombre_familia, @residencia, @direccion, NULL, NULL,
      @papa_nombre_pendiente, @papa_apellido_pendiente,
      @mama_nombre_pendiente, @mama_apellido_pendiente
    );
  `,

  // Match por nombre+apellido (case-insensitive + accent-insensitive).
  // Devuelve TODAS las familias candidatas para que el frontend muestre
  // un selector "elige tu familia" si hay más de una.
  // El parámetro @rol indica si buscamos como PAPA o MAMA.
  findCandidatesForUser: `
    SELECT
      f.id_familia,
      f.nombre_familia,
      f.residencia,
      f.direccion,
      f.foto_portada_url,
      f.foto_perfil_url,
      f.papa_nombre_pendiente,
      f.papa_apellido_pendiente,
      f.mama_nombre_pendiente,
      f.mama_apellido_pendiente,
      f.created_at,
      CASE WHEN @rol = 'PAPA' THEN 'PAPA' ELSE 'MAMA' END AS rol_candidato
    FROM EDI.Familias_EDI f
    WHERE f.activo = 1
      AND (
            (@rol = 'PAPA'
              AND f.papa_id IS NULL
              AND f.papa_nombre_pendiente   COLLATE Latin1_General_CI_AI = @nombre   COLLATE Latin1_General_CI_AI
              AND f.papa_apellido_pendiente COLLATE Latin1_General_CI_AI = @apellido COLLATE Latin1_General_CI_AI)
         OR (@rol = 'MAMA'
              AND f.mama_id IS NULL
              AND f.mama_nombre_pendiente   COLLATE Latin1_General_CI_AI = @nombre   COLLATE Latin1_General_CI_AI
              AND f.mama_apellido_pendiente COLLATE Latin1_General_CI_AI = @apellido COLLATE Latin1_General_CI_AI)
          )
    ORDER BY f.created_at DESC
  `,

  // Listado de TODAS las familias con vinculación pendiente (panel admin).
  listPendientes: `
    SELECT
      f.id_familia,
      f.nombre_familia,
      f.residencia,
      f.direccion,
      f.foto_portada_url,
      f.created_at,
      f.papa_id,
      f.mama_id,
      f.papa_nombre_pendiente,
      f.papa_apellido_pendiente,
      f.mama_nombre_pendiente,
      f.mama_apellido_pendiente,
      (p.nombre + ' ' + p.apellido) AS papa_nombre_real,
      (m.nombre + ' ' + m.apellido) AS mama_nombre_real
    FROM EDI.Familias_EDI f
    LEFT JOIN EDI.Usuarios p ON p.id_usuario = f.papa_id
    LEFT JOIN EDI.Usuarios m ON m.id_usuario = f.mama_id
    WHERE f.activo = 1
      AND (
            (f.papa_id IS NULL AND f.papa_nombre_pendiente IS NOT NULL)
         OR (f.mama_id IS NULL AND f.mama_nombre_pendiente IS NOT NULL)
          )
    ORDER BY f.created_at DESC
  `,

  // Vincula un usuario al slot PAPA o MAMA de una familia. Limpia los
  // campos *_pendiente correspondientes.
  // Parámetros: @id_familia, @id_usuario, @rol ('PAPA' | 'MAMA')
  linkUserToFamilySlot: `
    UPDATE EDI.Familias_EDI
    SET
      papa_id = CASE
        WHEN @rol = 'PAPA' AND papa_id IS NULL THEN @id_usuario
        ELSE papa_id
      END,
      mama_id = CASE
        WHEN @rol = 'MAMA' AND mama_id IS NULL THEN @id_usuario
        ELSE mama_id
      END,
      papa_nombre_pendiente   = CASE WHEN @rol = 'PAPA' THEN NULL ELSE papa_nombre_pendiente   END,
      papa_apellido_pendiente = CASE WHEN @rol = 'PAPA' THEN NULL ELSE papa_apellido_pendiente END,
      mama_nombre_pendiente   = CASE WHEN @rol = 'MAMA' THEN NULL ELSE mama_nombre_pendiente   END,
      mama_apellido_pendiente = CASE WHEN @rol = 'MAMA' THEN NULL ELSE mama_apellido_pendiente END,
      updated_at = GETDATE()
    OUTPUT INSERTED.id_familia, INSERTED.nombre_familia, INSERTED.papa_id, INSERTED.mama_id
    WHERE id_familia = @id_familia
      AND activo = 1
      AND (
            (@rol = 'PAPA' AND papa_id IS NULL)
         OR (@rol = 'MAMA' AND mama_id IS NULL)
          );
  `,
};
