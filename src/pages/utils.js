// =========================================================
//  utils.js — formatos, fechas, recibos y cursos
// =========================================================

export const NOMBRE_COLEGIO = "INSTITUTO PEDAGÓGICO CREAR";

/* ---------- CURSOS ----------
   id = id_concepto en la hoja Conceptos
   columna = nombre de la columna en la hoja Niños (ahí se escribe OK)
   Para agregar un curso nuevo: créalo en Conceptos, agrega la columna en Niños
   y suma una línea aquí (y en CURSOS del Code.gs). */
export const CURSOS = [
	{ id: "1", columna: "ASESORIA DE TAREAS" },
	{ id: "2", columna: "ASESORIA TAREAS 2" },
	{ id: "3", columna: "ARTES" },
	{ id: "4", columna: "DANZAS" },
	{ id: "5", columna: "FUTBOL" },
	{ id: "6", columna: "INGLES" },
	{ id: "7", columna: "ROBOTICA" },
	{ id: "8", columna: "FRANCES" },
	{ id: "16", columna: "MUSICA" },
];

// Meses que se cobran en los cursos: febrero (2) a noviembre (11)
export const MESES_CURSO = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/* ---------- formatos ---------- */
export const COP = (n) =>
	new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
		Number(n) || 0
	);

export const pad = (n) => String(n).padStart(2, "0");
export const numRecibo = (n) => String(n ?? "").padStart(5, "0");

// Compara textos sin tildes, mayúsculas, espacios ni guiones
export const norm = (s) =>
	(s ?? "")
		.toString()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");

