const crypto = require('crypto');
const { sql, pool, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, notFound, fail } = require('../utils/http');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const { insertarNotificaciones, insertarNotificacionesUsuariosActivos } = require('../utils/notificaciones');
const { runInTransaction } = require('../utils/transaction');
const { sqlPoblacion } = require('../utils/poblacion');
const { sortearMuestra, semillaPorDefecto } = require('../utils/muestreo');

const isAdmin = (req) => req.user?.nombre_rol === 'Admin';
const anonymousHash = (userId, surveyId) => crypto
  .createHmac('sha256', process.env.SURVEY_ANONYMITY_SECRET || process.env.DBPASSWORD || 'edi301-surveys')
  .update(`${userId}:${surveyId}`).digest('hex');

async function surveyRows(id) {
  return queryP(`
    SELECT e.id_encuesta, e.titulo, e.descripcion, e.fecha_limite, e.estado, e.created_at,
      e.audiencia, e.muestra_semilla, e.muestra_creada_at, e.muestra_criterio,
      p.id_pregunta, p.texto AS pregunta_texto, p.tipo, p.orden AS pregunta_orden, p.requerida,
      o.id_opcion, o.texto AS opcion_texto, o.orden AS opcion_orden
    FROM EDI.Encuestas e
    LEFT JOIN EDI.Encuesta_Preguntas p ON p.id_encuesta = e.id_encuesta
    LEFT JOIN EDI.Encuesta_Opciones o ON o.id_pregunta = p.id_pregunta
    WHERE e.id_encuesta = @id AND e.activo = 1
    ORDER BY p.orden, o.orden`, { id: { type: sql.Int, value: id } });
}
function mapSurvey(rows) {
  if (!rows.length) return null;
  const head = rows[0];
  const survey = { id_encuesta: head.id_encuesta, titulo: head.titulo, descripcion: head.descripcion, fecha_limite: head.fecha_limite, estado: head.estado, created_at: head.created_at, audiencia: head.audiencia || 'TODOS', muestra_semilla: head.muestra_semilla || null, muestra_creada_at: head.muestra_creada_at || null, muestra_criterio: head.muestra_criterio || null, preguntas: [] };
  const questions = new Map();
  for (const row of rows) {
    if (!row.id_pregunta) continue;
    if (!questions.has(row.id_pregunta)) {
      const q = { id_pregunta: row.id_pregunta, texto: row.pregunta_texto, tipo: row.tipo, orden: row.pregunta_orden, requerida: Boolean(row.requerida), opciones: [] };
      questions.set(row.id_pregunta, q); survey.preguntas.push(q);
    }
    if (row.id_opcion) questions.get(row.id_pregunta).opciones.push({ id_opcion: row.id_opcion, texto: row.opcion_texto, orden: row.opcion_orden });
  }
  return survey;
}
function isOpen(s) { return s.estado === 'PUBLICADA' && (!s.fecha_limite || new Date(s.fecha_limite) >= new Date()); }

// ── Audiencia ────────────────────────────────────────────────────
// Una encuesta con audiencia 'MUESTRA' solo la pueden ver y responder las
// personas sorteadas. Sin esto el muestreo no serviria de nada: bastaria con
// conocer el id de la encuesta para colarse y contaminar el estudio.
//
// Esto no toca el anonimato de las respuestas: saber a quien se invito y
// saber que contesto cada quien son cosas distintas. EDI.Encuesta_Respuestas
// sigue guardando solo el respondent_hash.

/**
 * true si el usuario puede ver o responder la encuesta.
 *
 * `permitirAdmin` existe porque las dos situaciones son distintas: el Admin
 * debe poder ABRIR cualquier encuesta para revisarla, pero no debe poder
 * RESPONDER una en la que no fue sorteado. Si pudiera, metaria una respuesta
 * que no pertenece a la muestra y el estudio quedaria sesgado.
 */
async function puedeResponder(req, survey, { permitirAdmin = false } = {}) {
  if (survey.audiencia !== 'MUESTRA') return true;
  if (permitirAdmin && isAdmin(req)) return true;
  const idUsuario = Number(req.user?.id_usuario);
  if (!Number.isInteger(idUsuario)) return false;
  const filas = await queryP(
    `SELECT TOP 1 1 AS invitado FROM EDI.Encuesta_Audiencia
      WHERE id_encuesta = @encuesta AND id_usuario = @usuario`,
    {
      encuesta: { type: sql.Int, value: survey.id_encuesta },
      usuario: { type: sql.Int, value: idUsuario },
    },
  );
  return filas.length > 0;
}

