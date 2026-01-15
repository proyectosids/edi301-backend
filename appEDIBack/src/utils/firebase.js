const admin = require("firebase-admin");
const serviceAccount = require("../../../serviceAccountKey.json");  

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin inicializado correctamente.");
  }
} catch (error) {
  console.error("Error inicializando Firebase:", error);
}


const enviarNotificacionPush = async (tokenDispositivo, titulo, cuerpo, data) => {
  if (!tokenDispositivo) return;
  
  try {
    await admin.messaging().send({
      token: tokenDispositivo,
      notification: {
        title: titulo,
        body: cuerpo,
      },
      data: {
        tipo: data.tipo || 'GENERAL',
        id_referencia: data.id ? data.id.toString() : '0',
        click_action: 'FLUTTER_NOTIFICATION_CLICK' 
      }, 
    });

  } catch (error) {
    console.error("Error Push Individual:", error);
  }
};

const enviarNotificacionMulticast = async (tokens, titulo, cuerpo, data) => {
  if (!tokens || tokens.length === 0) return;
  
  try {
    const message = {
      notification: { title: titulo, body: cuerpo },
      data: {
        tipo: data.tipo || 'GENERAL',
        id_sala: data.id_sala ? data.id_sala.toString() : '0',
        click_action: 'FLUTTER_NOTIFICATION_CLICK' 
      },
      tokens: tokens, 
    };


    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`📡 Push Grupal enviado: ${response.successCount} éxitos, ${response.failureCount} fallos.`);
    
  } catch (error) {
    console.error("Error Push Multicast:", error);
  }
};

module.exports = { enviarNotificacionPush, enviarNotificacionMulticast };