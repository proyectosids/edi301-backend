const { sql, pool, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, notFound, fail } = require('../utils/http');
const { Q } = require('../queries/familias.queries');
const MiembrosQ = require('../queries/miembros.queries').Q;
const { saveOptimizedImage } = require('../utils/imageStorage');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const { getActiveFcmTokensForUsers } = require('../utils/sessions');
const { insertarNotificaciones } = require('../utils/notificaciones');
const { getEdiChildLimit, limitError } = require('../utils/familyChildLimit');
const withBase = (tpl) => tpl.replace('{{BASE}}', Q.base);

// ── Helpers de validación ──────────────────────────────────────────────────
/** Devuelve la familia activa donde el usuario ya es padre/madre, o null */
async function _padreEnOtraFamilia(userId, excludeId = null) {
  if (!userId) return null;
  const params = { uid: { type: sql.Int, value: Number(userId) } };
  let q = `
    SELECT TOP 1 id_familia, nombre_familia
    FROM EDI.Familias_EDI
    WHERE activo = 1 AND (papa_id = @uid OR mama_id = @uid)
  `;
  if (excludeId) {
    q += ` AND id_familia <> @excl`;
    params.excl = { type: sql.Int, value: Number(excludeId) };
  }
  const rows = await queryP(q, params);
  return rows[0] ?? null;
}

/** Devuelve la familia activa donde el usuario ya es miembro (Miembros_Familia), o null */
async function _usuarioEnOtraFamilia(userId, excludeFamiliaId = null) {
  if (!userId) return null;
  const params = { uid: { type: sql.Int, value: Number(userId) } };
  let q = `
    SELECT TOP 1 mf.id_familia, f.nombre_familia
    FROM EDI.Miembros_Familia mf
    JOIN EDI.Familias_EDI f ON f.id_familia = mf.id_familia
    WHERE mf.id_usuario = @uid
      AND mf.activo = 1
      AND f.activo = 1
  `;
  if (excludeFamiliaId) {
    q += ` AND mf.id_familia <> @excl`;
    params.excl = { type: sql.Int, value: Number(excludeFamiliaId) };
  }
  const rows = await queryP(q, params);
  return rows[0] ?? null;
}

exports.list = async (_req, res) => {
  try {
    const rows = await queryP(withBase(Q.list));
    ok(res, rows);
  } catch (e) { fail(res, e); }
};

exports.get = async (req, res) => {
  try {
    const id_familia = Number(req.params.id);
    const rows = await queryP(withBase(Q.byId), {
      id_familia: { type: sql.Int, value: id_familia },
    });

    if (!rows.length) return notFound(res);

    const familia = rows[0];

    const [miembros, hijosHogar] = await Promise.all([
      queryP(MiembrosQ.listByFamilia, {
        id_familia: { type: sql.Int, value: id_familia },
      }),
      queryP(
        `SELECT id_hijo, nombre, apellido,
                CONVERT(varchar(10), fecha_nacimiento, 23) AS fecha_nacimiento
         FROM EDI.Hijos_Hogar
         WHERE id_familia = @id AND activo = 1
         ORDER BY nombre, apellido`,
        { id: { type: sql.Int, value: id_familia } }
      ).catch(() => []),   // si la tabla aún no existe no rompe
    ]);

    familia.miembros = miembros;
    familia.hijos_hogar = hijosHogar;
    ok(res, familia);
  } catch (e) { fail(res, e); }
};

exports.searchByName = async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.json([]);
    const like = `%${name}%`;

    const rows = await queryP(withBase(Q.byName), {
      like: { type: sql.NVarChar, value: like },
    });
    res.json(rows);
  } catch (e) {
    console.error('searchByName', e);
    res.status(500).json([]);
  }
};

exports.searchByDocument = async (req, res) => {
  try {
    const matricula = req.query.matricula?.trim();
    const numEmpleado = req.query.numEmpleado?.trim();
    if (!matricula && !numEmpleado) return res.json([]);

    const ident = matricula || numEmpleado;
    const rows = await queryP(withBase(Q.byIdent), {
      ident: { type: sql.NVarChar, value: ident },
    });

    res.json(rows);
  } catch (e) {
    console.error('searchByDocument', e);
    res.status(500).json([]);
  }
};