/** Tokens FCM de los destinatarios reales de la encuesta. */
async function tokensDestinatarios(survey) {
  if (survey.audiencia !== 'MUESTRA') {
    const users = await queryP('SELECT fcm_token FROM EDI.Usuarios WHERE activo=1');
    return users.map((u) => u.fcm_token).filter(Boolean);
  }
  const users = await queryP(
    `SELECT s.fcm_token
       FROM EDI.Encuesta_Audiencia a
       JOIN EDI.Usuarios u ON u.id_usuario = a.id_usuario AND u.activo = 1
       JOIN EDI.Usuario_Sesiones s ON s.id_usuario = u.id_usuario AND s.activo = 1
      WHERE a.id_encuesta = @encuesta
        AND s.fcm_token IS NOT NULL AND LEN(s.fcm_token) > 10`,
    { encuesta: { type: sql.Int, value: survey.id_encuesta } },
  );
  return users.map((u) => u.fcm_token).filter(Boolean);
}

async function idsDestinatarios(idEncuesta) {
  const filas = await queryP(
    'SELECT id_usuario FROM EDI.Encuesta_Audiencia WHERE id_encuesta = @encuesta',
    { encuesta: { type: sql.Int, value: idEncuesta } },
  );
  return filas.map((f) => f.id_usuario);
}

/** Manda el aviso (historial + push) a quien corresponda segun la audiencia. */
async function notificarEncuesta(survey) {
  const titulo = '\u{1F4CB} Nueva encuesta';
  const tokens = await tokensDestinatarios(survey);

  if (survey.audiencia === 'MUESTRA') {
    const ids = await idsDestinatarios(survey.id_encuesta);
    if (ids.length === 0) return { notificados: 0, tokens: 0 };
    await insertarNotificaciones(
      ids, titulo, survey.titulo, 'ENCUESTA', survey.id_encuesta,
    );
  } else {
    await insertarNotificacionesUsuariosActivos(
      titulo, survey.titulo, 'ENCUESTA', survey.id_encuesta,
    );
  }

  if (tokens.length > 0) {
    // Sin await: el push es best-effort, no debe retrasar la respuesta HTTP.
    enviarNotificacionMulticast(tokens, titulo, survey.titulo, {
      tipo: 'ENCUESTA', id_encuesta: survey.id_encuesta,
    });
  }
  return { tokens: tokens.length };
}

