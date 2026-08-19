const express = require('express');
const router = express.Router();
const { sql, queryP } = require('../dataBase/dbConnection');
const { searchLimiter } = require('../middleware/rateLimits');

router.get('/', searchLimiter, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q || q.length < 2) return res.json({ alumnos: [], empleados: [], familias: [] });

    const params = { q: { type: sql.NVarChar, value: `%${q}%` } };
    const alumnos = await queryP(`
      SELECT TOP (25) id_usuario, nombre, apellido, tipo_usuario, matricula, num_empleado
      FROM EDI.Usuarios
      WHERE tipo_usuario = 'ALUMNO'
        AND (CAST(matricula AS NVARCHAR) LIKE @q OR nombre LIKE @q OR apellido LIKE @q)
    `, params);

    const empleados = await queryP(`
      SELECT TOP (25) id_usuario, nombre, apellido, tipo_usuario, matricula, num_empleado
      FROM EDI.Usuarios
      WHERE tipo_usuario = 'EMPLEADO'
        AND (CAST(num_empleado AS NVARCHAR) LIKE @q OR nombre LIKE @q OR apellido LIKE @q)
    `, params);

    const familias = await queryP(`
      SELECT TOP (25) id_familia, nombre_familia, residencia
      FROM EDI.Familias_EDI
      WHERE nombre_familia LIKE @q
    `, params);

    res.json({ alumnos, empleados, familias });
  } catch (err) {
    console.error('❌ search error:', err);
    res.status(500).json({ error: 'Error interno en búsqueda' });
  }
});

module.exports = router;
