/**
 * send-broadcast.js
 * Envía una notificación push masiva a todos los usuarios activos con token FCM.
 * Uso: node send-broadcast.js
 */
require('dotenv').config();

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const { sql, queryP } = require('./src/dataBase/dbConnection');

// ── Inicializar Firebase Admin ────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('🔥 Firebase Admin inicializado');
}

// ── Contenido de la notificación ──────────────────────────────────────────────
const TITULO = '✨ Gracias por ser parte de EDI 301';
const CUERPO =
  'Agradecemos sinceramente tu apoyo durante estos días de prueba. ' +
  'Tu participación ha sido clave para mejorar la app y dar este gran paso ' +
  'hacia su lanzamiento oficial. 🙌\n' +
  'Seguimos trabajando para brindarte una mejor experiencia. ' +
  '¡Gracias por confiar en EDI 301! 🚀';

// ── Envío ──────────────────────────────────────────────────────────────────────
async function enviarNotificacionMasiva() {
  try {
    // Obtener todos los tokens activos y únicos
    const rows = await queryP(`
      SELECT DISTINCT fcm_token
      FROM EDI.Usuarios
      WHERE fcm_token IS NOT NULL
        AND LEN(fcm_token) > 10
        AND activo = 1
    `);

    if (rows.length === 0) {
      console.log('⚠️  No hay tokens FCM disponibles en la base de datos.');
      process.exit(0);
    }

    const tokens = [...new Set(rows.map(r => r.fcm_token))];
    console.log(`📲 Enviando notificación a ${tokens.length} dispositivo(s)...`);
    console.log(`   Título : ${TITULO}`);
    console.log(`   Mensaje: ${CUERPO.slice(0, 80)}...`);

    // Firebase permite máximo 500 tokens por lote
    const BATCH_SIZE = 500;
    let totalSuccess = 0;
    let totalFail    = 0;

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const message = {
        notification: { title: TITULO, body: CUERPO },
        data: {
          tipo:         'BROADCAST',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        tokens: batch,
      };

      const resp = await admin.messaging().sendEachForMulticast(message);
      totalSuccess += resp.successCount;
      totalFail    += resp.failureCount;

      const lote = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`   Lote ${lote}: ✅ ${resp.successCount} enviados, ❌ ${resp.failureCount} fallos`);

      // Limpiar tokens inválidos de este lote
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.errorInfo?.code || r.error?.code || '';
          console.log(`     Token[${idx}] falló [${code}]: ${r.error?.message}`);
        }
      });
    }

    console.log(`\n✅ Broadcast completado: ${totalSuccess} enviados, ${totalFail} fallos`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en broadcast:', err.message);
    process.exit(1);
  }
}

enviarNotificacionMasiva();