exports.list = async (req, res) => {
  try {
    // Un usuario normal solo ve encuestas PUBLICADAS y, si son por muestreo,
    // solo las que le tocaron. El Admin las ve todas.
    const rows = await queryP(
      `SELECT e.id_encuesta, e.titulo, e.descripcion, e.fecha_limite, e.estado,
              e.created_at, e.audiencia
         FROM EDI.Encuestas e
        WHERE e.activo = 1
          ${isAdmin(req) ? '' : `
          AND e.estado = 'PUBLICADA'
          AND (
                e.audiencia = 'TODOS'
             OR EXISTS (SELECT 1 FROM EDI.Encuesta_Audiencia a
                         WHERE a.id_encuesta = e.id_encuesta
                           AND a.id_usuario = @usuario)
              )`}
        ORDER BY e.created_at DESC`,
      { usuario: { type: sql.Int, value: Number(req.user?.id_usuario) || 0 } },
    );
    const result = await Promise.all(rows.map(async (survey) => {
      const hash = anonymousHash(req.user.id_usuario, survey.id_encuesta);
      const voted = await queryP('SELECT 1 AS voted FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id AND respondent_hash=@hash', { id: { type: sql.Int, value: survey.id_encuesta }, hash: { type: sql.Char(64), value: hash } });

      // puede_responder se calcula sin la excepcion del Admin a proposito.
      // El Admin ve todas las encuestas en esta lista para administrarlas,
      // pero si no lo sortearon no le toca responder, y la tarjeta de
      // "tienes una encuesta pendiente" del feed se guia por este campo.
      const invitado = await puedeResponder(req, survey);

      return {
        ...survey,
        abierta: isOpen(survey),
        respondida: voted.length > 0,
        puede_responder: invitado && isOpen(survey) && voted.length === 0,
      };
    }));
    ok(res, result);
  } catch (e) { fail(res, e); }
};
exports.get = async (req, res) => {
  try {
    const survey = mapSurvey(await surveyRows(Number(req.params.id)));
    if (!survey) return notFound(res);
    if (!isAdmin(req) && !isOpen(survey)) return notFound(res);
    // Si es por muestreo y no te toco, la encuesta no existe para ti.
    // Se responde 404 y no 403 a proposito: un 403 confirmaria que hay una
    // encuesta con ese id y que hay gente invitada.
    if (!(await puedeResponder(req, survey, { permitirAdmin: true }))) return notFound(res);
    const voted = await queryP('SELECT 1 AS voted FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id AND respondent_hash=@hash', { id: { type: sql.Int, value: survey.id_encuesta }, hash: { type: sql.Char(64), value: anonymousHash(req.user.id_usuario, survey.id_encuesta) } });
    ok(res, { ...survey, abierta: isOpen(survey), respondida: voted.length > 0 });
  } catch (e) { fail(res, e); }
};
async function writeSurvey(transaction, id, body) {
  const request = new sql.Request(transaction);
  request.input('titulo', sql.NVarChar, body.titulo); request.input('descripcion', sql.NVarChar, body.descripcion || null); request.input('fecha_limite', sql.DateTime, body.fecha_limite || null); request.input('estado', sql.NVarChar, body.estado);
  let surveyId = id;
  if (id) { request.input('id', sql.Int, id); await request.query("UPDATE EDI.Encuestas SET titulo=@titulo, descripcion=@descripcion, fecha_limite=@fecha_limite, estado=@estado, updated_at=GETDATE() WHERE id_encuesta=@id AND activo=1; DELETE d FROM EDI.Encuesta_Respuesta_Detalle d JOIN EDI.Encuesta_Respuestas r ON r.id_respuesta=d.id_respuesta WHERE r.id_encuesta=@id; DELETE FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id; DELETE FROM EDI.Encuesta_Opciones WHERE id_pregunta IN (SELECT id_pregunta FROM EDI.Encuesta_Preguntas WHERE id_encuesta=@id); DELETE FROM EDI.Encuesta_Preguntas WHERE id_encuesta=@id;"); }
  else { request.input('audiencia', sql.NVarChar, body.audiencia === 'MUESTRA' ? 'MUESTRA' : 'TODOS');
    // La audiencia va en el INSERT, no en un UPDATE posterior: si naciera
    // como TODOS habria una ventana, por corta que sea, en la que cualquiera
    // podria ver una encuesta que era para una muestra.
    const r = await request.query('INSERT INTO EDI.Encuestas (titulo,descripcion,fecha_limite,estado,audiencia) OUTPUT INSERTED.id_encuesta VALUES (@titulo,@descripcion,@fecha_limite,@estado,@audiencia)'); surveyId = r.recordset[0].id_encuesta; }
  for (let i = 0; i < body.preguntas.length; i++) { const q = body.preguntas[i]; const qr = new sql.Request(transaction); qr.input('survey', sql.Int, surveyId); qr.input('texto', sql.NVarChar, q.texto); qr.input('tipo', sql.NVarChar, q.tipo); qr.input('orden', sql.Int, i + 1); qr.input('requerida', sql.Bit, q.requerida); const ins = await qr.query('INSERT INTO EDI.Encuesta_Preguntas (id_encuesta,texto,tipo,orden,requerida) OUTPUT INSERTED.id_pregunta VALUES (@survey,@texto,@tipo,@orden,@requerida)'); for (let j=0; j<(q.opciones||[]).length; j++) { const or = new sql.Request(transaction); or.input('question', sql.Int, ins.recordset[0].id_pregunta); or.input('texto', sql.NVarChar, q.opciones[j]); or.input('orden', sql.Int, j+1); await or.query('INSERT INTO EDI.Encuesta_Opciones (id_pregunta,texto,orden) VALUES (@question,@texto,@orden)'); } }
  return surveyId;
}
exports.create = async (req, res) => {
  try {
    // Si el formulario pidio muestra, la encuesta se INSERTA ya con
    // audiencia = 'MUESTRA'. Asi, entre que se crea y se sortea, no existe
    // ni un instante en que sea visible para todos.
    const quiereMuestra = req.body?.audiencia === 'MUESTRA';
    const id = await runInTransaction(
      pool,
      transaction => writeSurvey(transaction, null, req.body),
      { label: 'creación de encuesta' }
    );

    let muestra = null;
    if (quiereMuestra) {
      try {
        muestra = await ejecutarSorteo(id, req.body.muestra || {});
      } catch (e) {
        // Falla cerrada: la encuesta queda con audiencia MUESTRA y sin nadie
        // dentro, asi que no la ve nadie. Es preferible a dejarla abierta a
        // toda la app por accidente.
        return bad(res,
          `La encuesta se guardó (id ${id}) pero no se pudo sortear la muestra: ` +
          `${e.message} Nadie la vera hasta que sortees desde el menu de la encuesta.`);
      }
    }

    const survey = mapSurvey(await surveyRows(id));
    created(res, {
      ...survey,
      muestra: muestra && {
        semilla: muestra.semilla,
        total: muestra.seleccionados.length,
        poblacion_elegible: muestra.poblacion,
        estratos: muestra.resumen,
      },
    });

    // El aviso sale despues del sorteo, y solo a quien corresponda.
    if (survey.estado === 'PUBLICADA') {
      await notificarEncuesta(survey);
    }
  } catch (e) {
    fail(res, e);
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const antes = mapSurvey(await surveyRows(id));
    if (!antes) return notFound(res);
    await runInTransaction(
      pool,
      transaction => writeSurvey(transaction, id, req.body),
      { label: 'actualización de encuesta' }
    );
    const despues = mapSurvey(await surveyRows(id));
    ok(res, despues);

    // Aviso al publicar. Antes solo notificaba `create`, asi que una encuesta
    // guardada como BORRADOR y publicada despues no avisaba a nadie. Con
    // muestreo eso es lo normal: primero se sortea, luego se publica.
    if (antes.estado !== 'PUBLICADA' && despues.estado === 'PUBLICADA'
        && isOpen(despues)) {
      await notificarEncuesta(despues);
    }
  } catch (e) {
    if (!res.headersSent) fail(res, e);
    else console.error('Error tras responder en update de encuesta:', e);
  }
};
exports.close = async (req,res) => { try { const rows=await queryP("UPDATE EDI.Encuestas SET estado='CERRADA', updated_at=GETDATE() OUTPUT INSERTED.id_encuesta WHERE id_encuesta=@id AND activo=1", {id:{type:sql.Int,value:Number(req.params.id)}}); if(!rows.length)return notFound(res); ok(res,{id_encuesta:rows[0].id_encuesta,estado:'CERRADA'}); }catch(e){fail(res,e);} };
exports.remove = async (req,res) => { try { await queryP('UPDATE EDI.Encuestas SET activo=0, updated_at=GETDATE() WHERE id_encuesta=@id',{id:{type:sql.Int,value:Number(req.params.id)}}); ok(res,{message:'Encuesta eliminada'}); }catch(e){fail(res,e);} };
exports.submit = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const survey = mapSurvey(await surveyRows(id));
    if (!survey) return notFound(res);
    if (!isOpen(survey)) return bad(res, 'La encuesta no está disponible.');
    // Barrera real del muestreo. La comprobacion del listado es comodidad de
    // interfaz; esta es la que impide que alguien fuera de la muestra mande
    // una respuesta llamando al endpoint directamente.
    if (!(await puedeResponder(req, survey))) {
      return bad(res, 'Esta encuesta está dirigida a un grupo específico de participantes.');
    }

    const answerByQuestion = new Map(
      req.body.respuestas.map(answer => [answer.id_pregunta, answer])
    );
    for (const question of survey.preguntas) {
      const answer = answerByQuestion.get(question.id_pregunta);
      if (question.requerida && !answer) {
        return bad(res, `La pregunta "${question.texto}" es obligatoria.`);
      }
      if (!answer) continue;
      if (question.tipo === 'LIBRE') {
        if (!answer.texto_libre?.trim()) {
          return bad(res, 'Una respuesta libre requerida no puede estar vacía.');
        }
        continue;
      }

      const optionIds = [...new Set(answer.opciones || [])];
      if ((question.tipo === 'UNICA' && optionIds.length !== 1)
        || (question.tipo === 'MULTIPLE' && question.requerida && optionIds.length === 0)) {
        return bad(res, 'Las opciones seleccionadas no son válidas.');
      }
      const allowed = new Set(question.opciones.map(option => option.id_opcion));
      if (optionIds.some(optionId => !allowed.has(optionId))) {
        return bad(res, 'Opción inválida.');
      }
    }

    const hash = anonymousHash(req.user.id_usuario, id);
    await runInTransaction(pool, async (transaction) => {
      const responseRequest = new sql.Request(transaction);
      responseRequest.input('survey', sql.Int, id);
      responseRequest.input('hash', sql.Char(64), hash);
      const inserted = await responseRequest.query(`
        INSERT INTO EDI.Encuesta_Respuestas (id_encuesta, respondent_hash)
        OUTPUT INSERTED.id_respuesta
        VALUES (@survey, @hash)
      `);
      const responseId = inserted.recordset[0].id_respuesta;

      for (const question of survey.preguntas) {
        const answer = answerByQuestion.get(question.id_pregunta);
        if (!answer) continue;
        if (question.tipo === 'LIBRE') {
          const detailRequest = new sql.Request(transaction);
          detailRequest.input('response', sql.Int, responseId);
          detailRequest.input('question', sql.Int, question.id_pregunta);
          detailRequest.input('text', sql.NVarChar, answer.texto_libre.trim());
          await detailRequest.query(`
            INSERT INTO EDI.Encuesta_Respuesta_Detalle
              (id_respuesta, id_pregunta, texto_libre)
            VALUES (@response, @question, @text)
          `);
          continue;
        }

        for (const optionId of [...new Set(answer.opciones || [])]) {
          const detailRequest = new sql.Request(transaction);
          detailRequest.input('response', sql.Int, responseId);
          detailRequest.input('question', sql.Int, question.id_pregunta);
          detailRequest.input('option', sql.Int, optionId);
          await detailRequest.query(`
            INSERT INTO EDI.Encuesta_Respuesta_Detalle
              (id_respuesta, id_pregunta, id_opcion)
            VALUES (@response, @question, @option)
          `);
        }
      }
    }, { label: 'registro de respuesta de encuesta' });

    created(res, { message: 'Respuesta registrada anónimamente' });
  } catch (e) {
    if (e.number === 2627 || e.number === 2601) {
      return bad(res, 'Ya respondiste esta encuesta.');
    }
    if (!res.headersSent) bad(res, e.message || 'No se pudo guardar la respuesta.');
  }
};
// ── Muestreo ────────────────────────────────────────────────────