exports.create = async (req, res) => {
  const transaction = new sql.Transaction(pool);
  try {
    const { nombre_familia, papa_id, mama_id, residencia, direccion, hijos = [], tios = [] } = req.body;
    
    if (!nombre_familia || !residencia) return bad(res, 'Faltan datos obligatorios');

    const idsIntegrantes = [papa_id, mama_id, ...hijos, ...tios]
      .filter(Boolean)
      .map(Number);
    if (new Set(idsIntegrantes).size !== idsIntegrantes.length) {
      return bad(res, 'Una persona solo puede ocupar un lugar dentro de la misma familia.');
    }

    // Los hijos sanguíneos se guardan en Hijos_Hogar y no cuentan aquí.
    // Este arreglo contiene únicamente usuarios EDI asignados como hijos.
    if (Array.isArray(hijos)) {
      const limit = await getEdiChildLimit();
      if (hijos.length > limit) {
        return bad(res, limitError({ limit, current: 0, requested: hijos.length }));
      }
    }

    // Validar que los padres no estén asignados a otra familia activa
    if (papa_id) {
      const conflict = await _padreEnOtraFamilia(papa_id);
      if (conflict) return bad(res, `El padre seleccionado ya pertenece a la familia "${conflict.nombre_familia}". Un padre no puede pertenecer a más de una familia.`);
    }
    if (mama_id) {
      const conflict = await _padreEnOtraFamilia(mama_id);
      if (conflict) return bad(res, `La madre seleccionada ya pertenece a la familia "${conflict.nombre_familia}". Una madre no puede pertenecer a más de una familia.`);
    }

    // Hijos y tíos pertenecen a una sola familia activa. Los tíos no cuentan
    // para el límite de hijos EDI.
    const miembrosFamilia = [
      ...(Array.isArray(hijos) ? hijos : []),
      ...(Array.isArray(tios) ? tios : []),
    ];
    if (miembrosFamilia.length > 0) {
      for (const usuarioId of miembrosFamilia) {
        const conflict = await _usuarioEnOtraFamilia(usuarioId);
        if (conflict) {
          return res.status(409).json({
            ok: false,
            error: `El integrante seleccionado ya pertenece a la familia "${conflict.nombre_familia}". No puede estar en más de una familia.`,
            nombre_familia_existente: conflict.nombre_familia,
            id_familia_existente: conflict.id_familia,
          });
        }
      }
    }

    await transaction.begin();
    const request = new sql.Request(transaction);

    // Insertar Familia
    request.input('nombre_familia', sql.NVarChar, nombre_familia);
    request.input('residencia', sql.NVarChar, residencia);
    request.input('direccion', sql.NVarChar, direccion ?? null);
    request.input('papa_id', sql.Int, papa_id ?? null);
    request.input('mama_id', sql.Int, mama_id ?? null);
    
    const familiaResult = await request.query(`
      INSERT INTO EDI.Familias_EDI (nombre_familia, residencia, direccion, papa_id, mama_id)
      OUTPUT INSERTED.id_familia
      VALUES (@nombre_familia, @residencia, @direccion, @papa_id, @mama_id);
    `);

    const id_familia = familiaResult.recordset[0].id_familia;

    // Insertar Miembros
    const miembrosAIngresar = [];
    if (papa_id) miembrosAIngresar.push({ id: papa_id, tipo: 'PADRE' });
    if (mama_id) miembrosAIngresar.push({ id: mama_id, tipo: 'MADRE' });
    if (Array.isArray(hijos)) {
        hijos.forEach(hID => miembrosAIngresar.push({ id: hID, tipo: 'HIJO' }));
    }
    if (Array.isArray(tios)) {
        tios.forEach(tioId => miembrosAIngresar.push({ id: tioId, tipo: 'TIO_EDI' }));
    }

    if (miembrosAIngresar.length > 0) {
      const mReq = new sql.Request(transaction);
      mReq.input('miembros_id_familia', sql.Int, id_familia);
      const values = miembrosAIngresar.map((miembro, index) => {
        mReq.input(`miembro_id_${index}`, sql.Int, miembro.id);
        mReq.input(`miembro_tipo_${index}`, sql.NVarChar, miembro.tipo);
        return `(@miembros_id_familia, @miembro_id_${index}, @miembro_tipo_${index}, 1, SYSUTCDATETIME())`;
      });
      await mReq.query(`
        INSERT INTO EDI.Miembros_Familia
          (id_familia, id_usuario, tipo_miembro, activo, created_at)
        VALUES ${values.join(',')};
      `);
    }

    await transaction.commit(); 


    try {
        const idsPadres = [papa_id, mama_id].filter(id => id);
        if (idsPadres.length > 0) {
            await insertarNotificaciones(
                idsPadres,
                '¡Familia Creada! 🏠',
                `Bienvenidos a la familia "${nombre_familia}".`,
                'FAMILIA_CREADA',
                id_familia
            ).catch(e => console.error("Error BD Notif Padre:", e.message));

            // Multi-dispositivo: obtener fcm_tokens de TODAS las sesiones
            // activas de los padres y mandar push a cada device.
            const tokensPadres = await getActiveFcmTokensForUsers(idsPadres);
            if (tokensPadres.length > 0) {
                enviarNotificacionMulticast(tokensPadres, '¡Familia Creada! 🏠', `Bienvenidos a la familia "${nombre_familia}".`,
                { tipo: 'FAMILIA_CREADA', id_familia: id_familia.toString() });
            }
        }

        if (hijos.length > 0) {
            await insertarNotificaciones(
                hijos,
                'Nueva Asignación 🎒',
                `Has sido asignado a la familia "${nombre_familia}".`,
                'ASIGNACION',
                id_familia
            ).catch(e => console.error("Error BD Notif Hijo:", e.message));

            // Multi-dispositivo: fan-out a todas las sesiones activas de cada hijo.
            const tokensHijos = await getActiveFcmTokensForUsers(hijos);
            if (tokensHijos.length > 0) {
                enviarNotificacionMulticast(tokensHijos, 'Nueva Asignación 🎒', `Has sido asignado a la familia "${nombre_familia}".`,
                { tipo: 'ASIGNACION', id_familia: id_familia.toString() });
            }
        }
    } catch (notifError) { console.error("Error general notificaciones:", notifError); }

    const finalRows = await queryP(withBase(Q.byId), { id_familia: { type: sql.Int, value: id_familia } });
    created(res, finalRows[0]);
  } catch (e) {
    if (transaction.rolledBack === false) await transaction.rollback();
    fail(res, e);
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nombre_familia, papa_id, mama_id, residencia, direccion, descripcion } = req.body;

    // Si cambia a EXTERNA debe venir dirección
    if (residencia === 'EXTERNA' && (!direccion || direccion.trim().length < 5)) {
      return bad(res, 'La dirección es obligatoria cuando la residencia es EXTERNA (mínimo 5 caracteres).');
    }

    // Validar que los padres no estén asignados a otra familia activa (excluir la actual)
    if (papa_id) {
      const conflict = await _padreEnOtraFamilia(papa_id, id);
      if (conflict) return bad(res, `El padre seleccionado ya pertenece a la familia "${conflict.nombre_familia}".`);
    }
    if (mama_id) {
      const conflict = await _padreEnOtraFamilia(mama_id, id);
      if (conflict) return bad(res, `La madre seleccionada ya pertenece a la familia "${conflict.nombre_familia}".`);
    }

    // Las familias INTERNAS nunca deben tener dirección (constraint DB)
    // Forzar null explícito para evitar que COALESCE preserve la dirección anterior
    const finalDireccion = (residencia === 'INTERNA') ? null : (direccion ?? null);

    await queryP(Q.update, {
      id_familia:     { type: sql.Int,      value: id },
      nombre_familia: { type: sql.NVarChar, value: nombre_familia ?? null },
      papa_id:        { type: sql.Int,      value: papa_id ?? null },
      mama_id:        { type: sql.Int,      value: mama_id ?? null },
      residencia:     { type: sql.NVarChar, value: residencia ?? null },
      direccion:      { type: sql.NVarChar, value: finalDireccion },
      descripcion:    { type: sql.NVarChar, value: descripcion ?? null },
    });

    const rows = await queryP(withBase(Q.byId), {
      id_familia: { type: sql.Int, value: id },
    });
    if (!rows.length) return notFound(res);
    ok(res, rows[0]);
  } catch (e) {
    // Constraint de dirección requerida para EXTERNA
    if (e.number === 547 && e.message?.includes('CK_FamiliasEDI_DireccionExterna')) {
      return bad(res, 'La dirección es obligatoria cuando la residencia es EXTERNA.');
    }
    fail(res, e);
  }
};

