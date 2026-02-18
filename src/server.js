// src/server.js
require('dotenv').config(); 
const app = require('./app');
const http = require('http');
const { Server } = require('socket.io');

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
    console.log(`Socket ${socket.id} se unió a la sala: ${roomId}`);
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor con Sockets corriendo en el puerto ${PORT}`);
});