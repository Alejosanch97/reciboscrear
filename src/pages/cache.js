// =========================================================
//  cache.js — Caché local para Recibos (Instituto Crear)
//  Estrategia stale-while-revalidate:
//   - Lee de localStorage al instante (aunque esté "viejo")
//   - Revalida en segundo plano contra Apps Script (con el token de sesión)
// =========================================================
import { API_URL, getSheet } from "./api.js";

const PREFIX = "recibos_cache_";
const TTL_MS = 1000 * 60 * 60 * 24;

const keyFor = (sheet) => PREFIX + sheet;

function leerLocal(sheet) {
	try {
		const raw = localStorage.getItem(keyFor(sheet));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || !Array.isArray(parsed.data)) return null;
		return parsed;
	} catch {
		return null;
	}
}

function guardarLocal(sheet, data) {
	try {
		localStorage.setItem(keyFor(sheet), JSON.stringify({ data, savedAt: Date.now() }));
	} catch {
		/* sin espacio o modo privado */
	}
}

export function estaFresco(sheet) {
	const c = leerLocal(sheet);
	return !!c && Date.now() - c.savedAt < TTL_MS;
}

/** Lee del caché al instante y revalida en segundo plano. */
export function getCachedThenRevalidate(sheet, onFresh) {
	const cached = leerLocal(sheet);
	getSheet(sheet)
		.then((fresh) => {
			guardarLocal(sheet, fresh);
			if (typeof onFresh === "function") onFresh(fresh);
		})
		.catch(() => {
			/* sin red: seguimos con lo cacheado */
		});
	return cached ? cached.data : [];
}

/** Fuerza recarga desde el servidor y actualiza caché. */
export async function refreshSheet(sheet) {
	const fresh = await getSheet(sheet);
	guardarLocal(sheet, fresh);
	return fresh;
}

export function setCache(sheet, data) {
	guardarLocal(sheet, data);
}

export function peekCache(sheet) {
	const c = leerLocal(sheet);
	return c ? c.data : [];
}

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