/**
 * Sortea y guarda la audiencia de una encuesta. La usan tanto la creacion
 * (cuando se elige "muestra" en el formulario) como el endpoint suelto de
 * sorteo, para que no existan dos implementaciones que puedan divergir.
 *
 * Lanza Error con texto presentable si los parametros no cuadran.
 */
async function ejecutarSorteo(idEncuesta, opciones = {}) {
  const incluirColivi = opciones.incluir_colivi === true;
  const poblacion = await queryP(sqlPoblacion({ incluirColivi }));
  if (poblacion.length === 0) {
    throw new Error('No hay usuarios elegibles con los criterios actuales.');
  }

  const semilla = String(opciones.semilla || '').trim()
    || semillaPorDefecto(idEncuesta);

  const resultado = sortearMuestra(poblacion, {
    tamano: opciones.tamano,
    cuotas: opciones.cuotas,
    semilla,
  });

  const criterio = JSON.stringify({
    incluir_colivi: incluirColivi,
    tamano: opciones.tamano ?? null,
    cuotas: opciones.cuotas ?? null,
    poblacion: poblacion.length,
  }).slice(0, 500);

  await runInTransaction(pool, async (transaction) => {
    const limpiar = new sql.Request(transaction);
    limpiar.input('id', sql.Int, idEncuesta);
    await limpiar.query('DELETE FROM EDI.Encuesta_Audiencia WHERE id_encuesta = @id');

    for (const persona of resultado.seleccionados) {
      const ins = new sql.Request(transaction);
      ins.input('encuesta', sql.Int, idEncuesta);
      ins.input('usuario', sql.Int, persona.id_usuario);
      ins.input('estrato', sql.NVarChar, persona.estrato);
      await ins.query(`INSERT INTO EDI.Encuesta_Audiencia
        (id_encuesta, id_usuario, estrato) VALUES (@encuesta, @usuario, @estrato)`);
    }

    const marcar = new sql.Request(transaction);
    marcar.input('id', sql.Int, idEncuesta);
    marcar.input('semilla', sql.NVarChar, semilla);
    marcar.input('criterio', sql.NVarChar, criterio);
    await marcar.query(`UPDATE EDI.Encuestas
      SET audiencia = 'MUESTRA', muestra_semilla = @semilla,
          muestra_creada_at = GETDATE(), muestra_criterio = @criterio,
          updated_at = GETDATE()
      WHERE id_encuesta = @id`);
  }, { label: 'sorteo de muestra de encuesta' });

  return {
    semilla,
    incluirColivi,
    poblacion: poblacion.length,
    seleccionados: resultado.seleccionados,
    resumen: resultado.resumen,
  };
}

