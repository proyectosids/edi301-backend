process.env.TZ = 'UTC';

require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');

const app = require('./app');
const { initCronJobs } = require('./services/birthday.service');
const { closeConnection } = require('./dataBase/dbConnection');

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

io.on('connection', (socket) => {
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

  socket.on('join_room', (rawRoomId) => {
    if (!allowRoomEvent()) {
      return socket.emit('room_error', {
        error: 'Demasiados eventos de sala'
      });
    }

    const roomId = String(rawRoomId ?? '').trim();

    const maxRooms = Number(
      process.env.SOCKET_MAX_ROOMS || 20
    );

    if (
      !roomId ||
      roomId.length > 100 ||
      socket.rooms.size > maxRooms
    ) {
      return socket.emit('room_error', {
        error: 'Sala inválida o límite alcanzado'
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

  socket.on('disconnect', () => {
    console.log(`Socket desconectado: ${socket.id}`);
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