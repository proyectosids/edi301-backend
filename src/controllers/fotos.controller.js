const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, fail } = require('../utils/http');
const { Q } = require('../queries/fotos.queries');


exports.add = async (req, res) => {
  try {
    const { id_post, url_foto } = req.body;
    if (!id_post || !url_foto) return bad(res, 'id_post y url_foto requeridos');
    const rows = await queryP(Q.add, {
      id_post:  { type: sql.Int, value: id_post },
      url_foto: { type: sql.NVarChar, value: url_foto }
    });
    // ✅ Tiempo real: avisar a la familia dueña del post
    const info = await queryP(
      'SELECT id_familia FROM EDI.Publicaciones WHERE id_post = @id_post',
      { id_post: { type: sql.Int, value: Number(id_post) } }
    );
    const id_familia = info?.[0]?.id_familia;
    if (id_familia) {
      req.io?.to(`familia_${id_familia}`).emit('foto_agregada', rows[0]);
    }

    created(res, rows[0]);
  } catch (e) { fail(res, e); }
};

exports.listByPost = async (req, res) => {
  try {
    ok(res, await queryP(Q.listByPost, { id_post: { type: sql.Int, value: Number(req.params.id_post) } }));
  } catch (e) { fail(res, e); }
};

exports.listByFamilia = async (req, res) => {
  try {
    const id_familia = req.params.id_familia;
    const rows = await queryP(Q.getByFamilia, { 
        id_familia: { type: sql.Int, value: id_familia } 
    });
    ok(res, rows);
  } catch (error) {
    fail(res, error);
  }
};