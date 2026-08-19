
# 📘 EDI 301 - Sistema de Gestión Institucional

Sistema backend desarrollado en **Node.js + Express + SQL Server** para la gestión integral del programa **EDI 301**.  
Permite administrar usuarios, familias, miembros, publicaciones, agenda, provisiones, mensajería y más, mediante una API REST estructurada y segura.

---

# 🚀 Tecnologías utilizadas

- Node.js
- Express.js
- SQL Server
- JWT (Autenticación basada en tokens)
- bcrypt (Encriptación de contraseñas)
- dotenv (Variables de entorno)
- CORS
- Morgan (Logs de peticiones)
- Nodemon (Desarrollo)

---

# 🏗️ Estructura del Proyecto

El proyecto se organiza por capas para mantener separación de responsabilidades:

config/         → Configuración general (DB, variables de entorno)
controllers/    → Lógica de controladores
routes/         → Definición de endpoints
middlewares/    → Autenticación y validaciones
models/         → Acceso a base de datos
services/       → Lógica de negocio
utils/          → Funciones auxiliares

---

# 📡 Endpoints Principales

La API expone las siguientes rutas base:

/api/usuarios
/api/familias
/api/miembros
/api/auth
/api/publicaciones
/api/fotos
/api/agenda
/api/search
/api/roles
/api/estados
/api/solicitudes
/api/provisiones
/api/det-provisiones
/api/mensajes

---

# 🔐 Autenticación

El sistema utiliza autenticación basada en JWT.

Flujo:
1. POST /api/auth/login
2. El servidor responde con un token JWT.
3. En cada petición protegida enviar:
   Authorization: Bearer <token>

---

# ⚙️ Instalación del Proyecto

1. Clonar repositorio
   git clone https://github.com/usuario/edi301.git
   cd edi301

2. Instalar dependencias
   npm install

3. Configurar variables de entorno (.env)

PORT=3000
DBUSER=usuario
DBPASSWORD=password
DBSERVER=localhost
DATABASE=Edi301
DBPORT=1433
JWT_SECRET=tu_clave_secreta

# Ajustes opcionales de producción
DB_POOL_MAX=10
DB_POOL_MIN=0
DB_POOL_IDLE_MS=60000
DB_POOL_ACQUIRE_MS=15000
DB_CONNECTION_TIMEOUT_MS=10000
DB_REQUEST_TIMEOUT_MS=30000
API_RATE_LIMIT=1000
AUTH_RATE_LIMIT=30
SEARCH_RATE_LIMIT=60
IMAGE_CONCURRENCY=2
TRUST_PROXY_HOPS=1
CORS_ORIGINS=https://app.ejemplo.com

4. Ejecutar en desarrollo
   npm run dev

5. Ejecutar en producción
npm start

## Migraciones

Aplicar los scripts de `migrations/` en orden numérico. Antes de desplegar esta
versión es obligatorio ejecutar:

```text
migrations/005_performance_and_reliability.sql
```

La migración es idempotente y no elimina datos. La creación de índices debe
realizarse primero en staging y fuera de hora pico en producción. Si encuentra
likes o participantes duplicados, emite una advertencia y omite solamente el
índice único correspondiente.

La API expone `GET /health` para liveness y `GET /ready` para comprobar SQL
Server. En CapRover configura el health check con `/health`.

---

# 📦 Scripts disponibles

npm run dev     → Ejecuta con nodemon
npm start       → Ejecuta servidor en modo producción

---

# 🛡️ Buenas Prácticas

- Autenticación con JWT
- Encriptación segura con bcrypt
- Manejo centralizado de errores
- Separación de responsabilidades
- Control de acceso por roles
- Variables sensibles protegidas en .env

---

# 👨‍💻 Proyecto

Sistema institucional EDI 301.