exports.remove = async (req, res) => {
  try {
    await queryP(Q.softDelete, {
      id_familia: { type: sql.Int, value: Number(req.params.id) },
    });
    ok(res, { message: 'Familia desactivada' });
  } catch (e) { fail(res, e); }
};

exports.listInactive = async (_req, res) => {
  try {
    const rows = await queryP(Q.listInactive);
    // Limpiar el " & " sobrante al final del string de padres
    const formatted = rows.map(f => ({
      ...f,
      padres: (f.padres && f.padres.endsWith(' & '))
        ? f.padres.slice(0, -3)
        : (f.padres || 'Sin padres asignados'),
    }));
    ok(res, formatted);
  } catch (e) { fail(res, e); }
};

exports.reactivate = async (req, res) => {
  try {
    await queryP(Q.reactivate, {
      id_familia: { type: sql.Int, value: Number(req.params.id) },
    });
    ok(res, { message: 'Familia reactivada' });
  } catch (e) { fail(res, e); }
};

exports.permanentDelete = async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Eliminar miembros primero (FK constraint)
    await queryP(
      `DELETE FROM EDI.Miembros_Familia WHERE id_familia = @id`,
      { id: { type: sql.Int, value: id } }
    );
    // Eliminar la familia
    await queryP(
      `DELETE FROM EDI.Familias_EDI WHERE id_familia = @id`,
      { id: { type: sql.Int, value: id } }
    );
    console.log(`🗑️  Familia ${id} eliminada permanentemente.`);
    ok(res, { message: 'Familia eliminada permanentemente' });
  } catch (e) { fail(res, e); }
};

