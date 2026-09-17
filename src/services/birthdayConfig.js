// Configuración de las felicitaciones de cumpleaños.
//
// Esto existía antes como `let IMAGEN_CUMPLEANOS = '/uploads/image.png'`
// dentro de birthday.service.js: una variable de módulo. La imagen sí se
// subía bien a Cloudinary y seguía ahí, pero la URL vivía en la memoria del
// proceso, así que cualquier reinicio o redeploy la perdía y el cron volvía a
// publicar con la ruta por defecto, que no existe. De ahí el
// "Imagen no disponible" y la sensación de que la imagen se quitaba sola.
//
// Ahora el estado vive en EDI.App_Config (migración 008). La caché de abajo
// es solo para no consultar la base en cada lectura; se invalida al guardar,
// y el TTL cubre el caso de que alguien edite la tabla a mano.

const { sql, queryP } = require('../dataBase/dbConnection');

const KEY_IMAGEN = 'cumpleanos_imagen_url';
const KEY_TITULO = 'cumpleanos_titulo';
const KEY_MENSAJE = 'cumpleanos_mensaje';

// EDI.Publicaciones.mensaje es NVARCHAR(500) y el cron guarda ahí
// `${titulo}\n\n${mensaje}`. Estos límites dejan margen para que el nombre
// más largo quepa sin que SQL Server trunque la publicación.
const MAX_TITULO = 120;
const MAX_MENSAJE = 350;

const DEFAULT_TITULO = '¡Feliz cumpleaños {nombre_completo}! 🎂🎉🎊';
const DEFAULT_MENSAJE =
  'El departamento de capellanía te desea lo mejor hoy en este día tan ' +
  'especial. ¡Que Dios te bendiga grandemente!';

// Variables que el administrador puede usar en el título y el cuerpo.
const VARIABLES = {
  '{nombre}': 'Nombre de pila',
  '{apellido}': 'Apellido',
  '{nombre_completo}': 'Nombre y apellido',
};

// Al menos una de estas tiene que aparecer en el título o en el cuerpo.
// No es un capricho: el cron evita publicar dos veces al mismo cumpleañero
// buscando su nombre dentro del texto de las publicaciones de hoy
// (EDI.Publicaciones no tiene columna que apunte al festejado). Si la
// plantilla no menciona el nombre, esa comprobación deja de funcionar.
const VARIABLES_NOMBRE = ['{nombre}', '{nombre_completo}'];

const CACHE_TTL_MS = 60_000;
let _cache = null;
let _cacheAt = 0;