/**
 * POST /api/encuestas/:id/muestra
 *
 * Sortea al azar quienes van a poder responder. Acepta:
 *   { tamano: 130 }                       reparto proporcional entre grupos
 *   { cuotas: { PADRES: 40, HIJOS: 90 } } cuotas exactas por grupo
 *   { incluir_colivi: true }              por defecto COLIVI queda fuera
 *   { semilla: "..." }                    para reproducir un sorteo anterior
 *   { reemplazar: true }                  vuelve a sortear sobre una muestra ya hecha
 */
exports.sortear = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const survey = mapSurvey(await surveyRows(id));
    if (!survey) return notFound(res);

    const yaRespondida = await queryP(
      'SELECT COUNT(*) AS total FROM EDI.Encuesta_Respuestas WHERE id_encuesta = @id',
      { id: { type: sql.Int, value: id } },
    );
    if (Number(yaRespondida[0].total) > 0 && req.body?.reemplazar !== true) {
      return bad(res,
        'Esta encuesta ya tiene respuestas. Volver a sortear invalidaria el ' +
        'estudio: las respuestas recibidas dejarian de corresponder a la ' +
        'muestra. Envia reemplazar: true si de todas formas quieres rehacerla.');
    }

    const existentes = await queryP(
      'SELECT COUNT(*) AS total FROM EDI.Encuesta_Audiencia WHERE id_encuesta = @id',
      { id: { type: sql.Int, value: id } },
    );
    if (Number(existentes[0].total) > 0 && req.body?.reemplazar !== true) {
      return bad(res,
        `Esta encuesta ya tiene una muestra de ${existentes[0].total} personas. ` +
        'Envia reemplazar: true para sortearla de nuevo.');
    }

    let resultado;
    try {
      resultado = await ejecutarSorteo(id, req.body || {});
    } catch (e) {
      return bad(res, e.message);
    }

    const { poblacion, semilla, incluirColivi } = resultado;
    const actualizada = { ...survey, audiencia: 'MUESTRA' };
    let notificados = 0;
    if (actualizada.estado === 'PUBLICADA' && isOpen(actualizada)) {
      await notificarEncuesta(actualizada);
      notificados = resultado.seleccionados.length;
    }

    ok(res, {
      ok: true,
      id_encuesta: id,
      audiencia: 'MUESTRA',
      semilla,
      poblacion_elegible: poblacion,
      incluir_colivi: incluirColivi,
      total_muestra: resultado.seleccionados.length,
      estratos: resultado.resumen,
      notificados,
      nota: notificados === 0
        ? 'La muestra quedo guardada. El aviso se enviara cuando publiques la encuesta.'
        : null,
    });
  } catch (e) { fail(res, e); }
};