exports.byIdent = async (req, res) => {
  try {
    const ident = Number(req.params.ident);
    if (Number.isNaN(ident)) return bad(res, 'ident debe ser numérico (matrícula o num_empleado)');

    const rows = await queryP(withBase(Q.byIdent), {
      ident: { type: sql.Int, value: ident },
    });
    ok(res, rows);
  } catch (e) { fail(res, e); }
};

exports.reporteCompleto = async (_req, res) => {
  try {
    const rows = await queryP(Q.reporteCompleto);
    const familiasMap = new Map();

    for (const row of rows) {
      if (!familiasMap.has(row.id_familia)) {
        familiasMap.set(row.id_familia, {
          id_familia: row.id_familia,
          nombre_familia: row.nombre_familia,
          residencia: row.residencia,
          papa_nombre: row.papa_nombre,
          mama_nombre: row.mama_nombre,
          hijos_en_casa: [],
          alumnos_asignados: [],
          ninos_hogar_count: row.ninos_hogar_count ?? 0,
          total_miembros: 0
        });
      }

      const familia = familiasMap.get(row.id_familia);

      if (row.id_usuario) { 
        const miembroNombre = row.miembro_nombre;
        if (row.tipo_miembro === 'HIJO' && !familia.hijos_en_casa.includes(miembroNombre)) {
          familia.hijos_en_casa.push(miembroNombre);
        } else if (row.tipo_miembro === 'ALUMNO_ASIGNADO' && !familia.alumnos_asignados.includes(miembroNombre)) {
          familia.alumnos_asignados.push(miembroNombre);
        }
      }
    }
    
    familiasMap.forEach(familia => {
       let count = 0;
       if (familia.papa_nombre) count++;
       if (familia.mama_nombre) count++;
       count += familia.hijos_en_casa.length;
       count += familia.alumnos_asignados.length;
       count += familia.ninos_hogar_count ?? 0;
       familia.total_miembros = count;
    });

    ok(res, Array.from(familiasMap.values()));
  } catch (e) { fail(res, e); }
};

