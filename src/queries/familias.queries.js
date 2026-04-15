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
      p.num_empleado AS papa_num_empleado,
      m.num_empleado AS mama_num_empleado,
      p.telefono AS papa_telefono,
      m.telefono AS mama_telefono,
      p.foto_perfil AS papa_foto_perfil_url,
      m.foto_perfil AS mama_foto_perfil_url

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
      direccion      = COALESCE(@direccion, direccion),
      papa_id        = COALESCE(@papa_id, papa_id),
      mama_id        = COALESCE(@mama_id, mama_id),
      descripcion    = COALESCE(@descripcion, descripcion)
    WHERE id_familia = @id_familia AND activo = 1;

    SELECT @@ROWCOUNT AS affected;
  `,

  softDelete: `
    UPDATE EDI.Familias_EDI SET activo = 0 WHERE id_familia = @id_familia
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
      miembros.tipo_miembro
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
     JOIN EDI.Usuarios u ON mf.id_usuario = u.id_usuario
     JOIN EDI.Roles r ON u.id_rol = r.id_rol
     WHERE mf.id_familia = f.id_familia 
       AND r.nombre_rol NOT IN ('Padre', 'Madre', 'Tutor', 'PapaEDI', 'MamaEDI')
       AND mf.activo = 1) as num_alumnos,
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
`
};
