const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, bad, fail } = require('../utils/http');
const {
  CONFIG_KEY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  normalizeLimit,
  getEdiChildLimit,
} = require('../utils/familyChildLimit');

exports.getEdiChildLimit = async (_req, res) => {
  try {
    const limite_hijos_edi = await getEdiChildLimit();
    ok(res, { limite_hijos_edi, minimo: 1, maximo: MAX_LIMIT });
  } catch (e) {
    fail(res, e);
  }
};

exports.updateEdiChildLimit = async (req, res) => {
  try {
    const rawLimit = req.body?.limite_hijos_edi;
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return bad(res, `El límite debe ser un número entero entre 1 y ${MAX_LIMIT}.`);
    }

    await queryP(
      `IF EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = @clave)
         UPDATE EDI.App_Config
         SET valor = @valor, updated_at = GETDATE()
         WHERE clave = @clave;
       ELSE
         INSERT INTO EDI.App_Config (clave, valor, descripcion)
         VALUES (@clave, @valor, @descripcion);`,
      {
        clave: { type: sql.NVarChar, value: CONFIG_KEY },
        valor: { type: sql.NVarChar, value: String(normalizeLimit(limit)) },
        descripcion: {
          type: sql.NVarChar,
          value: 'Máximo global de hijos EDI por familia. No incluye hijos sanguíneos.',
        },
      },
    );

    ok(res, {
      limite_hijos_edi: limit,
      minimo: 1,
      maximo: MAX_LIMIT,
      predeterminado: DEFAULT_LIMIT,
    });
  } catch (e) {
    fail(res, e);
  }
};
