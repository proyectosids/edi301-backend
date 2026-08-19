const cron = require('node-cron');
const { sql, queryP, pool } = require('../dataBase/dbConnection');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const {
  insertarNotificaciones,
  insertarNotificacionesUsuariosActivos,
} = require('../utils/notificaciones');
const ID_AUTOR_SISTEMA = 1; 
let IMAGEN_CUMPLEANOS = '/uploads/image.png';
const getImagenCumpleanos = () => IMAGEN_CUMPLEANOS;
const setImagenCumpleanos = (url) => { IMAGEN_CUMPLEANOS = url; };
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
        // Multi-dispositivo: una fila por sesión activa de cada miembro.
        const familiares = await queryP(`
          SELECT s.fcm_token
          FROM EDI.Usuario_Sesiones s
          INNER JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
          INNER JOIN EDI.Miembros_Familia mf
            ON mf.id_usuario = u.id_usuario
           AND mf.activo = 1
          WHERE mf.id_familia = @idFam
            AND u.activo = 1
            AND s.activo = 1
            AND s.fcm_token IS NOT NULL
            AND LEN(s.fcm_token) > 10
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

        // Insertar notificación CUMPLEANOS en historial para cada familiar
        const familiaresTodos = await queryP(`
          SELECT u.id_usuario
          FROM EDI.Usuarios u
          INNER JOIN EDI.Miembros_Familia mf ON mf.id_usuario = u.id_usuario AND mf.activo = 1
          WHERE mf.id_familia = @idFam AND u.activo = 1
        `, { idFam: { type: sql.Int, value: user.id_familia } });

        await insertarNotificaciones(
          familiaresTodos.map(f => f.id_usuario),
          '🎉 ¡Cumpleaños en la familia!',
          `Hoy es el cumpleaños de ${nombreCompleto}. ¡Entra a felicitarlo!`,
          'CUMPLEANOS',
          idPost
        );
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

    // Multi-dispositivo: una fila por sesión activa de cada usuario.
    const rows = await queryP(`
      SELECT s.fcm_token
      FROM EDI.Usuario_Sesiones s
      JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
      WHERE u.activo = 1
        AND s.activo = 1
        AND s.fcm_token IS NOT NULL
        AND LEN(s.fcm_token) > 10
    `);

    const tokens = (rows || []).map(r => r.fcm_token).filter(Boolean);

    if (tokens.length === 0) {
      console.log('🙏 No hay tokens FCM para recordatorio de oración.');
      return;
    }

    const title = '🕛 Momento de oración';
    const body = frase;

    // FCM permite hasta 500 tokens por multicast
    await enviarNotificacionMulticast(tokens, title, body, { tipo: 'ORACION_NOON' });

    console.log(`🙏 Recordatorio de oración enviado a ${tokens.length} dispositivos.`);

    // Insertar notificación ORACION en historial para todos los usuarios activos
    await insertarNotificacionesUsuariosActivos(
      '🕛 Momento de oración',
      frase,
      'ORACION',
      null
    );
  } catch (error) {
    console.error('Error en recordatorio de oración:', error);
  }
};

async function withDistributedJobLock(resource, work) {
  const transaction = new sql.Transaction(pool);
  let started = false;
  let claimed = false;
  try {
    await transaction.begin();
    started = true;
    const request = new sql.Request(transaction);
    request.input('resource', sql.NVarChar, resource);
    const lock = await request.query(`
      DECLARE @result INT;
      EXEC @result = sys.sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 0;
      SELECT @result AS lock_result;
    `);
    if (Number(lock.recordset[0]?.lock_result) < 0) {
      await transaction.rollback();
      return false;
    }
    const claimRequest = new sql.Request(transaction);
    claimRequest.input('resource', sql.NVarChar, resource);
    const claim = await claimRequest.query(`
      IF EXISTS (SELECT 1 FROM EDI.Job_Ejecuciones WHERE clave_job = @resource)
        SELECT CAST(0 AS BIT) AS claimed;
      ELSE
      BEGIN
        INSERT INTO EDI.Job_Ejecuciones (clave_job) VALUES (@resource);
        SELECT CAST(1 AS BIT) AS claimed;
      END;
    `);
    claimed = Boolean(claim.recordset[0]?.claimed);
    if (!claimed) {
      await transaction.rollback();
      return false;
    }
    await transaction.commit();
    started = false;
    await work();
    return true;
  } catch (error) {
    if (started) {
      try { await transaction.rollback(); } catch (_) {}
    }
    if (claimed && !started) {
      try {
        await queryP('DELETE FROM EDI.Job_Ejecuciones WHERE clave_job = @resource', {
          resource: { type: sql.NVarChar, value: resource },
        });
      } catch (_) {}
    }
    throw error;
  }
}

function dailyJobKey(name) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return `edi301:cron:${name}:${day}`;
}

const initCronJobs = () => {
  const jobs = [];
  jobs.push(cron.schedule('0 8 * * *', async () => {
    try {
      await withDistributedJobLock(dailyJobKey('cumpleanos'), verificarCumpleanos);
    } catch (error) {
      console.error('Error ejecutando cron de cumpleaños:', error);
    }
  }, { timezone: "America/Mexico_City" }));

  jobs.push(cron.schedule('0 12 * * *', async () => {
    try {
      await withDistributedJobLock(dailyJobKey('oracion'), enviarRecordatorioOracion);
    } catch (error) {
      console.error('Error ejecutando cron de oración:', error);
    }
  }, { timezone: "America/Mexico_City" }));

  console.log('Cron Jobs iniciados.');
  return () => jobs.forEach(job => job.stop());
};

module.exports = { initCronJobs, getImagenCumpleanos, setImagenCumpleanos };
