
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
DB_USER=usuario
DB_PASSWORD=password
DB_SERVER=localhost
DB_DATABASE=Edi301
JWT_SECRET=tu_clave_secreta

4. Ejecutar en desarrollo
   npm run dev

5. Ejecutar en producción
   npm start

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
