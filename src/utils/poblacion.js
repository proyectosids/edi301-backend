// Definición única de la población de usuarios para conteos y muestreo.
//
// Todo lo que cuente o sortee usuarios debe importar de aquí. Si el criterio
// vive en dos lugares, tarde o temprano el reporte que se le entrega al
// maestro y la muestra que se sortea dejan de coincidir.

// Roles tal como están en EDI.Roles.nombre_rol.
const ROLES_PADRES = ['Padre', 'Madre', 'Tutor', 'PapaEDI', 'MamaEDI'];
const ROLES_HIJOS = ['Hijo', 'HijoEDI', 'HijoSanguineo', 'Alumno', 'Estudiante'];

// COLIVI = Colegio Linda Vista. Se identifica por el campo `carrera`, que es
// como ya lo hace familias.queries.js (listAvailable → num_colivi). Se repite
// el mismo criterio a propósito, para que los dos números cuadren.
const SQL_ES_COLIVI = `(
  UPPER(ISNULL(u.carrera, '')) LIKE '%COLIVI%'
  OR UPPER(ISNULL(u.carrera, '')) LIKE '%COLEGIO LINDA VISTA%'
)`;

const _lista = (roles) => roles.map((r) => `'${r}'`).join(', ');

// Estrato al que pertenece cada usuario. 'OTROS' cae aquí cuando el rol no
// está en ninguna de las dos listas (Admin, o un rol nuevo que nadie agregó
// arriba). Se reporta aparte en vez de repartirlo a ciegas: si aparece un
// número raro en OTROS, es que falta clasificar un rol.
const SQL_ESTRATO = `CASE
  WHEN r.nombre_rol IN (${_lista(ROLES_PADRES)}) THEN 'PADRES'
  WHEN r.nombre_rol IN (${_lista(ROLES_HIJOS)})  THEN 'HIJOS'
  ELSE 'OTROS'
END`;

/**
 * Usuarios que cuentan para el estudio: cuenta activa, rol clasificable y,
 * salvo que se pida lo contrario, sin alumnos de COLIVI.
 */
function sqlPoblacion({ incluirColivi = false } = {}) {
  return `
    SELECT
      u.id_usuario,
      u.nombre,
      u.apellido,
      r.nombre_rol,
      u.carrera,
      ${SQL_ESTRATO} AS estrato,
      CASE WHEN ${SQL_ES_COLIVI} THEN 1 ELSE 0 END AS es_colivi
    FROM EDI.Usuarios u
    JOIN EDI.Roles r ON r.id_rol = u.id_rol
    WHERE u.activo = 1
      ${incluirColivi ? '' : `AND NOT ${SQL_ES_COLIVI}`}
      AND ${SQL_ESTRATO} <> 'OTROS'`;
}

module.exports = {
  ROLES_PADRES,
  ROLES_HIJOS,
  SQL_ES_COLIVI,
  SQL_ESTRATO,
  sqlPoblacion,
};
