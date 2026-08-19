const crypto = require('crypto');
const { sql, pool, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, notFound, fail } = require('../utils/http');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const { insertarNotificacion } = require('../utils/notificaciones');

const isAdmin = (req) => req.user?.nombre_rol === 'Admin';
const anonymousHash = (userId, surveyId) => crypto
  .createHmac('sha256', process.env.SURVEY_ANONYMITY_SECRET || process.env.DBPASSWORD || 'edi301-surveys')
  .update(`${userId}:${surveyId}`).digest('hex');

async function surveyRows(id) {
  return queryP(`
    SELECT e.id_encuesta, e.titulo, e.descripcion, e.fecha_limite, e.estado, e.created_at,
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
  const survey = { id_encuesta: head.id_encuesta, titulo: head.titulo, descripcion: head.descripcion, fecha_limite: head.fecha_limite, estado: head.estado, created_at: head.created_at, preguntas: [] };
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

exports.list = async (req, res) => {
  try {
    const rows = await queryP(`SELECT id_encuesta, titulo, descripcion, fecha_limite, estado, created_at FROM EDI.Encuestas WHERE activo=1 ${isAdmin(req) ? '' : "AND estado='PUBLICADA'"} ORDER BY created_at DESC`);
    const result = await Promise.all(rows.map(async (survey) => {
      const hash = anonymousHash(req.user.id_usuario, survey.id_encuesta);
      const voted = await queryP('SELECT 1 AS voted FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id AND respondent_hash=@hash', { id: { type: sql.Int, value: survey.id_encuesta }, hash: { type: sql.Char(64), value: hash } });
      return { ...survey, abierta: isOpen(survey), respondida: voted.length > 0 };
    }));
    ok(res, result);
  } catch (e) { fail(res, e); }
};
exports.get = async (req, res) => {
  try {
    const survey = mapSurvey(await surveyRows(Number(req.params.id)));
    if (!survey) return notFound(res);
    if (!isAdmin(req) && !isOpen(survey)) return notFound(res);
    const voted = await queryP('SELECT 1 AS voted FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id AND respondent_hash=@hash', { id: { type: sql.Int, value: survey.id_encuesta }, hash: { type: sql.Char(64), value: anonymousHash(req.user.id_usuario, survey.id_encuesta) } });
    ok(res, { ...survey, abierta: isOpen(survey), respondida: voted.length > 0 });
  } catch (e) { fail(res, e); }
};
async function writeSurvey(transaction, id, body) {
  const request = new sql.Request(transaction);
  request.input('titulo', sql.NVarChar, body.titulo); request.input('descripcion', sql.NVarChar, body.descripcion || null); request.input('fecha_limite', sql.DateTime, body.fecha_limite || null); request.input('estado', sql.NVarChar, body.estado);
  let surveyId = id;
  if (id) { request.input('id', sql.Int, id); await request.query("UPDATE EDI.Encuestas SET titulo=@titulo, descripcion=@descripcion, fecha_limite=@fecha_limite, estado=@estado, updated_at=GETDATE() WHERE id_encuesta=@id AND activo=1; DELETE d FROM EDI.Encuesta_Respuesta_Detalle d JOIN EDI.Encuesta_Respuestas r ON r.id_respuesta=d.id_respuesta WHERE r.id_encuesta=@id; DELETE FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id; DELETE FROM EDI.Encuesta_Opciones WHERE id_pregunta IN (SELECT id_pregunta FROM EDI.Encuesta_Preguntas WHERE id_encuesta=@id); DELETE FROM EDI.Encuesta_Preguntas WHERE id_encuesta=@id;"); }
  else { const r = await request.query('INSERT INTO EDI.Encuestas (titulo,descripcion,fecha_limite,estado) OUTPUT INSERTED.id_encuesta VALUES (@titulo,@descripcion,@fecha_limite,@estado)'); surveyId = r.recordset[0].id_encuesta; }
  for (let i = 0; i < body.preguntas.length; i++) { const q = body.preguntas[i]; const qr = new sql.Request(transaction); qr.input('survey', sql.Int, surveyId); qr.input('texto', sql.NVarChar, q.texto); qr.input('tipo', sql.NVarChar, q.tipo); qr.input('orden', sql.Int, i + 1); qr.input('requerida', sql.Bit, q.requerida); const ins = await qr.query('INSERT INTO EDI.Encuesta_Preguntas (id_encuesta,texto,tipo,orden,requerida) OUTPUT INSERTED.id_pregunta VALUES (@survey,@texto,@tipo,@orden,@requerida)'); for (let j=0; j<(q.opciones||[]).length; j++) { const or = new sql.Request(transaction); or.input('question', sql.Int, ins.recordset[0].id_pregunta); or.input('texto', sql.NVarChar, q.opciones[j]); or.input('orden', sql.Int, j+1); await or.query('INSERT INTO EDI.Encuesta_Opciones (id_pregunta,texto,orden) VALUES (@question,@texto,@orden)'); } }
  return surveyId;
}
exports.create = async (req, res) => { const t = new sql.Transaction(pool); try { await t.begin(); const id = await writeSurvey(t, null, req.body); await t.commit(); const survey = mapSurvey(await surveyRows(id)); created(res, survey); if (survey.estado === 'PUBLICADA') { const users = await queryP('SELECT id_usuario, fcm_token FROM EDI.Usuarios WHERE activo=1'); for (const user of users) insertarNotificacion(user.id_usuario, '📋 Nueva encuesta', survey.titulo, 'ENCUESTA', id); enviarNotificacionMulticast(users.map(x => x.fcm_token), '📋 Nueva encuesta', survey.titulo, { tipo: 'ENCUESTA', id_encuesta: id }); } } catch (e) { if (t.rolledBack === false) await t.rollback(); fail(res,e); } };
exports.update = async (req, res) => { const t = new sql.Transaction(pool); try { const id=Number(req.params.id); if (!(await surveyRows(id)).length) return notFound(res); await t.begin(); await writeSurvey(t,id,req.body); await t.commit(); ok(res,mapSurvey(await surveyRows(id))); } catch(e) { if(t.rolledBack===false) await t.rollback(); fail(res,e); } };
exports.close = async (req,res) => { try { const rows=await queryP("UPDATE EDI.Encuestas SET estado='CERRADA', updated_at=GETDATE() OUTPUT INSERTED.id_encuesta WHERE id_encuesta=@id AND activo=1", {id:{type:sql.Int,value:Number(req.params.id)}}); if(!rows.length)return notFound(res); ok(res,{id_encuesta:rows[0].id_encuesta,estado:'CERRADA'}); }catch(e){fail(res,e);} };
exports.remove = async (req,res) => { try { await queryP('UPDATE EDI.Encuestas SET activo=0, updated_at=GETDATE() WHERE id_encuesta=@id',{id:{type:sql.Int,value:Number(req.params.id)}}); ok(res,{message:'Encuesta eliminada'}); }catch(e){fail(res,e);} };
exports.submit = async (req,res) => { const t=new sql.Transaction(pool); try { const id=Number(req.params.id); const survey=mapSurvey(await surveyRows(id)); if(!survey)return notFound(res); if(!isOpen(survey))return bad(res,'La encuesta no está disponible.'); const hash=anonymousHash(req.user.id_usuario,id); await t.begin(); const rr=new sql.Request(t); rr.input('survey',sql.Int,id); rr.input('hash',sql.Char(64),hash); const inserted=await rr.query('INSERT INTO EDI.Encuesta_Respuestas (id_encuesta,respondent_hash) OUTPUT INSERTED.id_respuesta VALUES (@survey,@hash)'); const responseId=inserted.recordset[0].id_respuesta; const answerByQuestion=new Map(req.body.respuestas.map(x=>[x.id_pregunta,x])); for(const q of survey.preguntas){const a=answerByQuestion.get(q.id_pregunta); if(q.requerida&&!a)throw new Error(`La pregunta "${q.texto}" es obligatoria.`); if(!a)continue; if(q.tipo==='LIBRE'){if(!a.texto_libre?.trim())return bad(res,'Una respuesta libre requerida no puede estar vacía.'); const d=new sql.Request(t);d.input('r',sql.Int,responseId);d.input('q',sql.Int,q.id_pregunta);d.input('txt',sql.NVarChar,a.texto_libre.trim());await d.query('INSERT INTO EDI.Encuesta_Respuesta_Detalle (id_respuesta,id_pregunta,texto_libre) VALUES (@r,@q,@txt)');}else{const ids=[...new Set(a.opciones||[])];if((q.tipo==='UNICA'&&ids.length!==1)||(q.tipo==='MULTIPLE'&&q.requerida&&ids.length===0))return bad(res,'Las opciones seleccionadas no son válidas.');const allowed=new Set(q.opciones.map(x=>x.id_opcion));if(ids.some(x=>!allowed.has(x)))return bad(res,'Opción inválida.');for(const option of ids){const d=new sql.Request(t);d.input('r',sql.Int,responseId);d.input('q',sql.Int,q.id_pregunta);d.input('o',sql.Int,option);await d.query('INSERT INTO EDI.Encuesta_Respuesta_Detalle (id_respuesta,id_pregunta,id_opcion) VALUES (@r,@q,@o)');}}} await t.commit();created(res,{message:'Respuesta registrada anónimamente'});}catch(e){if(t.rolledBack===false)await t.rollback();if(e.number===2627||e.number===2601)return bad(res,'Ya respondiste esta encuesta.');if(!res.headersSent)bad(res,e.message||'No se pudo guardar la respuesta.');} };
exports.results = async (req,res) => { try { const id=Number(req.params.id); const survey=mapSurvey(await surveyRows(id)); if(!survey)return notFound(res); const total=(await queryP('SELECT COUNT(*) total FROM EDI.Encuesta_Respuestas WHERE id_encuesta=@id',{id:{type:sql.Int,value:id}}))[0].total; const counts=await queryP('SELECT id_pregunta,id_opcion,COUNT(*) total FROM EDI.Encuesta_Respuesta_Detalle d JOIN EDI.Encuesta_Respuestas r ON r.id_respuesta=d.id_respuesta WHERE r.id_encuesta=@id AND d.id_opcion IS NOT NULL GROUP BY id_pregunta,id_opcion',{id:{type:sql.Int,value:id}}); const libres=await queryP('SELECT d.id_pregunta,d.texto_libre FROM EDI.Encuesta_Respuesta_Detalle d JOIN EDI.Encuesta_Respuestas r ON r.id_respuesta=d.id_respuesta WHERE r.id_encuesta=@id AND d.texto_libre IS NOT NULL ORDER BY d.id_detalle',{id:{type:sql.Int,value:id}}); ok(res,{...survey,total_respuestas:Number(total),conteos:counts,respuestas_libres:libres}); }catch(e){fail(res,e);} };
