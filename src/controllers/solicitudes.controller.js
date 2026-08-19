const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, notFound, fail } = require('../utils/http');
const { Q } = require('../queries/solicitudes.queries');
const { Q: QU } = require('../queries/usuarios.queries'); 
const { enviarNotificacionMulticast } = require('../utils/firebase');
const { insertarNotificaciones } = require('../utils/notificaciones');

exports.create = async (req, res) => {
  try {
    const { id_familia, id_usuario, tipo_solicitud } = req.body;
    

    if (!id_familia || !id_usuario || !tipo_solicitud) {
        return bad(res, 'Campos requeridos: id_familia, id_usuario, tipo_solicitud');
    }


    const rows = await queryP(Q.create, {
      id_familia:     { type: sql.Int, value: id_familia },
      id_usuario:     { type: sql.Int, value: id_usuario },
      tipo_solicitud: { type: sql.NVarChar, value: tipo_solicitud }
    });

    const nuevaSolicitud = rows[0];

    if (nuevaSolicitud) {
        try {
            const padres = await queryP(QU.getTokensPadresPorFamilia, {
              id_familia: { type: sql.Int, value: id_familia },
            });

            console.log(`👨‍👩‍👧 Se encontraron ${padres.length} padres para notificar.`);

            await insertarNotificaciones(
              padres.map(padre => padre.id_usuario),
              'Nueva Solicitud',
              'Un miembro de tu familia solicita aprobación.',
              'SOLICITUD',
              nuevaSolicitud.id_solicitud
            );
            await enviarNotificacionMulticast(
              padres.map(padre => padre.session_token),
              'Nueva Solicitud Familiar 📩',
              'Tu hijo ha enviado una solicitud pendiente de aprobación.',
              {
                tipo: 'SOLICITUD',
                id_solicitud: nuevaSolicitud.id_solicitud ? nuevaSolicitud.id_solicitud.toString() : '0'
              }
            );
        } catch (notifError) {
            console.error("Error enviando notificaciones (La solicitud sí se creó):", notifError);
        }
    }
    // ✅ Tiempo real
    req.io?.to(`familia_${id_familia}`).emit('solicitud_creada', nuevaSolicitud);

    created(res, nuevaSolicitud);

  } catch (e) { fail(res, e); }
};

exports.listByFamilia = async (req, res) => {
  try {
    ok(res, await queryP(Q.listByFamilia, { id_familia: { type: sql.Int, value: Number(req.params.id_familia) } }));
  } catch (e) { fail(res, e); }
};

exports.setEstado = async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['Pendiente','Aceptada','Rechazada'].includes(estado)) return bad(res, 'estado inválido');
    const rows = await queryP(Q.setEstado, {
      estado:       { type: sql.NVarChar, value: estado },
      id_solicitud: { type: sql.Int, value: Number(req.params.id) }
    });
    if (!rows.length) return notFound(res);
    // ✅ Tiempo real
    req.io?.to(`familia_${rows[0].id_familia}`).emit('solicitud_estado_actualizado', rows[0]);

    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
};