const saveFamilyImage = async (file, id_familia, tipo) => {
  if (!file) return null;

  const resizeOpts = tipo === 'portada'
    ? { maxW: 1600, maxH: 900, quality: 75, folder: 'edi301/familias/portadas' }
    : { maxW: 512, maxH: 512, quality: 80, folder: 'edi301/familias/perfiles', fit: 'cover' };

  return await saveOptimizedImage(file, {
    prefix: `familia-${id_familia}-${tipo}`,
    maxW: resizeOpts.maxW,
    maxH: resizeOpts.maxH,
    quality: resizeOpts.quality,
    folder: resizeOpts.folder,
    fit: resizeOpts.fit || 'inside',
  });
};

exports.uploadFotos = async (req, res) => {
  try {
    const id_familia = Number(req.params.id);

    if (!req.files || Object.keys(req.files).length === 0) {
      return bad(res, 'No se subió ningún archivo.');
    }

    // ── Procesar imágenes (errores aquí → 400) ─────────────────────────────
    let urlPortada = null;
    let urlPerfil  = null;

    try {
      urlPortada = req.files.foto_portada
        ? await saveFamilyImage(req.files.foto_portada, id_familia, 'portada')
        : null;

      urlPerfil = req.files.foto_perfil
        ? await saveFamilyImage(req.files.foto_perfil, id_familia, 'perfil')
        : null;
    } catch (imgErr) {
      console.error('uploadFotos – error al procesar imagen:', imgErr.message);
      return bad(res, imgErr.message || 'Error al procesar la imagen. Asegúrate de subir una imagen válida (jpg, png, webp).');
    }

    if (!urlPortada && !urlPerfil) {
      return bad(res, 'No se pudieron procesar los archivos. Verifica que sean imágenes válidas.');
    }

    // ── Guardar URLs en la DB (errores aquí → 500) ─────────────────────────
    await queryP(Q.updateFotos, {
      id_familia:      { type: sql.Int,      value: id_familia },
      foto_portada_url: { type: sql.NVarChar, value: urlPortada },
      foto_perfil_url:  { type: sql.NVarChar, value: urlPerfil  },
    });

    const rows = await queryP(withBase(Q.byId), {
      id_familia: { type: sql.Int, value: id_familia },
    });
    if (!rows.length) return notFound(res);
    ok(res, rows[0]);

  } catch (e) {
    console.error('uploadFotos error:', e);
    fail(res, e);
  }
};

exports.updateDescripcion = async (req, res) => {
  try {
    const id_familia = Number(req.params.id);
    const { descripcion } = req.body;

    if (!descripcion || descripcion.trim().length === 0) return bad(res, 'Descripción requerida');
    if (descripcion.length > 500) return bad(res, 'La descripción excede 500 caracteres');

    await queryP(Q.update, {
      id_familia: { type: sql.Int, value: id_familia },
      nombre_familia: { type: sql.NVarChar, value: null },
      residencia: { type: sql.NVarChar, value: null },
      direccion: { type: sql.NVarChar, value: null },
      papa_id: { type: sql.Int, value: null },
      mama_id: { type: sql.Int, value: null },
      descripcion: { type: sql.NVarChar, value: descripcion.trim() }
    });

    const rows = await queryP(withBase(Q.byId), {
      id_familia: { type: sql.Int, value: id_familia },
    });

    if (!rows.length) return notFound(res);
    ok(res, rows[0]);
  } catch (e) {
    console.error('updateDescripcion error:', e);
    fail(res, e);
  }

  };

  // src/controllers/familias.controller.js
exports.listAvailable = async (req, res) => {
  try {
    const rows = await queryP(Q.listAvailable);

    const formatted = rows.map(f => ({
      ...f,
      // Verificamos que f.padres exista antes de hacer el slice
      padres: (f.padres && f.padres.endsWith(' & ')) ? f.padres.slice(0, -3) : (f.padres || 'Sin padres')
    }));
    ok(res, formatted);
  } catch (e) {
    console.error('Error en listAvailable:', e); // Esto te dirá exactamente qué falla
    fail(res, e);
  }
};

// ============================================================================
// FAMILIA MANUAL — creación sin padres registrados + vinculación posterior
// ============================================================================

// ── Helpers de nombres (REPLICAN exactamente la lógica del frontend Flutter
//    en lib/src/pages/Admin/add_family/add_family_controller.dart) ───────────