/**
 * GET /api/encuestas/:id/muestra
 * Composicion de la muestra. Devuelve nombres: el Admin necesita saber a
 * quien invito para dar seguimiento. Lo que sigue sin poder saberse es que
 * contesto cada uno.
 */
exports.verMuestra = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const survey = mapSurvey(await surveyRows(id));
    if (!survey) return notFound(res);

    const filas = await queryP(`
      SELECT a.id_usuario, a.estrato, u.nombre, u.apellido, u.correo,
             r.nombre_rol, u.carrera
        FROM EDI.Encuesta_Audiencia a
        JOIN EDI.Usuarios u ON u.id_usuario = a.id_usuario
        JOIN EDI.Roles r ON r.id_rol = u.id_rol
       WHERE a.id_encuesta = @id
       ORDER BY a.estrato, u.apellido, u.nombre`,
      { id: { type: sql.Int, value: id } });

    const respuestas = await queryP(
      'SELECT COUNT(*) AS total FROM EDI.Encuesta_Respuestas WHERE id_encuesta = @id',
      { id: { type: sql.Int, value: id } });
    const recibidas = Number(respuestas[0].total);

    const porEstrato = new Map();
    for (const f of filas) {
      porEstrato.set(f.estrato, (porEstrato.get(f.estrato) || 0) + 1);
    }

    ok(res, {
      id_encuesta: id,
      titulo: survey.titulo,
      audiencia: survey.audiencia,
      semilla: survey.muestra_semilla,
      creada: survey.muestra_creada_at,
      criterio: survey.muestra_criterio,
      total_muestra: filas.length,
      respuestas_recibidas: recibidas,
      tasa_respuesta_pct: filas.length === 0
        ? 0 : Number(((recibidas * 100) / filas.length).toFixed(2)),
      estratos: [...porEstrato.entries()].map(([estrato, total]) => ({ estrato, total })),
      integrantes: filas,
    });
  } catch (e) { fail(res, e); }
};