/** Una URL sirve solo si es absoluta y http(s). Lo demás se descarta. */
function esUrlUsable(valor) {
  const url = String(valor || '').trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function _filaAValor(filas, clave) {
  const fila = filas.find((f) => f.clave === clave);
  const valor = fila?.valor;
  return valor == null ? '' : String(valor);
}

/**
 * Devuelve { imagen_url, titulo, mensaje }.
 * `imagen_url` es null cuando no hay ninguna configurada o cuando lo guardado
 * no es una URL absoluta — así quien la consuma no tiene que volver a validar.
 */
async function getBirthdayConfig({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;

  let filas = [];
  try {
    filas = await queryP(
      `SELECT clave, valor FROM EDI.App_Config
       WHERE clave IN (@kImg, @kTit, @kMsg)`,
      {
        kImg: { type: sql.NVarChar, value: KEY_IMAGEN },
        kTit: { type: sql.NVarChar, value: KEY_TITULO },
        kMsg: { type: sql.NVarChar, value: KEY_MENSAJE },
      },
    );
  } catch (e) {
    // Si la base no responde preferimos los valores por defecto antes que
    // tumbar el cron entero. La caché vieja, si existe, es mejor aún.
    console.warn('⚠️  No se pudo leer la config de cumpleaños:', e.message);
    if (_cache) return _cache;
  }

  const imagenGuardada = _filaAValor(filas, KEY_IMAGEN);
  const config = {
    imagen_url: esUrlUsable(imagenGuardada) ? imagenGuardada.trim() : null,
    titulo: _filaAValor(filas, KEY_TITULO) || DEFAULT_TITULO,
    mensaje: _filaAValor(filas, KEY_MENSAJE) || DEFAULT_MENSAJE,
  };

  _cache = config;
  _cacheAt = Date.now();
  return config;
}

function invalidateBirthdayConfig() {
  _cache = null;
  _cacheAt = 0;
}

async function _upsert(clave, valor, descripcion) {
  await queryP(
    `IF EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = @clave)
       UPDATE EDI.App_Config
       SET valor = @valor, updated_at = GETDATE()
       WHERE clave = @clave;
     ELSE
       INSERT INTO EDI.App_Config (clave, valor, descripcion)
       VALUES (@clave, @valor, @descripcion);`,
    {
      clave: { type: sql.NVarChar, value: clave },
      valor: valor == null
        ? { type: sql.NVarChar, value: null }
        : { type: sql.NVarChar, value: String(valor) },
      descripcion: { type: sql.NVarChar, value: descripcion },
    },
  );
}

/**
 * Valida y guarda. Recibe solo los campos que se quieren cambiar.
 * Para borrar la imagen se pasa `imagen_url: null` (o cadena vacía).
 * Lanza Error con un mensaje presentable si algo no pasa la validación.
 */
async function setBirthdayConfig(cambios = {}) {
  const tocaTitulo = Object.prototype.hasOwnProperty.call(cambios, 'titulo');
  const tocaMensaje = Object.prototype.hasOwnProperty.call(cambios, 'mensaje');
  const tocaImagen = Object.prototype.hasOwnProperty.call(cambios, 'imagen_url');

  if (!tocaTitulo && !tocaMensaje && !tocaImagen) {
    throw new Error('No se envió ningún campo para actualizar.');
  }

  const actual = await getBirthdayConfig({ force: true });

  const titulo = tocaTitulo ? String(cambios.titulo ?? '').trim() : actual.titulo;
  const mensaje = tocaMensaje ? String(cambios.mensaje ?? '').trim() : actual.mensaje;

  if (tocaTitulo || tocaMensaje) {
    if (!titulo) throw new Error('El título no puede quedar vacío.');
    if (!mensaje) throw new Error('El mensaje no puede quedar vacío.');
    if (titulo.length > MAX_TITULO) {
      throw new Error(`El título no puede pasar de ${MAX_TITULO} caracteres.`);
    }
    if (mensaje.length > MAX_MENSAJE) {
      throw new Error(`El mensaje no puede pasar de ${MAX_MENSAJE} caracteres.`);
    }

    const texto = `${titulo} ${mensaje}`;
    if (!VARIABLES_NOMBRE.some((v) => texto.includes(v))) {
      throw new Error(
        'El título o el mensaje debe incluir {nombre} o {nombre_completo}, ' +
        'para que la felicitación sea personal y no se publique dos veces al ' +
        'mismo cumpleañero.',
      );
    }

    const desconocidas = [...texto.matchAll(/\{[^{}]*\}/g)]
      .map((m) => m[0])
      .filter((v) => !Object.prototype.hasOwnProperty.call(VARIABLES, v));
    if (desconocidas.length > 0) {
      throw new Error(
        `Variable no reconocida: ${[...new Set(desconocidas)].join(', ')}. ` +
        `Las disponibles son ${Object.keys(VARIABLES).join(', ')}.`,
      );
    }
  }

  let imagenFinal = actual.imagen_url;
  if (tocaImagen) {
    const cruda = String(cambios.imagen_url ?? '').trim();
    if (!cruda) {
      imagenFinal = null; // quitar la imagen: se publica solo con texto
    } else if (!esUrlUsable(cruda)) {
      throw new Error('La imagen debe ser una URL absoluta que empiece con http o https.');
    } else if (cruda.length > 500) {
      // App_Config.valor es NVARCHAR(500).
      throw new Error('La URL de la imagen es demasiado larga (máximo 500 caracteres).');
    } else {
      imagenFinal = cruda;
    }
  }

  if (tocaTitulo) {
    await _upsert(KEY_TITULO, titulo,
      'Titulo de la publicacion de cumpleanos. Admite {nombre}, {apellido} y {nombre_completo}.');
  }
  if (tocaMensaje) {
    await _upsert(KEY_MENSAJE, mensaje,
      'Cuerpo de la publicacion de cumpleanos. Admite {nombre}, {apellido} y {nombre_completo}.');
  }
  if (tocaImagen) {
    await _upsert(KEY_IMAGEN, imagenFinal,
      'URL absoluta de la imagen de las felicitaciones. Vacia = solo texto.');
  }

  invalidateBirthdayConfig();
  return getBirthdayConfig({ force: true });
}

/**
 * Sustituye las variables. Las desconocidas se dejan tal cual, no se rompen.
 * EDI.Usuarios.apellido admite NULL, asi que hay que convertirlo a cadena
 * vacia a mano: un parametro por defecto solo cubre `undefined` y dejaria un
 * literal "null" dentro de la felicitacion.
 */
function renderPlantilla(plantilla, datos = {}) {
  const nombre = (datos?.nombre ?? '').toString().trim();
  const apellido = (datos?.apellido ?? '').toString().trim();
  const nombreCompleto = `${nombre} ${apellido}`.trim();

  return String(plantilla ?? '')
    .replaceAll('{nombre_completo}', nombreCompleto)
    .replaceAll('{nombre}', nombre)
    .replaceAll('{apellido}', apellido)
    .replace(/[ \t]+/g, ' ')   // por si {apellido} quedo vacio
    .trim();
}

module.exports = {
  KEY_IMAGEN,
  KEY_TITULO,
  KEY_MENSAJE,
  MAX_TITULO,
  MAX_MENSAJE,
  DEFAULT_TITULO,
  DEFAULT_MENSAJE,
  VARIABLES,
  esUrlUsable,
  getBirthdayConfig,
  setBirthdayConfig,
  invalidateBirthdayConfig,
  renderPlantilla,
};