function _firstSurname(fullLastName) {
  if (!fullLastName) return '';
  const text = String(fullLastName).trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const parts = text.split(' ');
  if (parts.length === 0) return '';

  const lower = parts.map((e) => e.toLowerCase());
  if (parts.length >= 3 && lower[0] === 'de' && lower[1] === 'la')  return `${parts[0]} ${parts[1]} ${parts[2]}`;
  if (parts.length >= 3 && lower[0] === 'de' && lower[1] === 'los') return `${parts[0]} ${parts[1]} ${parts[2]}`;
  if (parts.length >= 3 && lower[0] === 'de' && lower[1] === 'las') return `${parts[0]} ${parts[1]} ${parts[2]}`;
  if (parts.length >= 2 && (lower[0] === 'de' || lower[0] === 'del')) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

function _secondSurname(fullLastName) {
  if (!fullLastName) return '';
  const text = String(fullLastName).trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const parts = text.split(' ');
  if (parts.length <= 1) return '';

  const lower = parts.map((e) => e.toLowerCase());
  let firstSurnameLength;
  if (parts.length >= 3 && lower[0] === 'de' && (lower[1] === 'la' || lower[1] === 'los' || lower[1] === 'las')) {
    firstSurnameLength = 3;
  } else if (parts.length >= 2 && (lower[0] === 'de' || lower[0] === 'del')) {
    firstSurnameLength = 2;
  } else {
    firstSurnameLength = 1;
  }
  if (firstSurnameLength >= parts.length) return '';
  return parts.slice(firstSurnameLength).join(' ');
}

/** Misma fórmula que recomputeFamilyName() en el frontend. */
function _buildFamilyName(papaApellido, mamaApellido) {
  const hasPapa = papaApellido && papaApellido.trim().length > 0;
  const hasMama = mamaApellido && mamaApellido.trim().length > 0;

  let base = '';
  if (hasPapa && hasMama) {
    base = [_firstSurname(papaApellido), _firstSurname(mamaApellido)]
      .filter((s) => s.trim()).join(' ');
  } else if (hasPapa) {
    base = [_firstSurname(papaApellido), _secondSurname(papaApellido)]
      .filter((s) => s.trim()).join(' ');
  } else if (hasMama) {
    base = [_firstSurname(mamaApellido), _secondSurname(mamaApellido)]
      .filter((s) => s.trim()).join(' ');
  }
  return base ? `Familia ${base}` : 'Familia';
}

/** Capitaliza estilo "Juan Carlos" / "García López" respetando partículas. */
function _formatSpanishName(text) {
  if (!text) return text;
  const lowerWords = ['de','del','la','las','los','y','da','dos','van','von'];
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, i) => (lowerWords.includes(word) && i !== 0)
      ? word
      : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ── POST /familias/manual ──────────────────────────────────────────────────
exports.createManual = async (req, res) => {
  try {
    let {
      papa_nombre, papa_apellido,
      mama_nombre, mama_apellido,
      residencia, direccion, descripcion, nombre_familia,
    } = req.body;

    // Formatear (mismo formateo que se aplica al crear usuarios)
    papa_nombre   = papa_nombre   ? _formatSpanishName(papa_nombre)   : null;
    papa_apellido = papa_apellido ? _formatSpanishName(papa_apellido) : null;
    mama_nombre   = mama_nombre   ? _formatSpanishName(mama_nombre)   : null;
    mama_apellido = mama_apellido ? _formatSpanishName(mama_apellido) : null;

    if (!papa_nombre && !mama_nombre) {
      return bad(res, 'Debes indicar al menos el nombre del padre o de la madre.');
    }

    // Si se pasó papa_nombre debe venir apellido (y viceversa). Misma exigencia
    // que en el flujo normal — el match contra nuevos usuarios necesita ambos.
    if (papa_nombre && !papa_apellido) return bad(res, 'Falta el apellido del padre.');
    if (mama_nombre && !mama_apellido) return bad(res, 'Falta el apellido de la madre.');

    // Generar nombre_familia si no vino explícito
    const computedName = _buildFamilyName(papa_apellido, mama_apellido);
    const finalName = (nombre_familia && nombre_familia.trim()) || computedName;

    // Dirección solo si residencia=EXTERNA
    const finalDireccion = (residencia === 'EXTERNA') ? (direccion ?? null) : null;

    const rows = await queryP(Q.insertManual, {
      nombre_familia:          { type: sql.NVarChar, value: finalName },
      residencia:              { type: sql.NVarChar, value: residencia },
      direccion:               { type: sql.NVarChar, value: finalDireccion },
      papa_nombre_pendiente:   { type: sql.NVarChar, value: papa_nombre   ?? null },
      papa_apellido_pendiente: { type: sql.NVarChar, value: papa_apellido ?? null },
      mama_nombre_pendiente:   { type: sql.NVarChar, value: mama_nombre   ?? null },
      mama_apellido_pendiente: { type: sql.NVarChar, value: mama_apellido ?? null },
    });

    if (!rows.length) return fail(res, 'No se pudo crear la familia manual.');
    const id_familia = rows[0].id_familia;

    // Descripción se setea aparte (la query insert no la incluye, igual que el flujo normal)
    if (descripcion && descripcion.trim()) {
      await queryP(`
        UPDATE EDI.Familias_EDI SET descripcion = @descripcion, updated_at = GETDATE()
        WHERE id_familia = @id_familia
      `, {
        id_familia:  { type: sql.Int,      value: id_familia },
        descripcion: { type: sql.NVarChar, value: descripcion.trim() },
      });
    }

    const finalRows = await queryP(withBase(Q.byId), { id_familia: { type: sql.Int, value: id_familia } });
    created(res, finalRows[0]);
  } catch (e) {
    console.error('createManual error:', e);
    fail(res, e);
  }
};

// ── GET /familias/candidatos/:id_usuario ───────────────────────────────────
// Para el modal post-registro: devuelve TODAS las familias activas con
// papa/mama pendiente cuyos nombre+apellido coincidan (case+accent insensitive)
// con los del usuario. Decide el rol según id_rol del usuario:
//    PapaEDI (2) → buscamos en slot PAPA
//    MamaEDI (3) → buscamos en slot MAMA
exports.findCandidatesForUser = async (req, res) => {
  try {
    const idUsuario = Number(req.params.id_usuario);
    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
      return bad(res, 'id_usuario inválido');
    }

    const userRows = await queryP(`
      SELECT u.id_usuario, u.nombre, u.apellido, u.id_rol, r.nombre_rol
      FROM EDI.Usuarios u
      JOIN EDI.Roles r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = @id AND u.activo = 1
    `, { id: { type: sql.Int, value: idUsuario } });

    if (!userRows.length) return notFound(res);
    const user = userRows[0];

    // Determinar el rol candidato. Aceptamos también los nombres viejos
    // ('Padre' / 'Madre') por si quedaran roles legacy.
    let rol = null;
    if (['PapaEDI', 'Padre'].includes(user.nombre_rol)) rol = 'PAPA';
    else if (['MamaEDI', 'Madre'].includes(user.nombre_rol)) rol = 'MAMA';

    if (!rol) {
      // No es padre ni madre: no hay candidatos posibles
      return ok(res, []);
    }

    const candidatos = await queryP(Q.findCandidatesForUser, {
      rol:      { type: sql.NVarChar, value: rol },
      nombre:   { type: sql.NVarChar, value: user.nombre },
      apellido: { type: sql.NVarChar, value: user.apellido },
    });

    ok(res, candidatos);
  } catch (e) {
    console.error('findCandidatesForUser error:', e);
    fail(res, e);
  }
};