/** DELETE /api/encuestas/:id/muestra — vuelve a abrirla para todos. */
exports.quitarMuestra = async (req, res) => {
  try {
    const id = Number(req.params.id);
    await queryP('DELETE FROM EDI.Encuesta_Audiencia WHERE id_encuesta = @id',
      { id: { type: sql.Int, value: id } });
    await queryP(`UPDATE EDI.Encuestas
      SET audiencia = 'TODOS', muestra_semilla = NULL, muestra_creada_at = NULL,
          muestra_criterio = NULL, updated_at = GETDATE()
      WHERE id_encuesta = @id`, { id: { type: sql.Int, value: id } });
    ok(res, { ok: true, audiencia: 'TODOS' });
  } catch (e) { fail(res, e); }
};

exports.results = async (req,res) => { try { const id=Number(req.params.id); const survey=mapSurvey(await surveyRows(id)); if(!survey)return notFound(res); const total=(await queryP('SELECT COUNT(*) total FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id',{id:{type:sql.Int,value:id}}))[0].total; const counts=await queryP('SELECT id_pregunta,id_opcion,COUNT(*) total FROM EDI.Encuesta_Respuesta_Detalle d JOIN EDI.Encuesta_Respuestas r ON r.id_respuesta=d.id_respuesta WHERE r.id_encuesta=@id AND d.id_opcion IS NOT NULL GROUP BY id_pregunta,id_opcion',{id:{type:sql.Int,value:id}}); const libres=await queryP('SELECT d.id_pregunta,d.texto_libre FROM EDI.Encuesta_Respuesta_Detalle d JOIN EDI.Encuesta_Respuestas r ON r.id_respuesta=d.id_respuesta WHERE r.id_encuesta=@id AND d.texto_libre IS NOT NULL ORDER BY d.id_detalle',{id:{type:sql.Int,value:id}}); 
    // Detalle por respuesta, para poder cruzar preguntas entre si al exportar.
    // No se selecciona respondent_hash: la encuesta es anonima por diseno y
    // ese hash es justo lo que permitiria reconstruir quien contesto que.
    const detalleRows = await queryP(
      `SELECT r.id_respuesta, d.id_pregunta, d.id_opcion, d.texto_libre
         FROM EDI.Encuesta_Respuesta_Detalle d
         JOIN EDI.Encuesta_Respuestas r ON r.id_respuesta = d.id_respuesta
        WHERE r.id_encuesta = @id
        ORDER BY r.id_respuesta, d.id_pregunta, d.id_detalle`,
      { id: { type: sql.Int, value: id } },
    );

    // Se renumera 1..N. El id real de la fila no aporta nada al analisis y un
    // identificador estable entre exportaciones es exactamente lo que no
    // queremos que exista en una encuesta anonima.
    const indice = new Map();
    const detalle = detalleRows.map((row) => {
      if (!indice.has(row.id_respuesta)) indice.set(row.id_respuesta, indice.size + 1);
      return {
        n_respuesta: indice.get(row.id_respuesta),
        id_pregunta: row.id_pregunta,
        id_opcion: row.id_opcion,
        texto_libre: row.texto_libre,
      };
    });

    ok(res, {
      ...survey,
      total_respuestas: Number(total),
      conteos: counts,
      respuestas_libres: libres,
      detalle,
    });
  } catch (e) { fail(res, e); }
};
