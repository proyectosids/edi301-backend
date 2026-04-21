// src/server.js
// ── Forzar UTC en todo el proceso Node.js ──────────────────────────────────
// Esto asegura que mssql interprete las fechas de SQL Server como UTC,
// y que Date.toISOString() / res.json() serialice correctamente en producción.
process.env.TZ = 'UTC';

require('dotenv').config();
const app = require('./app');
const http = require('http');
const { Server } = require('socket.io');
const { initCronJobs } = require('./services/birthday.service');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});


app.set('socketio', io);

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);


  socket.on('join_room', (roomId) => {
  socket.join(roomId);
  console.log(`[join_room] socket=${socket.id} room=${roomId}`);

  // ✅ ACK al cliente (para que sepamos que sí se unió)
  socket.emit('joined_room', { roomId, socketId: socket.id });
});

  socket.on('leave_room', (roomId) => {
  socket.leave(roomId);
  console.log(`[leave_room] socket=${socket.id} room=${roomId}`);
  socket.emit('left_room', { roomId, socketId: socket.id });
});

  socket.on('disconnect', () => {
    console.log('Usuario desconectado');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor con Sockets corriendo en el puerto ${PORT}`);
  initCronJobs();
});