// ── POST /familias/:id/vincular ────────────────────────────────────────────
// Vincula un usuario al slot PAPA o MAMA de una familia. Limpia los campos
// pendientes, inserta en Miembros_Familia y envía notificación.
// Usado por:
//   (1) modal post-registro (usuario se vincula a sí mismo)
//   (2) panel admin (admin vincula a un tercero)
exports.linkUser = async (req, res) => {
  try {
    const id_familia = Number(req.params.id);
    const { id_usuario, rol } = req.body || {};

    if (!Number.isInteger(id_familia) || id_familia <= 0) return bad(res, 'id de familia inválido');
    if (!Number.isInteger(id_usuario) || id_usuario <= 0) return bad(res, 'id_usuario inválido');
    if (!['PAPA', 'MAMA'].includes(rol)) return bad(res, 'rol debe ser PAPA o MAMA');

    // Seguridad: si el caller NO es Admin, solo puede vincularse a sí mismo.
    const callerRol = req.user && (req.user.nombre_rol || req.user.rol);
    const callerId  = req.user && (req.user.id_usuario || req.user.id);
    if (callerRol !== 'Admin' && Number(callerId) !== Number(id_usuario)) {
      return res.status(403).json({ ok: false, error: 'No puedes vincular a otro usuario.' });
    }

    // Validar que el usuario no esté ya en otra familia (como padre/madre o miembro)
    const conflictPadre = await _padreEnOtraFamilia(id_usuario, id_familia);
    if (conflictPadre) {
      return bad(res, `El usuario ya pertenece a la familia "${conflictPadre.nombre_familia}".`);
    }
    const conflictMiembro = await _usuarioEnOtraFamilia(id_usuario, id_familia);
    if (conflictMiembro) {
      return bad(res, `El usuario ya es miembro de la familia "${conflictMiembro.nombre_familia}".`);
    }

    // Actualizar el slot. La query falla (0 filas) si el slot ya estaba ocupado.
    const linked = await queryP(Q.linkUserToFamilySlot, {
      id_familia: { type: sql.Int,      value: id_familia },
      id_usuario: { type: sql.Int,      value: id_usuario },
      rol:        { type: sql.NVarChar, value: rol },
    });

    if (!linked.length) {
      return bad(res, `El slot ${rol} de esta familia ya estaba ocupado o la familia no existe.`);
    }

    const familiaActualizada = linked[0];

    // Insertar en Miembros_Familia (idempotente — el índice único evita duplicados,
    // así que envolvemos en try/catch para que no truene si ya existía)
    try {
      await queryP(`
        INSERT INTO EDI.Miembros_Familia (id_familia, id_usuario, tipo_miembro, activo, created_at)
        VALUES (@id_familia, @id_usuario, @tipo, 1, SYSDATETIME())
      `, {
        id_familia: { type: sql.Int,      value: id_familia },
        id_usuario: { type: sql.Int,      value: id_usuario },
        tipo:       { type: sql.NVarChar, value: rol === 'PAPA' ? 'PADRE' : 'MADRE' },
      });
    } catch (e) {
      // ignorar duplicados (id_familia + id_usuario únicos)
      if (e.number !== 2627 && e.number !== 2601) throw e;
    }

    // Notificación in-app + push
    try {
      await queryP(`
        INSERT INTO EDI.Notificaciones (id_usuario_destino, titulo, cuerpo, tipo, id_referencia, leido, fecha_creacion)
        VALUES (@uid, @tit, @body, @tipo, @ref, 0, GETUTCDATE())
      `, {
        uid:  { type: sql.Int,      value: id_usuario },
        tit:  { type: sql.NVarChar, value: '¡Ya estás en una familia! 🏠' },
        body: { type: sql.NVarChar, value: `Has sido vinculado a la familia "${familiaActualizada.nombre_familia}".` },
        tipo: { type: sql.NVarChar, value: 'FAMILIA_VINCULADA' },
        ref:  { type: sql.Int,      value: id_familia },
      });

      const tokens = await getActiveFcmTokensForUsers([id_usuario]);
      if (tokens.length > 0) {
        enviarNotificacionMulticast(
          tokens,
          '¡Ya estás en una familia! 🏠',
          `Has sido vinculado a la familia "${familiaActualizada.nombre_familia}".`,
          { tipo: 'FAMILIA_VINCULADA', id_familia: String(id_familia) },
        );
      }
    } catch (notifErr) {
      console.error('linkUser – error enviando notificación:', notifErr.message);
    }

    const rows = await queryP(withBase(Q.byId), { id_familia: { type: sql.Int, value: id_familia } });
    ok(res, rows[0]);
  } catch (e) {
    console.error('linkUser error:', e);
    fail(res, e);
  }
};

// ── GET /familias/pendientes (admin) ───────────────────────────────────────
// Lista todas las familias con al menos un slot de padre/madre sin vincular.
// Sirve para el panel donde el admin puede forzar la vinculación manualmente.
exports.listPendientes = async (_req, res) => {
  try {
    const rows = await queryP(Q.listPendientes);
    ok(res, rows);
  } catch (e) {
    console.error('listPendientes error:', e);
    fail(res, e);
  }
};
