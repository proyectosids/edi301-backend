const { sql, queryP } = require("../dataBase/dbConnection");
const { ok, created, bad, fail } = require("../utils/http");
const { Q } = require("../queries/mensajes.queries");
const { enviarNotificacionPush } = require("../utils/firebase"); 


exports.create = async (req, res) => {
  try {
    const { id_familia, mensaje } = req.body;
    
    // 1. Validaciones
    if (req.user.nombre_estado === "Baja Temporal") {
      return bad(res, "No tienes permiso para escribir mensajes (Baja Temporal).");
    }

    const id_usuario = req.user.id_usuario ?? req.user.id ?? req.user.userId;

    if (!id_familia || !mensaje) {
      return bad(res, "Faltan datos: id_familia o mensaje");
    }

    // 2. Inserción en Base de Datos
    const result = await queryP(Q.create, {
      id_familia: { type: sql.Int, value: id_familia },
      id_usuario: { type: sql.Int, value: id_usuario },
      mensaje: { type: sql.NVarChar, value: mensaje },
    });

    const nuevoMensaje = result[0];

    // 3. EMISIÓN EN TIEMPO REAL (Socket.io)
    const io = req.app.get('socketio');
    if (io) {
      // Emitimos a la sala de la familia
      io.to(id_familia.toString()).emit('nuevo_mensaje', nuevoMensaje);
    }

    // 4. Notificación Push (Segundo plano)
    _notificarFamilia(id_familia, id_usuario, mensaje);

    // 5. RESPUESTA ÚNICA AL CLIENTE
    // Usamos tu utilidad 'created' que ya maneja el status 201 y el JSON
    return created(res, nuevoMensaje);

  } catch (e) {
    return fail(res, e);
  }
};

exports.listByFamilia = async (req, res) => {
  try {
    const rows = await queryP(Q.listByFamilia, {
      id_familia: { type: sql.Int, value: req.params.id_familia },
    });
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
};

async function _notificarFamilia(idFamilia, idSender, textoMensaje) {
  try {
    const senderInfo = await queryP(
      `SELECT nombre FROM EDI.Usuarios WHERE id_usuario = @id`,
      { id: { type: sql.Int, value: idSender } }
    );
    const nombreSender = senderInfo[0]?.nombre || "Alguien";

    const tokensRows = await queryP(Q.getFamilyTokens, {
      id_familia: { type: sql.Int, value: idFamilia },
      id_sender: { type: sql.Int, value: idSender },
    });

    for (const row of tokensRows) {
      if (row.fcm_token) {
        await enviarNotificacionPush(
          row.fcm_token,
          `Nuevo mensaje de ${nombreSender} 💬`,
          textoMensaje,
          {
            tipo: "CHAT", 
            id_familia: idFamilia.toString(),
            id_referencia: idFamilia.toString(), 
          }
        );
      }
    }
  } catch (e) {
    console.error("Error notificando chat:", e);
  }
}
