const cron = require('node-cron');
const { sql, queryP } = require('../dataBase/dbConnection');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const ID_AUTOR_SISTEMA = 1; 
const IMAGEN_CUMPLEANOS = '/uploads/image.png'; 
const verificarCumpleanos = async () => {
  console.log('🎂 Iniciando verificación diaria de cumpleaños...');

  try {
    const cumpleaneros = await queryP(`
      SELECT 
        u.id_usuario,
        u.nombre,
        u.apellido,
        mf.id_familia
      FROM EDI.Usuarios u
      LEFT JOIN EDI.Miembros_Familia mf
        ON mf.id_usuario = u.id_usuario
       AND mf.activo = 1
      WHERE DAY(u.fecha_nacimiento) = DAY(GETDATE())
        AND MONTH(u.fecha_nacimiento) = MONTH(GETDATE())
        AND u.activo = 1
    `);

    if (cumpleaneros.length === 0) {
      console.log('🎂 Hoy no hay cumpleaños.');
      return;
    }

    for (const user of cumpleaneros) {
      const nombreCompleto = `${user.nombre} ${user.apellido || ''}`.trim();

      const yaPublicado = await queryP(`
        SELECT id_post
        FROM EDI.Publicaciones
        WHERE CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)
          AND tipo = 'CUMPLEAÑOS'
          AND mensaje LIKE @patronNombre
      `, {
        patronNombre: { type: sql.NVarChar, value: `%${nombreCompleto}%` }
      });

      if (yaPublicado.length > 0) continue;

      const titulo = `¡Feliz cumpleaños ${nombreCompleto}! 🎂🎉🎊`;
      const mensaje = "El departamento de capellanía te desea lo mejor hoy en este día tan especial. ¡Que Dios te bendiga grandemente!";

      const postResult = await queryP(`
        INSERT INTO EDI.Publicaciones
          (id_usuario, categoria_post, mensaje, url_imagen, tipo, estado, created_at, activo)
        OUTPUT INSERTED.id_post
        VALUES
          (@idUser, 'Institucional', @msg, @img, 'CUMPLEAÑOS', 'Aprobada', SYSDATETIME(), 1)
      `, {
        idUser: { type: sql.Int, value: ID_AUTOR_SISTEMA },
        msg: { type: sql.NVarChar, value: `${titulo}\n\n${mensaje}` },
        img: { type: sql.NVarChar, value: IMAGEN_CUMPLEANOS }
      });

      const idPost = postResult[0].id_post;
      console.log(`✅ Publicación creada para ${nombreCompleto} (ID: ${idPost})`);

      if (user.id_familia) {
        const familiares = await queryP(`
          SELECT u.fcm_token
          FROM EDI.Usuarios u
          INNER JOIN EDI.Miembros_Familia mf
            ON mf.id_usuario = u.id_usuario
           AND mf.activo = 1
          WHERE mf.id_familia = @idFam
            AND u.activo = 1
            AND u.fcm_token IS NOT NULL
            AND LEN(u.fcm_token) > 10
        `, {
          idFam: { type: sql.Int, value: user.id_familia }
        });

        const tokens = familiares.map(f => f.fcm_token);

        if (tokens.length > 0) {
          await enviarNotificacionMulticast(
            tokens,
            '🎉 ¡Cumpleaños en la familia!',
            `Hoy es el cumpleaños de ${user.nombre}. ¡Entra a felicitarlo!`,
            { tipo: 'POST_DETALLE', id_referencia: idPost.toString() }
          );
        }
      }
    }

  } catch (error) {
    console.error('Error en servicio cumpleaños:', error);
  }
};



// =========================
//  Recordatorio diario de oración (12:00 pm)
// =========================
const ORACION_FRASES = [
  "Toma un momento para orar con Dios. 🙏",
  "Haz una pausa, respira y habla con Dios. 🙏",
  "Un minuto con Dios puede cambiar tu día. 🙏",
  "Detén un instante tus actividades y ora. 🙏",
  "Que este mediodía sea un recordatorio: Dios está contigo. 🙏",
  "Antes de seguir, entrega tu día a Dios en oración. 🙏",
];

function _fraseOracionDelDia() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor((now - start) / oneDay);
  return ORACION_FRASES[dayOfYear % ORACION_FRASES.length];
}

function _chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const enviarRecordatorioOracion = async () => {
  try {
    const frase = _fraseOracionDelDia();

    const rows = await queryP(`
      SELECT fcm_token
      FROM EDI.Usuarios
      WHERE activo = 1
        AND fcm_token IS NOT NULL
        AND LEN(fcm_token) > 10
    `);

    const tokens = (rows || []).map(r => r.fcm_token).filter(Boolean);

    if (tokens.length === 0) {
      console.log('🙏 No hay tokens FCM para recordatorio de oración.');
      return;
    }

    const title = '🕛 Momento de oración';
    const body = frase;

    // FCM permite hasta 500 tokens por multicast
    const batches = _chunk(tokens, 450);

    for (const batch of batches) {
      await enviarNotificacionMulticast(batch, title, body, {
        tipo: 'ORACION_NOON',
      });
    }

    console.log(`🙏 Recordatorio de oración enviado a ${tokens.length} dispositivos.`);
  } catch (error) {
    console.error('Error en recordatorio de oración:', error);
  }
};

const initCronJobs = () => {
  cron.schedule('* 8 * * *', () => {
    verificarCumpleanos();
  }, { timezone: "America/Mexico_City" });

  cron.schedule('0 12 * * *', () => {
    enviarRecordatorioOracion();
  }, { timezone: "America/Mexico_City" });

  console.log('Cron Jobs iniciados.');
};

module.exports = { initCronJobs };