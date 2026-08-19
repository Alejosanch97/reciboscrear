// =========================================================
//  cache.js — Caché local para Recibos (Instituto Crear)
//  Estrategia stale-while-revalidate:
//   - Lee de localStorage al instante (aunque esté "viejo")
//   - Revalida en segundo plano contra Apps Script
//   - Como estudiantes y conceptos casi no cambian, el TTL es largo
// =========================================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbyHoHpfh4NQRNWgnpO10pYbH3bWPr7Ln2FATAhRG7dAsXVF3KrMa4JIQxV4RsElIrvqQw/exec";

const PREFIX = "recibos_cache_";
const TTL_MS = 1000 * 60 * 60 * 24; // 24 h: se considera "fresco" un día entero

// ---------- utilidades bajo nivel ----------
function keyFor(sheet) {
  return PREFIX + sheet;
}

function leerLocal(sheet) {
  try {
    const raw = localStorage.getItem(keyFor(sheet));
    if (!raw) return null;
    const parsed = JSON.parse(raw); // { data, savedAt }
    if (!parsed || !Array.isArray(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function guardarLocal(sheet, data) {
  try {
    localStorage.setItem(
      keyFor(sheet),
      JSON.stringify({ data, savedAt: Date.now() })
    );
  } catch {
    // Sin espacio o modo privado: ignorar, seguimos con memoria
  }
}

export function estaFresco(sheet) {
  const c = leerLocal(sheet);
  if (!c) return false;
  return Date.now() - c.savedAt < TTL_MS;
}

// ---------- red ----------
async function fetchSheet(sheet) {
  const res = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheet)}`);
  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(json?.message || `No se pudo leer "${sheet}"`);
  }
  return json;
}

// =========================================================
//  API PÚBLICA
// =========================================================

/**
 * Lee del caché al instante y revalida en segundo plano.
 * @param {string} sheet - "Niños" | "Conceptos"
 * @param {(fresh:any[]) => void} onFresh - callback cuando llegan datos frescos del server
 * @returns {any[]} datos cacheados inmediatos (o [] si no hay)
 */
export function getCachedThenRevalidate(sheet, onFresh) {
  const cached = leerLocal(sheet);
  const inmediato = cached ? cached.data : [];

  // Revalidar siempre en segundo plano (barato y garantiza frescura)
  fetchSheet(sheet)
    .then((fresh) => {
      guardarLocal(sheet, fresh);
      if (typeof onFresh === "function") onFresh(fresh);
    })
    .catch(() => {
      // Si falla la red, nos quedamos con lo cacheado sin romper la UI
    });

  return inmediato;
}

/**
 * Fuerza recarga desde el servidor (botón "Actualizar") y actualiza caché.
 * @param {string} sheet
 * @returns {Promise<any[]>}
 */
export async function refreshSheet(sheet) {
  const fresh = await fetchSheet(sheet);
  guardarLocal(sheet, fresh);
  return fresh;
}

/**
 * Sobrescribe el caché en memoria local tras un cambio optimista
 * (crear/editar/eliminar) para que el próximo montaje ya lo tenga.
 * @param {string} sheet
 * @param {any[]} data
 */
export function setCache(sheet, data) {
  guardarLocal(sheet, data);
}

/**
 * Devuelve solo lo cacheado, sin tocar red (uso puntual).
 */
export function peekCache(sheet) {
  const c = leerLocal(sheet);
  return c ? c.data : [];
}

/**
 * Borra el caché de una hoja o de todo el sistema.
 */
export function clearCache(sheet) {
  if (sheet) {
    localStorage.removeItem(keyFor(sheet));
  } else {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  }
}

export { API_URL };