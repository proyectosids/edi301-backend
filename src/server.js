process.env.TZ = 'UTC';

require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');

const app = require('./app');
const { initCronJobs } = require('./services/birthday.service');
const { sql, queryP, closeConnection } = require('./dataBase/dbConnection');
const UQ = require('./queries/usuarios.queries').Q;

const configuredOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const socketOrigin = configuredOrigins.length
  ? configuredOrigins
  : '*';

const server = http.createServer(app);

server.requestTimeout = Number(
  process.env.HTTP_REQUEST_TIMEOUT_MS || 120000
);

server.headersTimeout = Number(
  process.env.HTTP_HEADERS_TIMEOUT_MS || 30000
);

server.keepAliveTimeout = Number(
  process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 65000
);

const io = new Server(server, {
  cors: {
    origin: socketOrigin,
    methods: ['GET', 'POST']
  },

  maxHttpBufferSize: Number(
    process.env.SOCKET_MAX_BUFFER_BYTES || 100 * 1024
  ),

  pingTimeout: Number(
    process.env.SOCKET_PING_TIMEOUT_MS || 20000
  ),

  perMessageDeflate: false
});

app.set('socketio', io);

// ── Autenticación del socket ────────────────────────────────────────────────
// Sin esto cualquier cliente podía emitir join_room('sala_7') y leer en vivo
// el chat privado de otras personas. El token es el mismo session_token que
// usa authGuard para la API REST.
io.use(async (socket, next) => {
  try {
    const raw =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization ||
      socket.handshake.query?.token ||
      '';

    const value = String(raw).trim();
    const token = value.startsWith('Bearer ') ? value.slice(7).trim() : value;

    if (!token) {
      return next(new Error('unauthorized'));
    }

    const rows = await queryP(UQ.sessionByToken, {
      session_token: { type: sql.NVarChar, value: token },
    });

    if (!rows.length) {
      return next(new Error('unauthorized'));
    }

    const row = rows[0];

    if (row.usuario_activo === false || row.usuario_activo === 0) {
      return next(new Error('unauthorized'));
    }

    socket.data.user = {
      id_usuario: Number(row.id_usuario),
      nombre_rol: row.nombre_rol,
    };

    next();
  } catch (error) {
    console.error('[socket] Error autenticando:', error.message);
    next(new Error('unauthorized'));
  }
});

/**
 * ¿Este usuario puede entrar a esta sala? Se valida contra la base de datos,
 * no contra lo que diga el cliente.
 *   institucional  → cualquier usuario autenticado
 *   user_<id>      → solo uno mismo
 *   sala_<id>      → solo participantes del chat
 *   familia_<id>   → miembros de la familia, papá/mamá titulares, o un Admin
 */
async function puedeEntrarASala(user, roomId) {
  if (roomId === 'institucional') return true;

  const propio = /^user_(\d+)$/.exec(roomId);
  if (propio) {
    return Number(propio[1]) === user.id_usuario;
  }

  const sala = /^sala_(\d+)$/.exec(roomId);
  if (sala) {
    const rows = await queryP(
      `SELECT TOP 1 1 AS permitido
       FROM EDI.Chat_Participantes
       WHERE id_sala = @id_sala AND id_usuario = @id_usuario`,
      {
        id_sala: { type: sql.Int, value: Number(sala[1]) },
        id_usuario: { type: sql.Int, value: user.id_usuario },
      }
    );
    return rows.length > 0;
  }

  const familia = /^familia_(\d+)$/.exec(roomId);
  if (familia) {
    if (user.nombre_rol === 'Admin') return true;
    const rows = await queryP(
      `SELECT TOP 1 1 AS permitido
       FROM EDI.Familias_EDI f
       LEFT JOIN EDI.Miembros_Familia mf
         ON mf.id_familia = f.id_familia
        AND mf.activo = 1
        AND mf.id_usuario = @id_usuario
       WHERE f.id_familia = @id_familia
         AND f.activo = 1
         AND (mf.id_usuario IS NOT NULL
              OR f.papa_id = @id_usuario
              OR f.mama_id = @id_usuario)`,
      {
        id_familia: { type: sql.Int, value: Number(familia[1]) },
        id_usuario: { type: sql.Int, value: user.id_usuario },
      }
    );
    return rows.length > 0;
  }

  // Cualquier otro nombre de sala se rechaza.
  return false;
}

