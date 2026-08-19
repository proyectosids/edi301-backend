const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, fail } = require('../utils/http');
const { Q } = require('../queries/chat.queries');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const { insertarNotificaciones } = require('../utils/notificaciones');

// INICIAR CHAT PRIVADO
exports.initPrivateChat = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const { targetUserId } = req.body;

        if (!targetUserId) return bad(res, 'Falta el ID del usuario destino');
        if (Number(targetUserId) === Number(myId)) return bad(res, 'No puedes crear un chat privado contigo mismo');

        const result = await queryP(Q.initPrivateChat, {
            my_id: { type: sql.Int, value: myId },
            other_id: { type: sql.Int, value: targetUserId }
        });
        const payload = { id_sala: result[0].id_sala, created: Boolean(result[0].created) };
        return payload.created ? created(res, payload) : ok(res, payload);
    } catch (e) { fail(res, e); }
};

// CREAR GRUPO
exports.createGroup = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const { nombre_grupo, ids_usuarios } = req.body;

        if (!nombre_grupo || !Array.isArray(ids_usuarios)) return bad(res, 'Datos incompletos');
        const memberIds = [...new Set(ids_usuarios.map(Number))]
            .filter(id => Number.isInteger(id) && id > 0 && id !== Number(myId));
        if (memberIds.length > 100) return bad(res, 'Un grupo admite como máximo 100 integrantes');

        const params = {
            nombre: { type: sql.NVarChar, value: nombre_grupo },
            my_id: { type: sql.Int, value: myId },
        };
        const values = memberIds.map((id, index) => {
            params[`member_${index}`] = { type: sql.Int, value: id };
            return `(@id_sala, @member_${index}, 0)`;
        });
        const result = await queryP(`
            SET XACT_ABORT ON;
            BEGIN TRANSACTION;
            INSERT INTO EDI.Chat_Salas (nombre, tipo) VALUES (@nombre, 'GRUPAL');
            DECLARE @id_sala INT = SCOPE_IDENTITY();
            INSERT INTO EDI.Chat_Participantes (id_sala, id_usuario, es_admin)
            VALUES (@id_sala, @my_id, 1)${values.length ? `,${values.join(',')}` : ''};
            COMMIT TRANSACTION;
            SELECT @id_sala AS id_sala;
        `, params);

        created(res, { id_sala: result[0].id_sala, message: 'Grupo creado' });
    } catch (e) { fail(res, e); }
};

// ENVIAR MENSAJE
exports.sendMessage = async (req, res) => {
    try {
        const io = req.io;
        const myId = req.user.id_usuario ?? req.user.id;
        const myName = req.user.nombre || "Alguien"; 

        const { id_sala, mensaje } = req.body;
        if (!id_sala || typeof mensaje !== 'string' || !mensaje.trim()) {
            return bad(res, 'Sala y mensaje son requeridos');
        }

        const rows = await queryP(Q.sendMessage, {
            id_sala: { type: sql.Int, value: id_sala },
            id_usuario: { type: sql.Int, value: myId },
            mensaje: { type: sql.NVarChar, value: mensaje },
            tipo_mensaje: { type: sql.NVarChar, value: 'TEXTO' }
        });

        const nuevoMensaje = rows?.[0];
        if (!nuevoMensaje) return res.status(403).json({ error: 'No perteneces a esta sala' });

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
            SELECT u.id_usuario, ses.fcm_token
            FROM EDI.Chat_Participantes cp
            JOIN EDI.Usuarios u ON u.id_usuario = cp.id_usuario
            JOIN EDI.Usuario_Sesiones ses ON ses.id_usuario = u.id_usuario
            WHERE cp.id_sala = @idSala
              AND cp.id_usuario != @senderId
              AND u.activo = 1 AND ses.activo = 1
              AND ses.fcm_token IS NOT NULL
              AND LEN(ses.fcm_token) > 10
        `;

        const rows = await queryP(queryTokens, {
            idSala: { type: sql.Int, value: idSala },
            senderId: { type: sql.Int, value: senderId }
        });

        console.log(`📲 Push sala=${idSala}: ${rows.length} destinatario(s) con token`);

        // Insertar notificación MENSAJE en historial para cada destinatario
        // (independiente de si tienen token o no)
        const queryAllRecipients = `
            SELECT u.id_usuario, u.fcm_token
            FROM EDI.Chat_Participantes cp
            JOIN EDI.Usuarios u ON u.id_usuario = cp.id_usuario
            WHERE cp.id_sala = @idSala AND cp.id_usuario != @senderId
        `;
        const allRecipients = await queryP(queryAllRecipients, {
            idSala: { type: sql.Int, value: idSala },
            senderId: { type: sql.Int, value: senderId }
        });

        await insertarNotificaciones(
            allRecipients.map(r => r.id_usuario),
            senderName,
            messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText,
            'MENSAJE',
            idSala
        );

        if (rows.length === 0) {
            console.log(`⚠️ Sala ${idSala}: sin participantes con token FCM.`);
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

// TOTAL DE MENSAJES NO LEÍDOS (para el badge del menú)
exports.totalUnread = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const rows = await queryP(Q.totalUnread, { id_usuario: { type: sql.Int, value: myId } });
        ok(res, { total: rows[0]?.total ?? 0 });
    } catch (e) { fail(res, e); }
};

// MARCAR SALA COMO LEÍDA
exports.markRead = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const idSala = Number(req.params.id_sala);
        await queryP(Q.markRead, {
            id_sala:    { type: sql.Int, value: idSala },
            id_usuario: { type: sql.Int, value: myId },
        });
        ok(res, { ok: true });
    } catch (e) { fail(res, e); }
};

// VER MENSAJES DE UNA SALA
exports.getMessages = async (req, res) => {
    try {
        const myId = req.user.id_usuario ?? req.user.id;
        const idSala = req.params.id_sala;
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
        const beforeId = Number.parseInt(req.query.before_id, 10);

        const rows = await queryP(Q.getMensajes, {
            id_sala: { type: sql.Int, value: idSala },
            id_usuario: { type: sql.Int, value: myId },
            limit: { type: sql.Int, value: limit },
            before_id: { type: sql.Int, value: Number.isInteger(beforeId) ? beforeId : null }
        });
        ok(res, rows);
    } catch (e) { fail(res, e); }
};