/* ---------- fechas (siempre locales, no UTC) ---------- */
export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MESES_LARGO = [
	"enero", "febrero", "marzo", "abril", "mayo", "junio",
	"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
export const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hoyISO = () => isoLocal(new Date());
export const horaLocal = () => new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

export function parseFecha(f) {
	if (!f) return null;
	if (f instanceof Date) return new Date(f.getFullYear(), f.getMonth(), f.getDate());
	const s = f.toString().trim();
	let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
	m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
	if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
	const d = new Date(s);
	if (isNaN(d)) return null;
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const fmtFecha = (f) => {
	const d = parseFecha(f);
	return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : (f ?? "");
};

/* ---------- meses de curso ("2026-03") ---------- */
export const claveMes = (anio, mes) => `${anio}-${pad(mes)}`;

// Acepta "2026-03", "2026-3" o una fecha (si Sheets lo convirtió) → "2026-03"
export function normalizarMes(v) {
	if (!v) return "";
	const s = v.toString().trim();
	const m = s.match(/^(\d{4})-(\d{1,2})$/);
	if (m) return `${m[1]}-${pad(+m[2])}`;
	const d = new Date(s);
	if (!isNaN(d)) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
	return s;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function etiquetaMes(clave, conAnio = true) {
	const m = (clave || "").match(/^(\d{4})-(\d{2})$/);
	if (!m) return clave || "";
	const nombre = capital(MESES_LARGO[+m[2] - 1]);
	return conAnio ? `${nombre} ${m[1]}` : nombre;
}

export const conceptoConMes = (it) => (it.mes ? `${it.concepto} · ${etiquetaMes(it.mes)}` : it.concepto);

/* ---------- estudiantes ---------- */
// id_niño puede llegar como "id_niño" o "id_ni_o" (versión limpia del backend)
export const idNinoDe = (n) => (n.id_niño ?? n.id_ni_o ?? "").toString();

export const esCorreoValido = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((c ?? "").toString().trim());

const ORDEN_GRADOS = [
	"PREJARDIN", "JARDIN", "TRANSITION", "FIRSTGRADE", "SECONDGRADE", "THIRDGRADE", "FOURTHGRADE",
	"FIFTHGRADE", "SIXTHGRADE", "SEVENTHGRADE", "EIGHTHGRADE", "NINTHGRADE", "TENTHGRADE", "ELEVENTHGRADE",
];
export const rankGrado = (g) => {
	const i = ORDEN_GRADOS.indexOf(norm(g));
	return i === -1 ? 999 : i;
};

// ¿El estudiante tiene OK en la columna del curso?
export function inscrito(nino, columna) {
	const objetivo = norm(columna);
	const k = Object.keys(nino).find((key) => norm(key) === objetivo);
	if (!k) return false;
	return ["OK", "SI", "X", "TRUE"].includes(norm(nino[k]));
}

/* ---------- recibos ---------- */
export const esAnulado = (r) => norm(r.estado) === "ANULADO";

// Agrupa filas de la hoja Recibos por id_recibo (un recibo = varios ítems)
export function agruparRecibos(rows) {
	const map = new Map();
	rows.forEach((r) => {
		const id = (r.id_recibo ?? "").toString();
		if (!id) return;
		if (!map.has(id)) {
			map.set(id, {
				id_recibo: id,
				fecha: r.fecha,
				observacion: r.observacion,
				usuario: r.usuario || "",
				estado: "ACTIVO",
				motivo: "",
				anulado_por: "",
				items: [],
				total: 0,
			});
		}
		const g = map.get(id);
		const valor = Number(r.valor) || 0;
		g.items.push({
			id_niño: idNinoDe(r),
			estudiante: r.estudiante,
			grado: r.grado,
			id_concepto: (r.id_concepto ?? "").toString(),
			concepto: r.concepto,
			mes: normalizarMes(r.mes),
			valor,
		});
		g.total += valor;
		if (esAnulado(r)) {
			g.estado = "ANULADO";
			if (r.motivo_anulacion) g.motivo = r.motivo_anulacion.toString();
			if (r.anulado_por) g.anulado_por = r.anulado_por.toString();
		}
	});
	return [...map.values()].sort((a, b) => Number(b.id_recibo) - Number(a.id_recibo));
}

/* ---------- estado de pagos de un curso ----------
   Devuelve los 10 meses (feb–nov) con: pagado | debe | pendiente
   "debe" = meses ya vencidos (hasta el mes actual incluido) sin pago */
export function estadoCurso(recibos, idNino, idConcepto, anio, hoy = new Date()) {
	const pagos = {};
	const sinMes = [];
	recibos.forEach((r) => {
		if (esAnulado(r)) return;
		if (idNinoDe(r) !== idNino || (r.id_concepto ?? "").toString() !== idConcepto) return;
		const mes = normalizarMes(r.mes);
		if (!mes) {
			sinMes.push({ id_recibo: r.id_recibo, fecha: r.fecha });
			return;
		}
		if (mes.startsWith(`${anio}-`)) pagos[mes] = { id_recibo: r.id_recibo, fecha: r.fecha, usuario: r.usuario };
	});

	const anioHoy = hoy.getFullYear();
	const mesHoy = hoy.getMonth() + 1;
	const vencido = (m) => anio < anioHoy || (anio === anioHoy && m <= mesHoy);

	const meses = MESES_CURSO.map((m) => {
		const key = claveMes(anio, m);
		const pago = pagos[key];
		return {
			key,
			num: m,
			estado: pago ? "pagado" : vencido(m) ? "debe" : "pendiente",
			pago,
		};
	});

	const debe = meses.filter((m) => m.estado === "debe");
	return {
		meses,
		pagados: meses.filter((m) => m.estado === "pagado").length,
		debe,
		pendientes: meses.filter((m) => m.estado === "pendiente"),
		sinMes,
	};
}

/* ---------- periodos (análisis) ---------- */
export function rangoPeriodo(modo, refISO) {
	const ref = parseFecha(refISO) || new Date();
	if (modo === "todo") return { desde: null, hasta: null, label: "Todo el historial" };
	if (modo === "dia") {
		const k = isoLocal(ref);
		return {
			desde: k,
			hasta: k,
			label: `${DIAS[ref.getDay()]} ${ref.getDate()} ${MESES[ref.getMonth()]} ${ref.getFullYear()}`,
		};
	}
	if (modo === "semana") {
		const lunes = new Date(ref);
		lunes.setDate(ref.getDate() - ((ref.getDay() + 6) % 7));
		const domingo = new Date(lunes);
		domingo.setDate(lunes.getDate() + 6);
		return {
			desde: isoLocal(lunes),
			hasta: isoLocal(domingo),
			label: `${lunes.getDate()} ${MESES[lunes.getMonth()]} – ${domingo.getDate()} ${MESES[domingo.getMonth()]} ${domingo.getFullYear()}`,
		};
	}
	const ini = new Date(ref.getFullYear(), ref.getMonth(), 1);
	const fin = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
	return { desde: isoLocal(ini), hasta: isoLocal(fin), label: `${MESES_LARGO[ref.getMonth()]} ${ref.getFullYear()}` };
}

export function moverReferencia(modo, refISO, paso) {
	const d = parseFecha(refISO) || new Date();
	if (modo === "dia") d.setDate(d.getDate() + paso);
	if (modo === "semana") d.setDate(d.getDate() + 7 * paso);
	if (modo === "mes") d.setMonth(d.getMonth() + paso, 1);
	return isoLocal(d);
}