io.on('connection', (socket) => {
  const user = socket.data.user;

  // Sala propia: sirve para avisos dirigidos a esta persona (por ejemplo, el
  // badge de mensajes sin leer cuando no tiene el chat abierto).
  socket.join(`user_${user.id_usuario}`);

  let eventCount = 0;
  let windowStartedAt = Date.now();

  function allowRoomEvent() {
    const now = Date.now();

    if (now - windowStartedAt >= 60000) {
      eventCount = 0;
      windowStartedAt = now;
    }

    eventCount++;

    return (
      eventCount <=
      Number(process.env.SOCKET_ROOM_EVENTS_PER_MINUTE || 60)
    );
  }

  socket.on('join_room', async (rawRoomId) => {
    if (!allowRoomEvent()) {
      return socket.emit('room_error', {
        error: 'Demasiados eventos de sala'
      });
    }

    const roomId = String(rawRoomId ?? '').trim();

    const maxRooms = Number(
      process.env.SOCKET_MAX_ROOMS || 20
    );

    // socket.rooms siempre incluye la sala propia del socket (su id), por eso
    // se descuenta antes de comparar contra el límite.
    const salasUnidas = socket.rooms.size - 1;

    if (
      !roomId ||
      roomId.length > 100 ||
      salasUnidas >= maxRooms
    ) {
      return socket.emit('room_error', {
        error: 'Sala inválida o límite alcanzado'
      });
    }

    try {
      if (!(await puedeEntrarASala(user, roomId))) {
        console.warn(
          `[socket] Usuario ${user.id_usuario} intentó entrar a "${roomId}" sin permiso.`
        );
        return socket.emit('room_error', {
          error: 'No tienes acceso a esta sala',
          roomId
        });
      }
    } catch (error) {
      console.error('[socket] Error validando sala:', error.message);
      return socket.emit('room_error', {
        error: 'No se pudo validar la sala',
        roomId
      });
    }

    socket.join(roomId);

    socket.emit('joined_room', {
      roomId,
      socketId: socket.id
    });
  });

  socket.on('leave_room', (rawRoomId) => {
    if (!allowRoomEvent()) {
      return;
    }

    const roomId = String(rawRoomId ?? '').trim();

    if (!roomId || roomId.length > 100) {
      return;
    }

    socket.leave(roomId);

    socket.emit('left_room', {
      roomId,
      socketId: socket.id
    });
  });

  socket.on('disconnect', (reason) => {
    console.log(
      `Socket desconectado: ${socket.id} (usuario ${user.id_usuario}) — ${reason}`
    );
  });
});

const PORT = Number(process.env.PORT || 3000);

let stopCronJobs = () => { };

server.listen(PORT, () => {
  console.log(
    `Servidor con Sockets corriendo en el puerto ${PORT}`
  );

  try {
    const cronStopper = initCronJobs();

    if (typeof cronStopper === 'function') {
      stopCronJobs = cronStopper;
    }
  } catch (error) {
    console.error(
      '[cron] Error iniciando Cron Jobs:',
      error.message
    );
  }
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[shutdown] ${signal}: cerrando servicios...`
  );

  try {
    stopCronJobs();
  } catch (error) {
    console.error(
      '[shutdown] Error deteniendo Cron Jobs:',
      error.message
    );
  }

  const forceExit = setTimeout(() => {
    console.error(
      '[shutdown] Tiempo agotado; terminando proceso.'
    );

    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 25000));

  forceExit.unref();

  try {
    io.close();
  } catch (error) {
    console.error(
      '[shutdown] Error cerrando Socket.IO:',
      error.message
    );
  }

  server.close(async () => {
    try {
      await closeConnection();

      clearTimeout(forceExit);

      console.log(
        '[shutdown] Servicios cerrados correctamente.'
      );

      process.exit(0);
    } catch (error) {
      console.error(
        '[shutdown] Error cerrando pool de base de datos:',
        error.message
      );

      process.exit(1);
    }
  });
}

process.once('SIGTERM', () => {
  shutdown('SIGTERM');
});

process.once('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('uncaughtException', (error) => {
  console.error(
    '[process] uncaughtException:',
    error
  );

  shutdown('uncaughtException');
});

process.on('unhandledRejection', (error) => {
  console.error(
    '[process] unhandledRejection:',
    error
  );
});

module.exports = {
  server,
  io,
  shutdown
};