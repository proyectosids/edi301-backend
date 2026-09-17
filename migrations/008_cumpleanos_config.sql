-- Configuración de las felicitaciones de cumpleaños.
--
-- Antes la URL de la imagen vivía en una variable de módulo dentro de
-- birthday.service.js, así que cada reinicio o redeploy del contenedor la
-- borraba y volvía al valor por defecto '/uploads/image.png', que no existe.
-- Ese es el motivo de que la imagen "se quitara sola" y de que las
-- publicaciones salieran con "Imagen no disponible".
--
-- Ahora vive aquí, junto con el título y el cuerpo del mensaje.
--
-- Nota sobre longitudes: EDI.Publicaciones.mensaje es NVARCHAR(500) y el cron
-- guarda titulo + '\n\n' + mensaje en esa única columna. Por eso el backend
-- limita el título a 120 caracteres y el cuerpo a 350.

IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[EDI].[App_Config]') AND type = N'U'
)
BEGIN
    CREATE TABLE EDI.App_Config (
        clave       NVARCHAR(100) PRIMARY KEY,
        valor       NVARCHAR(500) NULL,
        descripcion NVARCHAR(500) NULL,
        updated_at  DATETIME NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Tabla EDI.App_Config creada.';
END;
GO

-- URL de la imagen. Se siembra vacía a propósito: si nunca se ha subido una,
-- el cron publica la felicitación solo con texto en vez de con un enlace roto.
IF NOT EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = 'cumpleanos_imagen_url')
BEGIN
    INSERT INTO EDI.App_Config (clave, valor, descripcion)
    VALUES (
        'cumpleanos_imagen_url',
        NULL,
        'URL absoluta (Cloudinary) de la imagen de las felicitaciones de cumpleanos. Vacia = la publicacion sale solo con texto.'
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = 'cumpleanos_titulo')
BEGIN
    INSERT INTO EDI.App_Config (clave, valor, descripcion)
    VALUES (
        'cumpleanos_titulo',
        N'¡Feliz cumpleaños {nombre_completo}! 🎂🎉🎊',
        'Titulo de la publicacion de cumpleanos. Admite {nombre}, {apellido} y {nombre_completo}. Maximo 120 caracteres.'
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = 'cumpleanos_mensaje')
BEGIN
    INSERT INTO EDI.App_Config (clave, valor, descripcion)
    VALUES (
        'cumpleanos_mensaje',
        N'El departamento de capellanía te desea lo mejor hoy en este día tan especial. ¡Que Dios te bendiga grandemente!',
        'Cuerpo de la publicacion de cumpleanos. Admite {nombre}, {apellido} y {nombre_completo}. Maximo 350 caracteres.'
    );
END;
GO

-- Migración de la imagen que ya estuviera configurada en memoria: no hay nada
-- que migrar, porque esa variable se perdía en cada reinicio. Si quieres
-- dejar una imagen desde ya, busca su URL en Cloudinary (carpeta
-- edi301/cumpleanos) y ejecútalo a mano:
--
--   UPDATE EDI.App_Config
--   SET valor = 'https://res.cloudinary.com/.../cumpleanos-XXXX.webp',
--       updated_at = GETDATE()
--   WHERE clave = 'cumpleanos_imagen_url';
--
-- O simplemente vuelve a subirla desde la app, que ahora sí queda guardada.
