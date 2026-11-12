// =========================================================
//  termica.js — impresión DIRECTA a la térmica (sin ventana de Chrome)
//  Usa Web Serial (Chrome/Edge) y comandos ESC/POS.
//  Imprime exactamente el texto del recibo y para: no gasta papel de más.
// =========================================================

const COLS = 32;        // caracteres por línea en papel de 58 mm (fuente normal)
const BAUD = 9600;      // velocidad del puerto; si no imprime, prueba 115200

export const soportaDirecta = () => typeof navigator !== "undefined" && "serial" in navigator;

let puerto = null;

/** Puerto ya autorizado antes (Chrome lo recuerda): no pide nada al usuario */
export async function puertoGuardado() {
	if (!soportaDirecta()) return null;
	const ps = await navigator.serial.getPorts();
	puerto = ps[0] || null;
	return puerto;
}

/** Primera vez: Chrome muestra la lista de puertos y eliges la impresora */
export async function conectarTermica() {
	puerto = await navigator.serial.requestPort();
	await abrir();
	return puerto;
}

async function abrir() {
	if (!puerto) throw new Error("No hay impresora conectada");
	if (!puerto.writable) await puerto.open({ baudRate: BAUD });
}

/* ---------- texto ---------- */
// La térmica no entiende tildes ni símbolos raros: se limpian
const limpio = (s) =>
	(s ?? "")
		.toString()
		.replace(/ /g, " ")
		.replace(/°/g, "o")
		.replace(/·/g, "-")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^\x20-\x7e]/g, "");

const pesos = (n) =>
	"$ " + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const dosLados = (izq, der, cols = COLS) => {
	izq = limpio(izq);
	der = limpio(der);
	const espacio = cols - der.length - 1;
	if (izq.length > espacio) izq = izq.slice(0, Math.max(espacio, 0));
	return izq + " ".repeat(Math.max(cols - izq.length - der.length, 1)) + der;
};

const partir = (txt, cols = COLS) => {
	const palabras = limpio(txt).split(/\s+/).filter(Boolean);
	const out = [];
	let linea = "";
	palabras.forEach((p) => {
		if ((linea + " " + p).trim().length > cols) {
			if (linea) out.push(linea);
			linea = p.slice(0, cols);
		} else linea = (linea + " " + p).trim();
	});
	if (linea) out.push(linea);
	return out;
};

const fechaCorta = (f) => {
	const m = (f ?? "").toString().match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? `${m[3]}/${m[2]}/${m[1]}` : limpio(f);
};

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const mesCorto = (k) => {
	const m = (k || "").match(/^(\d{4})-(\d{2})$/);
	return m ? `${MESES[+m[2] - 1]} ${m[1]}` : "";
};

/* ---------- comandos ESC/POS ---------- */
const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const CENTRO = [ESC, 0x61, 1];
const IZQ = [ESC, 0x61, 0];
const NEGRITA = (on) => [ESC, 0x45, on ? 1 : 0];
const ALTO_DOBLE = (on) => [GS, 0x21, on ? 0x10 : 0x00];
const AVANZAR = (n) => [ESC, 0x64, n];

function constructor() {
	const bytes = [];
	const api = {
		raw: (arr) => (bytes.push(...arr), api),
		txt: (s) => (bytes.push(...new TextEncoder().encode(limpio(s) + "\n")), api),
		linea: (c = "-") => api.txt(c.repeat(COLS)),
		bytes: () => new Uint8Array(bytes),
	};
	return api;
}

/** Arma los bytes de un recibo con N copias seguidas en la misma tira */
export function reciboESCPOS(data, copias, colegio = "INSTITUTO PEDAGOGICO CREAR") {
	const b = constructor().raw(INIT);

	copias.forEach((copia, i) => {
		b.raw(CENTRO).raw(NEGRITA(true));
		partir(colegio).forEach((l) => b.txt(l));
		b.raw(NEGRITA(false)).txt("Recibo de caja");
		b.raw(NEGRITA(true)).txt(`[ ${copia} ]`).raw(NEGRITA(false));
		b.raw(IZQ);

		b.raw(NEGRITA(true)).txt(dosLados(`No. ${String(data.numero ?? "").padStart(5, "0")}`, fechaCorta(data.fecha))).raw(NEGRITA(false));
		if (data.hora) b.txt(dosLados("Hora", data.hora));
		b.linea();

		data.items.forEach((it) => {
			b.raw(NEGRITA(true));
			partir(it.estudiante).forEach((l) => b.txt(l));
			b.raw(NEGRITA(false));
			if (it.grado) b.txt(it.grado);
			const concepto = it.mes ? `${it.concepto} ${mesCorto(it.mes)}` : it.concepto;
			b.txt(dosLados(concepto, pesos(it.valor)));
		});

		if (data.observacion) {
			b.linea();
			partir(`Obs: ${data.observacion}`).forEach((l) => b.txt(l));
		}

		b.linea();
		b.raw(NEGRITA(true)).raw(ALTO_DOBLE(true)).txt(dosLados("TOTAL", pesos(data.total))).raw(ALTO_DOBLE(false)).raw(NEGRITA(false));
		b.linea();
		if (data.usuario) b.txt(`Atendio: ${data.usuario}`);
		b.raw(CENTRO).txt("Conserve este recibo - Gracias").raw(IZQ);

		if (i < copias.length - 1) {
			b.raw(AVANZAR(1)).raw(CENTRO).txt("- - - - rasgar aqui - - - -").raw(IZQ).raw(AVANZAR(1));
		}
	});

	// Avance final justo para que el texto pase la cuchilla/borde de rasgado
	b.raw(AVANZAR(4));
	return b.bytes();
}

/** Envía un recibo a la térmica. Lanza error si no hay impresora conectada. */
export async function imprimirTermica(data, copias) {
	if (!puerto) await puertoGuardado();
	await abrir();
	const writer = puerto.writable.getWriter();
	try {
		await writer.write(reciboESCPOS(data, copias));
	} finally {
		writer.releaseLock();
	}
}