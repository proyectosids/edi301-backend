-- Audiencia de las encuestas.
--
-- Hasta ahora toda encuesta PUBLICADA era visible para cualquier usuario
-- autenticado y la notificación salía a todos. Para que un estudio por
-- muestreo tenga validez estadística hace falta lo contrario: que solo las
-- personas sorteadas puedan responder.
--
--   audiencia = 'TODOS'   → comportamiento de siempre.
--   audiencia = 'MUESTRA' → solo quien tenga fila en EDI.Encuesta_Audiencia.
--
-- Esto NO rompe el anonimato de las respuestas. Saber a quién se invitó y
-- saber qué contestó cada quien son cosas distintas: EDI.Encuesta_Respuestas
-- sigue guardando únicamente el respondent_hash, sin vínculo con el usuario.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[EDI].[Encuestas]') AND name = 'audiencia'
)
BEGIN
    ALTER TABLE EDI.Encuestas
        ADD audiencia NVARCHAR(20) NOT NULL
            CONSTRAINT DF_Encuestas_Audiencia DEFAULT 'TODOS';
    PRINT 'Columna EDI.Encuestas.audiencia creada.';
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_Encuestas_Audiencia'
)
BEGIN
    ALTER TABLE EDI.Encuestas
        ADD CONSTRAINT CK_Encuestas_Audiencia
            CHECK (audiencia IN ('TODOS', 'MUESTRA'));
END;
GO

-- Metadatos del sorteo, para poder documentar la metodología del estudio.
-- La semilla permite reproducir exactamente la misma muestra: si alguien
-- cuestiona la selección, se vuelve a correr y tiene que salir idéntica.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[EDI].[Encuestas]') AND name = 'muestra_semilla'
)
BEGIN
    ALTER TABLE EDI.Encuestas ADD
        muestra_semilla    NVARCHAR(64) NULL,
        muestra_creada_at  DATETIME     NULL,
        muestra_criterio   NVARCHAR(500) NULL;
    PRINT 'Columnas de metadatos de muestra creadas.';
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[EDI].[Encuesta_Audiencia]') AND type = N'U'
)
BEGIN
    CREATE TABLE EDI.Encuesta_Audiencia (
        id_encuesta INT NOT NULL,
        id_usuario  INT NOT NULL,
        -- 'PADRES' | 'HIJOS'. Se guarda el estrato del momento del sorteo:
        -- si después cambia el rol de la persona, la muestra sigue siendo la
        -- que se sorteó, que es lo correcto para el estudio.
        estrato     NVARCHAR(20) NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_EncuestaAudiencia PRIMARY KEY (id_encuesta, id_usuario),
        CONSTRAINT FK_EncuestaAudiencia_Encuesta
            FOREIGN KEY (id_encuesta) REFERENCES EDI.Encuestas(id_encuesta),
        CONSTRAINT FK_EncuestaAudiencia_Usuario
            FOREIGN KEY (id_usuario) REFERENCES EDI.Usuarios(id_usuario)
    );

    -- El camino caliente es "¿este usuario está invitado a esta encuesta?",
    -- que la PK ya resuelve. Este índice cubre el listado por usuario.
    CREATE INDEX IX_EncuestaAudiencia_Usuario
        ON EDI.Encuesta_Audiencia (id_usuario) INCLUDE (estrato);

    PRINT 'Tabla EDI.Encuesta_Audiencia creada.';
END;
GO
