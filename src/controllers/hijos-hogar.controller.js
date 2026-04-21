
const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, notFound, fail } = require('../utils/http');

// GET /api/hijos-hogar/familia/:id_familia
exports.listByFamilia = async (req, res) => {
  try {
    const id_familia = Number(req.params.id_familia);
    const rows = await queryP(
      `SELECT id_hijo, id_familia, nombre, apellido,
              CONVERT(varchar(10), fecha_nacimiento, 23) AS fecha_nacimiento
       FROM EDI.Hijos_Hogar
       WHERE id_familia = @id AND activo = 1
       ORDER BY nombre, apellido`,
      { id: { type: sql.Int, value: id_familia } }
    );
    ok(res, rows);
  } catch (e) { fail(res, e); }
};

// POST /api/hijos-hogar
exports.create = async (req, res) => {
  try {
    const { id_familia, nombre, apellido, fecha_nacimiento } = req.body;
    if (!id_familia || !nombre || !apellido) {
      return bad(res, 'id_familia, nombre y apellido son requeridos');
    }

    const rows = await queryP(
      `INSERT INTO EDI.Hijos_Hogar (id_familia, nombre, apellido, fecha_nacimiento, activo, created_at)
       OUTPUT INSERTED.id_hijo, INSERTED.id_familia, INSERTED.nombre, INSERTED.apellido,
              CONVERT(varchar(10), INSERTED.fecha_nacimiento, 23) AS fecha_nacimiento
       VALUES (@id_familia, @nombre, @apellido, @fecha_nacimiento, 1, GETUTCDATE())`,
      {
        id_familia:       { type: sql.Int,      value: Number(id_familia) },
        nombre:           { type: sql.NVarChar,  value: nombre.trim() },
        apellido:         { type: sql.NVarChar,  value: apellido.trim() },
        fecha_nacimiento: { type: sql.Date,      value: fecha_nacimiento ?? null },
      }
    );
    created(res, rows[0]);
  } catch (e) { fail(res, e); }
};

// DELETE /api/hijos-hogar/:id
exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await queryP(
      `UPDATE EDI.Hijos_Hogar SET activo = 0
       WHERE id_hijo = @id;
       SELECT @@ROWCOUNT AS affected;`,
      { id: { type: sql.Int, value: id } }
    );
    if (!rows[0]?.affected) return notFound(res);
    ok(res, { deleted: id });
  } catch (e) { fail(res, e); }
};
