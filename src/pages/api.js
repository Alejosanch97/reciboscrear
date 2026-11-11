// =========================================================
//  api.js — conexión con Apps Script + sesión del usuario
// =========================================================

export const API_URL =
	"https://script.google.com/macros/s/AKfycbyHoHpfh4NQRNWgnpO10pYbH3bWPr7Ln2FATAhRG7dAsXVF3KrMa4JIQxV4RsElIrvqQw/exec";

const SESION_KEY = "rc_sesion";

export function leerSesion() {
	try {
		const s = JSON.parse(localStorage.getItem(SESION_KEY));
		if (!s || !s.token || Date.now() > s.exp) return null;
		return s;
	} catch {
		return null;
	}
}

function guardarSesion(s) {
	try {
		localStorage.setItem(SESION_KEY, JSON.stringify(s));
	} catch {
		/* modo privado */
	}
}

export function borrarSesion() {
	try {
		localStorage.removeItem(SESION_KEY);
	} catch {
		/* nada */
	}
}

const getToken = () => leerSesion()?.token || "";

// La app se entera cuando el servidor dice que la sesión ya no sirve
let alExpirar = null;
export const onSesionExpirada = (fn) => {
	alExpirar = fn;
};

function revisar(json) {
	if (json && json.status === "auth") {
		borrarSesion();
		if (alExpirar) alExpirar(json.message || "Tu sesión expiró");
		throw new Error(json.message || "Tu sesión expiró");
	}
	return json;
}

// Apps Script rechaza el preflight de application/json → text/plain
export async function postAction(payload) {
	const res = await fetch(API_URL, {
		method: "POST",
		headers: { "Content-Type": "text/plain;charset=utf-8" },
		body: JSON.stringify({ ...payload, token: getToken() }),
	});
	return revisar(await res.json());
}

export async function getSheet(sheet) {
	const url = `${API_URL}?sheet=${encodeURIComponent(sheet)}&token=${encodeURIComponent(getToken())}`;
	const res = await fetch(url);
	const json = revisar(await res.json());
	if (!Array.isArray(json)) throw new Error(json?.message || `No se pudo leer "${sheet}"`);
	return json;
}

export async function iniciarSesion(usuario, clave) {
	const res = await fetch(API_URL, {
		method: "POST",
		headers: { "Content-Type": "text/plain;charset=utf-8" },
		body: JSON.stringify({ action: "login", usuario, clave }),
	});
	const json = await res.json();
	if (json.status !== "success") throw new Error(json.message || "No se pudo iniciar sesión");
	const sesion = { token: json.token, exp: json.exp, ...json.usuario };
	guardarSesion(sesion);
	return sesion;
}
