const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, fail } = require('../utils/http');
const { Q } = require('../queries/chat.queries');
const { enviarNotificacionMulticast } = require('../utils/firebase'); // ✅ Importamos la utilidad

// INICIAR CHAT PRIVADO
exports.initPrivateChat = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const { targetUserId } = req.body;

        if (!targetUserId) return bad(res, 'Falta el ID del usuario destino');

        const existing = await queryP(Q.findPrivateChat, {
            my_id: { type: sql.Int, value: myId },
            other_id: { type: sql.Int, value: targetUserId }
        });

        if (existing.length > 0) {
            return ok(res, { id_sala: existing[0].id_sala, created: false });
        }

        const salaResult = await queryP(Q.createSala, {
            nombre: { type: sql.NVarChar, value: null },
            tipo: { type: sql.NVarChar, value: 'PRIVADO' }
        });
        const idSala = salaResult[0].id_sala;

        await queryP(Q.addParticipante, { id_sala: {type: sql.Int, value: idSala}, id_usuario: {type: sql.Int, value: myId}, es_admin: {type: sql.Bit, value: 1} });
        await queryP(Q.addParticipante, { id_sala: {type: sql.Int, value: idSala}, id_usuario: {type: sql.Int, value: targetUserId}, es_admin: {type: sql.Bit, value: 0} });

        created(res, { id_sala: idSala, created: true });
    } catch (e) { fail(res, e); }
};

// CREAR GRUPO
exports.createGroup = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const { nombre_grupo, ids_usuarios } = req.body;

        if (!nombre_grupo || !ids_usuarios) return bad(res, 'Datos incompletos');

        const salaResult = await queryP(Q.createSala, {
            nombre: { type: sql.NVarChar, value: nombre_grupo },
            tipo: { type: sql.NVarChar, value: 'GRUPAL' }
        });
        const idSala = salaResult[0].id_sala;

        await queryP(Q.addParticipante, { id_sala: {type: sql.Int, value: idSala}, id_usuario: {type: sql.Int, value: myId}, es_admin: {type: sql.Bit, value: 1} });

        for (const userId of ids_usuarios) {
             await queryP(Q.addParticipante, { id_sala: {type: sql.Int, value: idSala}, id_usuario: {type: sql.Int, value: userId}, es_admin: {type: sql.Bit, value: 0} });
        }

        created(res, { id_sala: idSala, message: 'Grupo creado' });
    } catch (e) { fail(res, e); }
};

// ENVIAR MENSAJE
exports.sendMessage = async (req, res) => {
    try {
        const io = req.io;
        const myId = req.user.id_usuario ?? req.user.id;
        const myName = req.user.nombre || "Alguien"; 

        const { id_sala, mensaje } = req.body;

        const rows = await queryP(Q.sendMessage, {
            id_sala: { type: sql.Int, value: id_sala },
            id_usuario: { type: sql.Int, value: myId },
            mensaje: { type: sql.NVarChar, value: mensaje },
            tipo_mensaje: { type: sql.NVarChar, value: 'TEXTO' }
        });

        const nuevoMensaje = rows?.[0];

        // ✅ Tiempo real: emitir a la sala del chat
        if (io && nuevoMensaje) {
            io.to(`sala_${id_sala}`).emit('nuevo_mensaje', nuevoMensaje);
        }

        ok(res, { message: 'Enviado' });

        // Notificar en segundo plano
        _sendPushToRoom(id_sala, myId, myName, mensaje);

    } catch (e) { fail(res, e); }
};


async function _sendPushToRoom(idSala, senderId, senderName, messageText) {
    try {
        // Buscar tokens de todos los participantes excepto el emisor
        const queryTokens = `
            SELECT u.id_usuario, u.fcm_token
            FROM EDI.Chat_Participantes cp
            JOIN EDI.Usuarios u ON u.id_usuario = cp.id_usuario
            WHERE cp.id_sala = @idSala
              AND cp.id_usuario != @senderId
              AND u.fcm_token IS NOT NULL
              AND LEN(u.fcm_token) > 10
        `;

        const rows = await queryP(queryTokens, {
            idSala: { type: sql.Int, value: idSala },
            senderId: { type: sql.Int, value: senderId }
        });

        console.log(`📲 Push sala=${idSala}: ${rows.length} destinatario(s) con token`);

        if (rows.length === 0) {
            // Diagnóstico extra: verificar si hay participantes sin token
            const queryAll = `
                SELECT u.id_usuario,
                       CASE WHEN u.fcm_token IS NULL THEN 'SIN_TOKEN' ELSE 'CON_TOKEN' END as estado_token
                FROM EDI.Chat_Participantes cp
                JOIN EDI.Usuarios u ON u.id_usuario = cp.id_usuario
                WHERE cp.id_sala = @idSala AND cp.id_usuario != @senderId
            `;
            const allRows = await queryP(queryAll, {
                idSala: { type: sql.Int, value: idSala },
                senderId: { type: sql.Int, value: senderId }
            });
            console.log(`⚠️ Participantes restantes en sala ${idSala}:`, allRows);
            return;
        }

        const tokens = rows.map(r => r.fcm_token);

        await enviarNotificacionMulticast(
            tokens,
            senderName,
            messageText,
            {
                tipo: "CHAT_MESSAGE",
                id_sala: String(idSala),
                click_action: "FLUTTER_NOTIFICATION_CLICK"
            }
        );

    } catch (error) {
        console.error("❌ Error enviando Push de chat:", error);
    }
}

// LISTAR MIS CHATS
exports.getMyChats = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const rows = await queryP(Q.getMyChats, { id_usuario: { type: sql.Int, value: myId } });
        ok(res, rows);
    } catch (e) { fail(res, e); }
};

// VER MENSAJES DE UNA SALA
exports.getMessages = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const idSala = req.params.id_sala;
        
        const rows = await queryP(Q.getMensajes, { 
            id_sala: { type: sql.Int, value: idSala },
            id_usuario: { type: sql.Int, value: myId } 
        });
        ok(res, rows);
    } catch (e) { fail(res, e); }
};