/* Cierre manual de cupos de familias EDI.
   Idempotente: puede ejecutarse una sola vez en producción o en desarrollo. */
IF COL_LENGTH('EDI.Familias_EDI', 'cerrada_manualmente') IS NULL
BEGIN
  ALTER TABLE EDI.Familias_EDI
    ADD cerrada_manualmente BIT NOT NULL
      CONSTRAINT DF_FamiliasEDI_CerradaManualmente DEFAULT (0);
END;
GO
