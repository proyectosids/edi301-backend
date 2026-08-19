IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[EDI].[Encuestas]') AND type = N'U')
BEGIN
  CREATE TABLE EDI.Encuestas (
    id_encuesta INT IDENTITY(1,1) PRIMARY KEY,
    titulo NVARCHAR(200) NOT NULL,
    descripcion NVARCHAR(1000) NULL,
    fecha_limite DATETIME NULL,
    estado NVARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    created_at DATETIME NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME NULL,
    activo BIT NOT NULL DEFAULT 1,
    CONSTRAINT CK_Encuestas_Estado CHECK (estado IN ('BORRADOR','PUBLICADA','CERRADA'))
  );

  CREATE TABLE EDI.Encuesta_Preguntas (
    id_pregunta INT IDENTITY(1,1) PRIMARY KEY,
    id_encuesta INT NOT NULL,
    texto NVARCHAR(1000) NOT NULL,
    tipo NVARCHAR(20) NOT NULL,
    orden INT NOT NULL,
    requerida BIT NOT NULL DEFAULT 1,
    CONSTRAINT FK_EncuestaPreguntas_Encuesta FOREIGN KEY (id_encuesta) REFERENCES EDI.Encuestas(id_encuesta),
    CONSTRAINT CK_EncuestaPreguntas_Tipo CHECK (tipo IN ('UNICA','MULTIPLE','LIBRE')),
    CONSTRAINT UQ_EncuestaPreguntas_Orden UNIQUE (id_encuesta, orden)
  );

  CREATE TABLE EDI.Encuesta_Opciones (
    id_opcion INT IDENTITY(1,1) PRIMARY KEY,
    id_pregunta INT NOT NULL,
    texto NVARCHAR(500) NOT NULL,
    orden INT NOT NULL,
    CONSTRAINT FK_EncuestaOpciones_Pregunta FOREIGN KEY (id_pregunta) REFERENCES EDI.Encuesta_Preguntas(id_pregunta),
    CONSTRAINT UQ_EncuestaOpciones_Orden UNIQUE (id_pregunta, orden)
  );

  -- respondent_hash es HMAC del usuario y encuesta: evita doble voto sin
  -- guardar una relación recuperable entre respuesta e identidad.
  CREATE TABLE EDI.Encuesta_Respuestas (
    id_respuesta INT IDENTITY(1,1) PRIMARY KEY,
    id_encuesta INT NOT NULL,
    respondent_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_EncuestaRespuestas_Encuesta FOREIGN KEY (id_encuesta) REFERENCES EDI.Encuestas(id_encuesta),
    CONSTRAINT UQ_EncuestaRespuestas_Anonima UNIQUE (id_encuesta, respondent_hash)
  );

  CREATE TABLE EDI.Encuesta_Respuesta_Detalle (
    id_detalle INT IDENTITY(1,1) PRIMARY KEY,
    id_respuesta INT NOT NULL,
    id_pregunta INT NOT NULL,
    id_opcion INT NULL,
    texto_libre NVARCHAR(MAX) NULL,
    CONSTRAINT FK_EncuestaDetalle_Respuesta FOREIGN KEY (id_respuesta) REFERENCES EDI.Encuesta_Respuestas(id_respuesta),
    CONSTRAINT FK_EncuestaDetalle_Pregunta FOREIGN KEY (id_pregunta) REFERENCES EDI.Encuesta_Preguntas(id_pregunta),
    CONSTRAINT FK_EncuestaDetalle_Opcion FOREIGN KEY (id_opcion) REFERENCES EDI.Encuesta_Opciones(id_opcion),
    CONSTRAINT CK_EncuestaDetalle_Contenido CHECK (id_opcion IS NOT NULL OR texto_libre IS NOT NULL)
  );
END;
GO
