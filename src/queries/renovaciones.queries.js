// ============================================================================
// queries/renovaciones.queries.js
//
// Queries para el flujo de renovación de pertenencia a familia por ciclo
// escolar. Reutiliza EDI.Solicitudes_Familia con tipo_solicitud =
// 'RENOVACION_CICLO' y un flag renovacion_aprobada_at en Miembros_Familia.
// ============================================================================

exports.Q = {
  // ── Configuración (clave/valor) ─────────────────────────────────────────
  getConfig: `
    SELECT valor FROM EDI.App_Config WHERE clave = @clave;
  `,
  upsertConfig: `
    IF EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = @clave)
      UPDATE EDI.App_Config
      SET valor = @valor, updated_at = GETDATE()
      WHERE clave = @clave;
    ELSE
      INSERT INTO EDI.App_Config (clave, valor, descripcion)
      VALUES (@clave, @valor, @descripcion);
  `,

  // ── Alumno solicita renovación ──────────────────────────────────────────
  // Trae el id_familia donde el alumno está actualmente activo (soft-not-deleted).
  // Devuelve null si el alumno no pertenece a ninguna familia.
  getCurrentFamilyOfAlumno: `
    SELECT TOP 1 mf.id_miembro, mf.id_familia, mf.tipo_miembro, mf.renovacion_aprobada_at
    FROM EDI.Miembros_Familia mf
    WHERE mf.id_usuario = @id_usuario
      AND mf.activo = 1
    ORDER BY mf.id_miembro DESC;
  `,

  // ¿El alumno ya tiene una solicitud pendiente abierta?
  alumnoHasPendingRenovacion: `
    SELECT TOP 1 id_solicitud
    FROM EDI.Solicitudes_Familia
    WHERE id_usuario = @id_usuario
      AND id_familia = @id_familia
      AND tipo_solicitud = 'RENOVACION_CICLO'
      AND estado = 'Pendiente'
      AND activo = 1;
  `,

  insertRenovacionRequest: `
    INSERT INTO EDI.Solicitudes_Familia (id_familia, id_usuario, tipo_solicitud, estado)
    OUTPUT INSERTED.id_solicitud, INSERTED.id_familia, INSERTED.id_usuario
    VALUES (@id_familia, @id_usuario, 'RENOVACION_CICLO', 'Pendiente');
  `,

  // ── Padre/Tutor: ver y resolver solicitudes ─────────────────────────────
  listPendingRenovacionesForFamilia: `
    SELECT
      s.id_solicitud,
      s.id_familia,
      s.id_usuario   AS id_alumno,
      s.fecha_solicitud,
      u.nombre, u.apellido, u.foto_perfil, u.matricula
    FROM EDI.Solicitudes_Familia s
    JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
    WHERE s.id_familia = @id_familia
      AND s.tipo_solicitud = 'RENOVACION_CICLO'
      AND s.estado = 'Pendiente'
      AND s.activo = 1
    ORDER BY s.fecha_solicitud DESC;
  `,

  // Lista de pendientes de TODAS las familias donde el usuario es padre/tutor.
  // Si el padre/tutor pertenece a varias familias, regresa pendientes de todas.
  listPendingRenovacionesForTutor: `
    SELECT
      s.id_solicitud,
      s.id_familia,
      s.id_usuario   AS id_alumno,
      s.fecha_solicitud,
      u.nombre, u.apellido, u.foto_perfil, u.matricula,
      f.nombre_familia
    FROM EDI.Solicitudes_Familia s
    JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
    JOIN EDI.Familias_EDI f ON f.id_familia = s.id_familia
    WHERE s.tipo_solicitud = 'RENOVACION_CICLO'
      AND s.estado = 'Pendiente'
      AND s.activo = 1
      AND s.id_familia IN (
        SELECT mf.id_familia
        FROM EDI.Miembros_Familia mf
        JOIN EDI.Usuarios u2 ON u2.id_usuario = mf.id_usuario
        JOIN EDI.Roles r ON r.id_rol = u2.id_rol
        WHERE mf.id_usuario = @id_usuario
          AND mf.activo = 1
          AND r.nombre_rol IN ('Padre','Madre','Tutor','Admin','PapaEDI','MamaEDI')
      )
    ORDER BY s.fecha_solicitud DESC;
  `,

  getRenovacionById: `
    SELECT s.id_solicitud, s.id_familia, s.id_usuario AS id_alumno, s.estado, s.tipo_solicitud
    FROM EDI.Solicitudes_Familia s
    WHERE s.id_solicitud = @id_solicitud
      AND s.tipo_solicitud = 'RENOVACION_CICLO';
  `,

  // Para validar que quien aprueba/rechaza es padre/tutor activo de esa familia.
  esTutorDeFamilia: `
    SELECT TOP 1 1 AS ok
    FROM EDI.Miembros_Familia mf
    JOIN EDI.Usuarios u ON u.id_usuario = mf.id_usuario
    JOIN EDI.Roles r ON r.id_rol = u.id_rol
    WHERE mf.id_familia = @id_familia
      AND mf.id_usuario = @id_usuario
      AND mf.activo = 1
      AND u.activo = 1
      AND r.nombre_rol IN ('Padre', 'Madre', 'Tutor', 'Admin', 'PapaEDI', 'MamaEDI');
  `,

  setEstadoRenovacion: `
    UPDATE EDI.Solicitudes_Familia
    SET estado = @estado, fecha_respuesta = GETDATE(), updated_at = GETDATE()
    OUTPUT INSERTED.id_solicitud, INSERTED.id_familia, INSERTED.id_usuario
    WHERE id_solicitud = @id_solicitud
      AND tipo_solicitud = 'RENOVACION_CICLO'
      AND estado = 'Pendiente';
  `,

  // Marca al alumno como renovado en su membresía actual.
  marcarMiembroRenovado: `
    UPDATE EDI.Miembros_Familia
    SET renovacion_aprobada_at = GETDATE(), updated_at = GETDATE()
    WHERE id_familia = @id_familia
      AND id_usuario = @id_usuario
      AND activo = 1;
  `,

  // Cierra otras solicitudes pendientes del mismo alumno (cuando un padre
  // ya aceptó, las demás quedan resueltas como aceptadas también).
  cerrarOtrasRenovacionesDelAlumno: `
    UPDATE EDI.Solicitudes_Familia
    SET estado = 'Aceptada', fecha_respuesta = GETDATE(), updated_at = GETDATE()
    WHERE id_usuario = @id_alumno
      AND id_solicitud <> @id_solicitud_actual
      AND tipo_solicitud = 'RENOVACION_CICLO'
      AND estado = 'Pendiente'
      AND activo = 1;
  `,

  // ── Admin ──────────────────────────────────────────────────────────────

  // Lista todas las renovaciones (con info de familia y alumno) para que
  // admin vea el progreso.
  listAllRenovaciones: `
    SELECT
      s.id_solicitud, s.id_familia, s.id_usuario AS id_alumno,
      s.estado, s.fecha_solicitud, s.fecha_respuesta,
      u.nombre, u.apellido, u.matricula,
      f.nombre_familia
    FROM EDI.Solicitudes_Familia s
    JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
    JOIN EDI.Familias_EDI f ON f.id_familia = s.id_familia
    WHERE s.tipo_solicitud = 'RENOVACION_CICLO'
      AND s.activo = 1
    ORDER BY s.fecha_solicitud DESC;
  `,

  // Cuenta cuántos alumnos están actualmente activos y cuántos renovaron.
  contarMiembrosAlumnos: `
    SELECT
      SUM(CASE WHEN mf.tipo_miembro IN ('Alumno','ALUMNO','HIJO','Hijo') THEN 1 ELSE 0 END)                     AS total_alumnos,
      SUM(CASE WHEN mf.tipo_miembro IN ('Alumno','ALUMNO','HIJO','Hijo') AND mf.renovacion_aprobada_at IS NOT NULL THEN 1 ELSE 0 END) AS alumnos_renovados
    FROM EDI.Miembros_Familia mf
    WHERE mf.activo = 1;
  `,

  // Vaciar familias: soft-delete a todos los alumnos NO renovados.
  // Devuelve los id_usuario afectados para enviarles push.
  vaciarAlumnosNoRenovados: `
    UPDATE EDI.Miembros_Familia
    SET activo = 0, updated_at = GETDATE()
    OUTPUT DELETED.id_usuario, DELETED.id_familia
    WHERE activo = 1
      AND tipo_miembro IN ('Alumno','ALUMNO','HIJO','Hijo')
      AND renovacion_aprobada_at IS NULL;
  `,

  // Después del vaciado, limpia el flag de renovación a los alumnos que sí
  // renovaron (y siguen activos) para que el próximo ciclo tengan que
  // renovar otra vez.
  limpiarFlagRenovacion: `
    UPDATE EDI.Miembros_Familia
    SET renovacion_aprobada_at = NULL, updated_at = GETDATE()
    WHERE activo = 1
      AND renovacion_aprobada_at IS NOT NULL;
  `,

  // Marca como inactivas todas las solicitudes de renovación viejas.
  archivarSolicitudesRenovacion: `
    UPDATE EDI.Solicitudes_Familia
    SET activo = 0, updated_at = GETDATE()
    WHERE tipo_solicitud = 'RENOVACION_CICLO' AND activo = 1;
  `,
};
