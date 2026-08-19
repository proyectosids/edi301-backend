require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const path = require('path'); 
const { monitorEventLoopDelay } = require('perf_hooks');
const fileUpload = require('express-fileupload'); 
const routes = require('./routes/index.routes');
const { checkConnection } = require('./dataBase/dbConnection');
const { apiLimiter } = require('./middleware/rateLimits');

const app = express();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
if (process.env.TRUST_PROXY_HOPS) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
}

// Middlewares
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: false, limit: process.env.FORM_BODY_LIMIT || '1mb' }));
const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length
    ? (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin))
    : true,
}));
app.use(fileUpload({
  createParentPath: true,
  useTempFiles: true,
  tempFileDir: process.env.UPLOAD_TEMP_DIR || '/tmp/',
  limits: { fileSize: 5 * 1024 * 1024 }, 
  abortOnLimit: true
}));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const slowMs = Number(process.env.SLOW_REQUEST_MS || 1000);
    if (elapsedMs >= slowMs) {
      const pathOnly = String(req.originalUrl || req.url).split('?')[0];
      console.warn(`[slow-request] ${req.method} ${pathOnly} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`);
    }
  });
  next();
});

// Antes de las rutas
app.use((req, res, next) => {
  req.io = app.get('socketio');
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  uptime_seconds: Math.round(process.uptime()),
  event_loop_delay_ms: Number.isFinite(eventLoopDelay.mean)
    ? Number((eventLoopDelay.mean / 1e6).toFixed(2))
    : 0,
}));
app.get('/ready', async (_req, res) => {
  try {
    await checkConnection();
    res.json({ status: 'ready' });
  } catch (_error) {
    res.status(503).json({ status: 'not_ready' });
  }
});
app.use('/api', apiLimiter);
app.use('/api', routes);
app.get('/', (_req, res) => {
  res.json({
    message: 'Bienvenido a la API de EDI 301',
    rutas: [
      '/api/usuarios',
      '/api/familias',
      '/api/miembros',
      '/api/auth',
      '/api/publicaciones',
      '/api/fotos',
      '/api/agenda',
      '/api/search',
      '/api/roles',
      '/api/estados',
      '/api/solicitudes',
      '/api/provisiones',
      '/api/det-provisiones',
      '/api/mensajes'
    ]
  });
});

module.exports = app;

//hola
