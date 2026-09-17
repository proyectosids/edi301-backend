const { queryP } = require('../dataBase/dbConnection');
const { ok, fail } = require('../utils/http');
const {
  ROLES_PADRES,
  ROLES_HIJOS,
  SQL_ES_COLIVI,
  SQL_ESTRATO,
} = require('../utils/poblacion');

const pct = (parte, total) =>
  total === 0 ? 0 : Number(((parte * 100) / total).toFixed(2));

/**
 * GET /api/poblacion
 *
 * Cuántos usuarios hay en la app, separados en padres e hijos y excluyendo a
 * los alumnos de COLIVI. Devuelve también el desglose por rol y qué carreras
 * se contaron como COLIVI, para que el conteo sea auditable: si un número no
 * cuadra, se ve en qué rol o en qué carrera está la diferencia.
 */
exports.resumen = async (_req, res) => {
  try {
    const filas = await queryP(`
      SELECT
        r.nombre_rol,
        ${SQL_ESTRATO} AS estrato,
        CASE WHEN ${SQL_ES_COLIVI} THEN 1 ELSE 0 END AS es_colivi,
        COUNT(*) AS total
      FROM EDI.Usuarios u
      JOIN EDI.Roles r ON r.id_rol = u.id_rol
      WHERE u.activo = 1
      GROUP BY r.nombre_rol, ${SQL_ESTRATO},
               CASE WHEN ${SQL_ES_COLIVI} THEN 1 ELSE 0 END
      ORDER BY r.nombre_rol`);

    const carrerasColivi = await queryP(`
      SELECT LTRIM(RTRIM(ISNULL(u.carrera, '(sin carrera)'))) AS carrera,
             COUNT(*) AS total
      FROM EDI.Usuarios u
      WHERE u.activo = 1 AND ${SQL_ES_COLIVI}
      GROUP BY LTRIM(RTRIM(ISNULL(u.carrera, '(sin carrera)')))
      ORDER BY COUNT(*) DESC`);

    const suma = (predicado) => filas
      .filter(predicado)
      .reduce((acc, f) => acc + Number(f.total), 0);

    const activos = suma(() => true);
    const colivi = suma((f) => f.es_colivi === 1);
    const otrosRoles = suma((f) => f.estrato === 'OTROS' && f.es_colivi === 0);

    const padres = suma((f) => f.estrato === 'PADRES' && f.es_colivi === 0);
    const hijos = suma((f) => f.estrato === 'HIJOS' && f.es_colivi === 0);
    const elegibles = padres + hijos;

    // Desglose por rol, ya sin COLIVI, para revisar la clasificación.
    const porRol = new Map();
    for (const f of filas) {
      const clave = f.nombre_rol;
      if (!porRol.has(clave)) {
        porRol.set(clave, {
          nombre_rol: clave,
          estrato: f.estrato,
          total: 0,
          colivi: 0,
          elegibles: 0,
        });
      }
      const fila = porRol.get(clave);
      fila.total += Number(f.total);
      if (f.es_colivi === 1) fila.colivi += Number(f.total);
      else fila.elegibles += Number(f.total);
    }

    ok(res, {
      generado: new Date().toISOString(),
      criterio: {
        excluye_colivi: true,
        definicion_colivi:
          "carrera contiene 'COLIVI' o 'COLEGIO LINDA VISTA'",
        roles_padres: ROLES_PADRES,
        roles_hijos: ROLES_HIJOS,
        nota:
          'Se cuentan cuentas activas. Los roles que no estan en ninguna de ' +
          'las dos listas (por ejemplo Admin) quedan fuera del estudio y se ' +
          'reportan como "otros_roles".',
      },
      totales: {
        usuarios_activos: activos,
        colivi_excluidos: colivi,
        otros_roles: otrosRoles,
        elegibles,
        padres,
        hijos,
      },
      proporcion: {
        padres_pct: pct(padres, elegibles),
        hijos_pct: pct(hijos, elegibles),
        // Cuántos hijos por cada padre. Es la forma en que normalmente se
        // reporta esta relación.
        hijos_por_padre: padres === 0 ? null : Number((hijos / padres).toFixed(2)),
      },
      desglose_roles: [...porRol.values()].sort(
        (a, b) => b.total - a.total || a.nombre_rol.localeCompare(b.nombre_rol),
      ),
      colivi_por_carrera: carrerasColivi.map((c) => ({
        carrera: c.carrera,
        total: Number(c.total),
      })),
    });
  } catch (e) {
    fail(res, e);
  }
};
