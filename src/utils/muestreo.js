// Muestreo aleatorio estratificado, reproducible.
//
// "Aleatorio" y "reproducible" no se contradicen: el sorteo usa un generador
// pseudoaleatorio sembrado con una cadena. Guardando esa semilla junto a la
// encuesta, cualquiera puede volver a correr el sorteo y obtener exactamente
// la misma muestra. Para un estudio que alguien va a revisar, eso importa:
// permite demostrar que la selección no se amañó.
//
// Math.random() no sirve aquí porque no acepta semilla.

const crypto = require('crypto');

/**
 * mulberry32: PRNG de 32 bits, corto y de buena distribución para este uso.
 * No es criptográfico — no hace falta, aquí nadie gana nada prediciéndolo.
 */
function prngDesdeSemilla(semilla) {
  // La semilla es texto; el hash la convierte en los 32 bits que necesita el
  // generador, y de paso hace que semillas parecidas ("a" y "b") den
  // secuencias completamente distintas.
  const hash = crypto.createHash('sha256').update(String(semilla)).digest();
  let estado = hash.readUInt32BE(0);

  return function siguiente() {
    estado |= 0;
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Devuelve una copia; no toca el arreglo original. */
function barajar(items, random) {
  const copia = [...items];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Reparte `total` entre los estratos de forma proporcional a su tamaño,
 * por el método de los restos mayores.
 *
 * Redondear cada cuota por separado no funciona: con 3 estratos de 33.3% y
 * total 100 saldrían 33+33+33 = 99, y falta uno. Aquí se asigna primero la
 * parte entera y las unidades sobrantes van a los estratos con mayor
 * fracción pendiente, así la suma siempre da exactamente `total`.
 */
function repartirProporcional(tamanosPorEstrato, total) {
  const estratos = Object.keys(tamanosPorEstrato);
  const poblacion = estratos.reduce((s, e) => s + tamanosPorEstrato[e], 0);

  if (poblacion === 0 || total <= 0) {
    return Object.fromEntries(estratos.map((e) => [e, 0]));
  }
  if (total >= poblacion) {
    return { ...tamanosPorEstrato };
  }

  const exactos = estratos.map((e) => ({
    estrato: e,
    exacto: (tamanosPorEstrato[e] * total) / poblacion,
  }));

  const cuotas = {};
  let asignado = 0;
  for (const { estrato, exacto } of exactos) {
    cuotas[estrato] = Math.floor(exacto);
    asignado += cuotas[estrato];
  }

  const porResto = [...exactos].sort(
    (a, b) => (b.exacto - Math.floor(b.exacto)) - (a.exacto - Math.floor(a.exacto)),
  );
  let i = 0;
  while (asignado < total && porResto.length > 0) {
    const { estrato } = porResto[i % porResto.length];
    // Nunca pedir más gente de la que hay en ese estrato.
    if (cuotas[estrato] < tamanosPorEstrato[estrato]) {
      cuotas[estrato]++;
      asignado++;
    } else if (porResto.every((p) => cuotas[p.estrato] >= tamanosPorEstrato[p.estrato])) {
      break; // todos llenos
    }
    i++;
  }

  return cuotas;
}

/**
 * Sortea la muestra.
 *
 * @param {Array<{id_usuario:number, estrato:string}>} poblacion
 * @param {Object} opciones
 * @param {number} [opciones.tamano]  total deseado, repartido proporcionalmente
 * @param {Object} [opciones.cuotas]  { PADRES: 40, HIJOS: 90 } — manda sobre `tamano`
 * @param {string} opciones.semilla
 * @returns {{ semilla, seleccionados, resumen }}
 */
function sortearMuestra(poblacion, { tamano, cuotas, semilla } = {}) {
  if (!semilla) throw new Error('Falta la semilla del sorteo.');

  const porEstrato = {};
  for (const persona of poblacion) {
    (porEstrato[persona.estrato] ||= []).push(persona);
  }

  const tamanos = Object.fromEntries(
    Object.entries(porEstrato).map(([e, lista]) => [e, lista.length]),
  );

  let objetivo;
  if (cuotas && Object.keys(cuotas).length > 0) {
    objetivo = {};
    for (const estrato of Object.keys(tamanos)) {
      const pedido = Number(cuotas[estrato] ?? 0);
      if (pedido > tamanos[estrato]) {
        throw new Error(
          `Se pidieron ${pedido} de ${estrato}, pero solo hay ${tamanos[estrato]} ` +
          'personas disponibles en ese grupo.',
        );
      }
      objetivo[estrato] = pedido;
    }
    const pedidoTotal = Object.values(objetivo).reduce((a, b) => a + b, 0);
    if (pedidoTotal === 0) throw new Error('Las cuotas suman cero.');
  } else {
    const n = Number(tamano);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error('El tamaño de la muestra debe ser un entero mayor que cero.');
    }
    objetivo = repartirProporcional(tamanos, n);
  }

  const random = prngDesdeSemilla(semilla);
  const seleccionados = [];
  const resumen = [];

  // Orden fijo de estratos: sin esto, el orden de las claves del objeto
  // cambiaría el consumo del PRNG y la misma semilla daría otra muestra.
  for (const estrato of Object.keys(porEstrato).sort()) {
    const disponibles = porEstrato[estrato];
    const cuantos = Math.min(objetivo[estrato] ?? 0, disponibles.length);

    // Se ordena por id antes de barajar para que la muestra no dependa del
    // orden en que la base devolvió las filas.
    const ordenados = [...disponibles].sort((a, b) => a.id_usuario - b.id_usuario);
    const elegidos = barajar(ordenados, random).slice(0, cuantos);

    seleccionados.push(...elegidos.map((p) => ({ ...p, estrato })));
    resumen.push({
      estrato,
      poblacion: disponibles.length,
      seleccionados: elegidos.length,
      pct_poblacion: Number(
        ((disponibles.length * 100) / (poblacion.length || 1)).toFixed(2),
      ),
      pct_muestra: 0, // se completa abajo, cuando se conoce el total
    });
  }

  const totalMuestra = seleccionados.length;
  for (const r of resumen) {
    r.pct_muestra = totalMuestra === 0
      ? 0
      : Number(((r.seleccionados * 100) / totalMuestra).toFixed(2));
  }

  return { semilla, seleccionados, resumen };
}

/** Semilla legible y única, por si el administrador no propone una. */
function semillaPorDefecto(idEncuesta) {
  return `encuesta-${idEncuesta}-${Date.now().toString(36)}`;
}

module.exports = {
  prngDesdeSemilla,
  barajar,
  repartirProporcional,
  sortearMuestra,
  semillaPorDefecto,
};
