import { useState, useEffect, useMemo, useCallback } from "react";
import "../styles/home.css";
import emailjs from "@emailjs/browser";
import {
	API_URL,
	getCachedThenRevalidate,
	refreshSheet,
	setCache,
	peekCache,
} from "./cache.js";
import {
	ResponsiveContainer,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
} from "recharts";

const CLAVE_ANALISIS = "CREAR1966";
const NOMBRE_COLEGIO = "INSTITUTO PEDAGÓGICO CREAR";

// Copias que salen al guardar un recibo (cada una se corta por separado)
const COPIAS_RECIBO = ["ORIGINAL · ACUDIENTE", "COPIA · ARCHIVO"];

// ---- EmailJS ----
const EMAILJS_SERVICE = "service_8dqywo2";
const EMAILJS_TEMPLATE = "template_xmgt31a";
const EMAILJS_PUBLIC_KEY = "VQ0tJwGauSCwIY_cf";

// Banner "ANULADO" gigante que se inyecta en el template (variable estado_banner)
const BANNER_ANULADO = `
<div style="max-width:600px;margin:8px auto 0;background:#c02626;color:#fff;text-align:center;padding:14px;font-family:system-ui,sans-serif,Arial;">
  <span style="font-size:34px;font-weight:800;letter-spacing:6px;">ANULADO</span>
</div>`;

/* ======================================================
   UTILIDADES
   ====================================================== */
const COP = (n) =>
	new Intl.NumberFormat("es-CO", {
		style: "currency",
		currency: "COP",
		maximumFractionDigits: 0,
	}).format(Number(n) || 0);

const pad = (n) => String(n).padStart(2, "0");
const numRecibo = (n) => String(n ?? "").padStart(5, "0");

// Fecha LOCAL (toISOString usa UTC y después de las 7 pm en Colombia da "mañana")
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoyISO = () => isoLocal(new Date());
const horaLocal = () =>
	new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

// Normaliza la fecha de la hoja a Date local (soporta "2026-08-19", "19/08/2026" e ISO con hora)
function parseFecha(f) {
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

const fmtFecha = (f) => {
	const d = parseFecha(f);
	return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : (f ?? "");
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = [
	"enero", "febrero", "marzo", "abril", "mayo", "junio",
	"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Rango de un periodo a partir de una fecha de referencia (yyyy-mm-dd)
function rangoPeriodo(modo, refISO) {
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

	// mes
	const ini = new Date(ref.getFullYear(), ref.getMonth(), 1);
	const fin = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
	return {
		desde: isoLocal(ini),
		hasta: isoLocal(fin),
		label: `${MESES_LARGO[ref.getMonth()]} ${ref.getFullYear()}`,
	};
}

function moverReferencia(modo, refISO, paso) {
	const d = parseFecha(refISO) || new Date();
	if (modo === "dia") d.setDate(d.getDate() + paso);
	if (modo === "semana") d.setDate(d.getDate() + 7 * paso);
	if (modo === "mes") d.setMonth(d.getMonth() + paso, 1);
	return isoLocal(d);
}

const esAnulado = (r) => (r.estado ?? "").toString().trim().toUpperCase() === "ANULADO";

// Agrupa filas de la hoja "Recibos" por id_recibo (un recibo = varios ítems)
function agruparRecibos(rows) {
	const map = new Map();
	rows.forEach((r) => {
		const id = (r.id_recibo ?? "").toString();
		if (!id) return;
		if (!map.has(id)) {
			map.set(id, {
				id_recibo: id,
				fecha: r.fecha,
				observacion: r.observacion,
				estado: "ACTIVO",
				motivo: "",
				items: [],
				total: 0,
			});
		}
		const g = map.get(id);
		const valor = Number(r.valor) || 0;
		g.items.push({
			estudiante: r.estudiante,
			grado: r.grado,
			concepto: r.concepto,
			valor,
		});
		g.total += valor;
		if (esAnulado(r)) {
			g.estado = "ANULADO";
			if (r.motivo_anulacion) g.motivo = r.motivo_anulacion.toString();
		}
	});
	return [...map.values()].sort((a, b) => Number(b.id_recibo) - Number(a.id_recibo));
}

// id_niño puede llegar como "id_niño" o "id_ni_o" (versión limpia del backend)
const idNinoDe = (n) => (n.id_niño ?? n.id_ni_o ?? "").toString();

const esCorreoValido = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((c ?? "").toString().trim());

const leerPref = (k, def) => {
	try {
		const v = localStorage.getItem(k);
		return v === null ? def : v === "1";
	} catch {
		return def;
	}
};
const guardarPref = (k, v) => {
	try {
		localStorage.setItem(k, v ? "1" : "0");
	} catch {
		/* modo privado: ignorar */
	}
};

// Apps Script rechaza el preflight de application/json → text/plain
async function postAction(payload) {
	const res = await fetch(API_URL, {
		method: "POST",
		headers: { "Content-Type": "text/plain;charset=utf-8" },
		body: JSON.stringify(payload),
	});
	return res.json();
}

async function getSheet(sheet) {
	const res = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheet)}`);
	const json = await res.json();
	return Array.isArray(json) ? json : [];
}

/* ======================================================
   HOME
   ====================================================== */
export const Home = () => {
	const [tab, setTab] = useState("recibos");

	// Carga INMEDIATA desde caché (primer render ya trae datos)
	const [ninos, setNinos] = useState(() => peekCache("Niños"));
	const [conceptos, setConceptos] = useState(() => peekCache("Conceptos"));
	const [refrescando, setRefrescando] = useState(false);
	const [toast, setToast] = useState(null);

	// ---- Recibo en construcción ----
	const [items, setItems] = useState([]);
	const [fecha, setFecha] = useState(hoyISO());
	const [observacion, setObservacion] = useState("");
	const [emitiendo, setEmitiendo] = useState(false); // bloquea doble clic
	const [autoImprimir, setAutoImprimir] = useState(() => leerPref("rc_auto_print", true));

	const [gradoSel, setGradoSel] = useState("");
	const [ninoSel, setNinoSel] = useState("");
	const [conceptoSel, setConceptoSel] = useState("");

	// ---- Impresión ----
	// printJob = { tipo: "recibo", data, copias } | { tipo: "resumen", data }
	const [printJob, setPrintJob] = useState(null);

	const imprimir = useCallback((job) => setPrintJob({ ...job, n: Date.now() }), []);

	// Cuando hay un trabajo nuevo, se pinta el ticket oculto y se manda a imprimir.
	// Con Chrome en modo --kiosk-printing sale directo a la impresora, sin diálogo.
	useEffect(() => {
		if (!printJob) return;
		const t = setTimeout(() => window.print(), 60);
		return () => clearTimeout(t);
	}, [printJob?.n]); // eslint-disable-line react-hooks/exhaustive-deps

	const notificar = useCallback((msg, tipo = "ok") => {
		setToast({ msg, tipo, n: Date.now() });
	}, []);

	useEffect(() => {
		if (!toast) return;
		const t = setTimeout(() => setToast(null), 3200);
		return () => clearTimeout(t);
	}, [toast]);

	// Stale-while-revalidate: pinta caché y refresca en segundo plano
	useEffect(() => {
		const cachedN = getCachedThenRevalidate("Niños", (fresh) => setNinos(fresh));
		const cachedC = getCachedThenRevalidate("Conceptos", (fresh) => setConceptos(fresh));
		if (cachedN.length) setNinos(cachedN);
		if (cachedC.length) setConceptos(cachedC);
	}, []);

	const actualizar = async () => {
		setRefrescando(true);
		try {
			const [n, c] = await Promise.all([refreshSheet("Niños"), refreshSheet("Conceptos")]);
			setNinos(n);
			setConceptos(c);
			notificar("Datos actualizados");
		} catch {
			notificar("No se pudo actualizar", "error");
		} finally {
			setRefrescando(false);
		}
	};

	// ---- orden escolar fijo (no alfabético) ----
	const grados = useMemo(() => {
		const normGrado = (g) =>
			g.toString().trim().toLowerCase()
				.normalize("NFD").replace(/[̀-ͯ]/g, "")
				.replace(/\s+/g, " ");
		const orden = [
			"pre jardin", "jardin", "transition", "first grade", "second grade",
			"third grade", "fourth grade", "fifth grade", "sixth grade", "seventh grade",
			"eighth grade", "ninth grade", "tenth grade", "eleventh grade",
		];
		const rank = (g) => {
			const i = orden.indexOf(normGrado(g));
			return i === -1 ? 999 : i;
		};
		const set = new Set(ninos.map((n) => (n.grado ?? "").toString()).filter(Boolean));
		return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
	}, [ninos]);

	const ninosDelGrado = useMemo(
		() =>
			ninos
				.filter((n) => (n.grado ?? "").toString() === gradoSel)
				.sort((a, b) => (a.nombre_completo ?? "").localeCompare(b.nombre_completo ?? "", "es")),
		[ninos, gradoSel]
	);

	const total = useMemo(() => items.reduce((acc, it) => acc + (Number(it.valor) || 0), 0), [items]);

	// ---- ítems del recibo ----
	const agregarItem = () => {
		const nino = ninos.find((n) => idNinoDe(n) === ninoSel);
		const concepto = conceptos.find((c) => c.id_concepto.toString() === conceptoSel);
		if (!nino || !concepto) {
			notificar("Elige grado, estudiante y concepto", "error");
			return;
		}
		setItems((prev) => [
			...prev,
			{
				id_niño: idNinoDe(nino),
				estudiante: nino.nombre_completo,
				grado: nino.grado,
				acudiente: nino.acudiente, // aquí está guardado el CORREO
				id_concepto: concepto.id_concepto.toString(),
				concepto: concepto.concepto,
				valor: Number(concepto.valor) || 0,
			},
		]);
		setConceptoSel("");
	};

	const quitarItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

	const limpiarRecibo = () => {
		setItems([]);
		setObservacion("");
		setGradoSel("");
		setNinoSel("");
		setConceptoSel("");
	};

	const cambiarAutoImprimir = (v) => {
		setAutoImprimir(v);
		guardarPref("rc_auto_print", v);
	};

	// ---- Envío del correo con EmailJS (emisión normal) ----
	const enviarCorreo = (recibo, correoDestino) => {
		const lineasItems = recibo.items
			.map((it) => `${it.estudiante} (${it.grado}) — ${it.concepto}: ${COP(it.valor)}`)
			.join("\n");

		return emailjs.send(
			EMAILJS_SERVICE,
			EMAILJS_TEMPLATE,
			{
				email: correoDestino,
				numero_recibo: numRecibo(recibo.numero),
				fecha: fmtFecha(recibo.fecha),
				items: lineasItems,
				observacion: recibo.observacion || "—",
				total: COP(recibo.total),
				estado_banner: "", // emisión normal: sin banner
			},
			{ publicKey: EMAILJS_PUBLIC_KEY }
		);
	};

	// ---- Guardar → imprimir 2 copias → enviar correo ----
	const emitirYEnviar = async () => {
		if (emitiendo) return;
		if (items.length === 0) {
			notificar("Agrega al menos un ítem", "error");
			return;
		}

		const correoDestino = (items[0].acudiente ?? "").toString().trim();
		const correoOk = esCorreoValido(correoDestino);

		const itemsSnapshot = items;
		const fechaSnapshot = fecha;
		const obsSnapshot = observacion;
		const totalSnapshot = total;

		setEmitiendo(true);
		try {
			// Una sola llamada: todos los ítems quedan con el MISMO número de recibo
			const r = await postAction({
				action: "emitir_recibo_multi",
				fecha: fechaSnapshot,
				observacion: obsSnapshot,
				items: itemsSnapshot.map((it) => ({ id_niño: it.id_niño, id_concepto: it.id_concepto })),
			});
			if (r.status !== "success") throw new Error(r.message || "Error al emitir");

			const recibo = {
				numero: r.recibo?.id_recibo ?? "",
				fecha: fechaSnapshot,
				hora: horaLocal(),
				items: itemsSnapshot,
				observacion: obsSnapshot,
				total: totalSnapshot,
			};

			// 1) Imprime de una (sale primero el original y luego la copia de archivo)
			if (autoImprimir) imprimir({ tipo: "recibo", data: recibo, copias: COPIAS_RECIBO });

			// 2) Deja el formulario listo para el siguiente
			limpiarRecibo();
			notificar(`Recibo N° ${numRecibo(recibo.numero)} guardado`);

			// 3) Correo en segundo plano
			if (correoOk) {
				enviarCorreo(recibo, correoDestino)
					.then(() => notificar("Correo enviado a " + correoDestino))
					.catch((e) =>
						notificar("Guardado, pero falló el correo: " + (e.text || e.message || "error"), "error")
					);
			}
		} catch (e) {
			// Si falla, NO se borra lo que estaba armado: se puede reintentar
			notificar("No se pudo guardar: " + (e.message || "error"), "error");
		} finally {
			setEmitiendo(false);
		}
	};

	return (
		<div className="rc-app">
			<header className="rc-top no-print">
				<div className="rc-brand">
					<span className="rc-mark">IC</span>
					<div>
						<div className="rc-brand-name">Instituto Pedagógico Crear</div>
						<div className="rc-brand-sub">Recibos de caja</div>
					</div>
				</div>

				<nav className="rc-tabs">
					{[
						["recibos", "Recibos"],
						["estudiantes", "Estudiantes"],
						["conceptos", "Conceptos"],
						["analisis", "Análisis"],
					].map(([k, l]) => (
						<button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
							{l}
						</button>
					))}
				</nav>

				<button className="rc-refresh" onClick={actualizar} disabled={refrescando} title="Actualizar datos">
					<span className={refrescando ? "spin" : ""}>↻</span>
					{refrescando ? "Actualizando…" : "Actualizar"}
				</button>
			</header>

			{/* ---------------- RECIBOS ---------------- */}
			{tab === "recibos" && (
				<main className="rc-main no-print">
					<section className="rc-card">
						<h2 className="rc-h2">Nuevo recibo</h2>

						<div className="rc-add-grid">
							<div className="rc-field">
								<label>Grado</label>
								<select
									value={gradoSel}
									onChange={(e) => {
										setGradoSel(e.target.value);
										setNinoSel("");
									}}
								>
									<option value="">—</option>
									{grados.map((g) => (
										<option key={g} value={g}>
											{g}
										</option>
									))}
								</select>
							</div>

							<div className="rc-field">
								<label>Estudiante</label>
								<select value={ninoSel} onChange={(e) => setNinoSel(e.target.value)} disabled={!gradoSel}>
									<option value="">—</option>
									{ninosDelGrado.map((n) => {
										const id = idNinoDe(n);
										return (
											<option key={id} value={id}>
												{n.nombre_completo}
											</option>
										);
									})}
								</select>
							</div>

							<div className="rc-field">
								<label>Concepto</label>
								<select value={conceptoSel} onChange={(e) => setConceptoSel(e.target.value)}>
									<option value="">—</option>
									{conceptos.map((c) => (
										<option key={c.id_concepto} value={c.id_concepto}>
											{c.concepto} · {COP(c.valor)}
										</option>
									))}
								</select>
							</div>

							<button className="rc-add-btn" onClick={agregarItem} disabled={emitiendo}>
								+ Agregar
							</button>
						</div>

						<p className="rc-hint">
							¿Hermanos? Cambia el grado y el estudiante y agrega otro ítem al mismo recibo.
						</p>

						{items.length > 0 && (
							<ul className="rc-items">
								{items.map((it, i) => (
									<li key={i}>
										<div className="rc-item-main">
											<span className="rc-item-name">{it.estudiante}</span>
											<span className="rc-item-grade">{it.grado}</span>
										</div>
										<span className="rc-item-concept">{it.concepto}</span>
										<span className="rc-item-value">{COP(it.valor)}</span>
										<button
											className="rc-item-del"
											onClick={() => quitarItem(i)}
											aria-label="Quitar"
											disabled={emitiendo}
										>
											×
										</button>
									</li>
								))}
							</ul>
						)}

						{items.length > 0 && (
							<p className="rc-hint">
								{esCorreoValido(items[0].acudiente)
									? `El recibo se enviará a: ${items[0].acudiente}`
									: "⚠ Este acudiente no tiene correo válido: se guarda e imprime, pero no se envía correo."}
							</p>
						)}

						<div className="rc-bottom">
							<div className="rc-field rc-field-date">
								<label>Fecha</label>
								<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
							</div>
							<div className="rc-field rc-field-obs">
								<label>Observación</label>
								<input
									type="text"
									value={observacion}
									onChange={(e) => setObservacion(e.target.value)}
									placeholder="Ej: mes de agosto"
								/>
							</div>
							<div className="rc-total">
								<span>Total</span>
								<strong>{COP(total)}</strong>
							</div>
						</div>

						<div className="rc-actions">
							<label className="rc-toggle">
								<input
									type="checkbox"
									checked={autoImprimir}
									onChange={(e) => cambiarAutoImprimir(e.target.checked)}
								/>
								<span>Imprimir 2 copias al guardar</span>
							</label>
							<button className="rc-ghost" onClick={limpiarRecibo} disabled={emitiendo}>
								Limpiar
							</button>
							<button
								className="rc-primary"
								onClick={emitirYEnviar}
								disabled={items.length === 0 || emitiendo}
							>
								{emitiendo ? "Guardando…" : autoImprimir ? "Guardar e imprimir" : "Guardar y enviar"}
							</button>
						</div>
					</section>
				</main>
			)}

			{tab === "estudiantes" && (
				<CrudEstudiantes ninos={ninos} setNinos={setNinos} grados={grados} notificar={notificar} />
			)}

			{tab === "conceptos" && (
				<CrudConceptos conceptos={conceptos} setConceptos={setConceptos} notificar={notificar} />
			)}

			{tab === "analisis" && (
				<Analisis ninos={ninos} conceptos={conceptos} notificar={notificar} imprimir={imprimir} />
			)}

			{/* ---------------- IMPRIMIBLE (oculto en pantalla) ---------------- */}
			{printJob && (
				<div
					className={`print-area ${printJob.tipo === "resumen" ? "print-carta" : "print-ticket"}`}
					key={printJob.n}
				>
					{printJob.tipo === "recibo" &&
						printJob.copias.map((c) => <Ticket key={c} copia={c} data={printJob.data} />)}
					{printJob.tipo === "resumen" && <ResumenCarta data={printJob.data} />}
				</div>
			)}

			{toast && (
				<div key={toast.n} className={`rc-toast ${toast.tipo} no-print`}>
					{toast.msg}
				</div>
			)}
		</div>
	);
};

/* ======================================================
   TICKETS IMPRIMIBLES
   ====================================================== */
function Ticket({ copia, data }) {
	return (
		<div className="ticket">
			<div className="t-inst">{NOMBRE_COLEGIO}</div>
			<div className="t-sub">Recibo de caja</div>
			<div className="t-copia">{copia}</div>

			<div className="t-row t-big">
				<span>N° {numRecibo(data.numero)}</span>
				<span>{fmtFecha(data.fecha)}{data.hora ? ` ${data.hora}` : ""}</span>
			</div>
			<div className="t-dash" />

			{data.items.map((it, i) => (
				<div className="t-item" key={i}>
					<div className="t-est">{it.estudiante}</div>
					<div className="t-gr">{it.grado}</div>
					<div className="t-row">
						<span>{it.concepto}</span>
						<b>{COP(it.valor)}</b>
					</div>
				</div>
			))}

			{data.observacion ? (
				<>
					<div className="t-dash" />
					<div className="t-obs">Obs: {data.observacion}</div>
				</>
			) : null}

			<div className="t-dash" />
			<div className="t-total">
				<span>TOTAL</span>
				<b>{COP(data.total)}</b>
			</div>
			<div className="t-dash" />

			<div className="t-firma">Recibió: ______________________</div>
			<div className="t-foot">Conserve este recibo · Gracias</div>
		</div>
	);
}

/* ======================================================
   RESUMEN GERENCIAL — hoja carta (impresora normal)
   ====================================================== */
function ResumenCarta({ data }) {
	const pct = (v) => (data.total ? `${((v / data.total) * 100).toFixed(1)}%` : "0%");
	return (
		<div className="rs-hoja">
			<header className="rs-head">
				<div className="rs-marca">IC</div>
				<div className="rs-titulos">
					<div className="rs-inst">Instituto Pedagógico Crear</div>
					<div className="rs-tit">Informe de recaudo · Cierre de caja</div>
				</div>
				<div className="rs-meta">
					<div><span>Periodo</span><b>{data.periodo}</b></div>
					<div><span>Impreso</span><b>{data.generado}</b></div>
				</div>
			</header>

			<section className="rs-kpis">
				<div className="rs-kpi rs-kpi-main">
					<span>Debe haber en caja</span>
					<b>{COP(data.total)}</b>
				</div>
				<div className="rs-kpi">
					<span>Recibos válidos</span>
					<b>{data.recibosActivos}</b>
					{data.rango && <small>N° {data.rango}</small>}
				</div>
				<div className="rs-kpi">
					<span>Ítems cobrados</span>
					<b>{data.itemsActivos}</b>
				</div>
				<div className="rs-kpi">
					<span>Anulados</span>
					<b>{data.recibosAnulados}</b>
					{data.recibosAnulados > 0 && <small>{COP(data.valorAnulado)} (no suman)</small>}
				</div>
			</section>

			<h3 className="rs-h3">Cuadre por concepto</h3>
			<table className="rs-tabla">
				<thead>
					<tr>
						<th>Concepto</th>
						<th className="rs-r">Tarifa</th>
						<th className="rs-r">Cantidad</th>
						<th className="rs-r">Total</th>
						<th className="rs-r">%</th>
					</tr>
				</thead>
				<tbody>
					{data.conceptos.map((c) => (
						<tr key={c.concepto} className={c.cantidad === 0 ? "rs-cero" : ""}>
							<td>{c.concepto}</td>
							<td className="rs-r">{c.tarifa == null ? "—" : COP(c.tarifa)}</td>
							<td className="rs-r">{c.cantidad}</td>
							<td className="rs-r"><b>{COP(c.total)}</b></td>
							<td className="rs-r">{pct(c.total)}</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr>
						<td>Total</td>
						<td />
						<td className="rs-r">{data.itemsActivos}</td>
						<td className="rs-r">{COP(data.total)}</td>
						<td className="rs-r">100%</td>
					</tr>
				</tfoot>
			</table>

			{data.porDia.length > 1 && (
				<>
					<h3 className="rs-h3">Recaudo por día</h3>
					<table className="rs-tabla">
						<thead>
							<tr>
								<th>Fecha</th>
								<th className="rs-r">Recibos</th>
								<th className="rs-r">Total</th>
							</tr>
						</thead>
						<tbody>
							{data.porDia.map((d) => (
								<tr key={d.fecha}>
									<td>{d.etiqueta}</td>
									<td className="rs-r">{d.recibos}</td>
									<td className="rs-r"><b>{COP(d.total)}</b></td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}

			<h3 className="rs-h3">Detalle de recibos</h3>
			{data.detalle.length === 0 ? (
				<p className="rs-vacio">No hay recibos en este periodo.</p>
			) : (
				<table className="rs-tabla rs-detalle">
					<thead>
						<tr>
							<th>N°</th>
							<th>Fecha</th>
							<th>Estudiante</th>
							<th>Grado</th>
							<th>Concepto</th>
							<th className="rs-r">Valor</th>
							<th>Estado</th>
						</tr>
					</thead>
					<tbody>
						{data.detalle.map((g) =>
							g.items.map((it, i) => (
								<tr
									key={`${g.id_recibo}-${i}`}
									className={`${g.estado === "ANULADO" ? "rs-anulado" : ""} ${i === 0 ? "rs-primera" : ""}`}
								>
									<td>{i === 0 ? numRecibo(g.id_recibo) : ""}</td>
									<td>{i === 0 ? fmtFecha(g.fecha) : ""}</td>
									<td>{it.estudiante}</td>
									<td>{it.grado}</td>
									<td>{it.concepto}</td>
									<td className="rs-r">{COP(it.valor)}</td>
									<td>
										{i === 0
											? g.estado === "ANULADO"
												? `Anulado${g.motivo ? ` · ${g.motivo}` : ""}`
												: "Válido"
											: ""}
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			)}
		</div>
	);
}

/* ======================================================
   CRUD ESTUDIANTES (optimistic)
   ====================================================== */
function CrudEstudiantes({ ninos, setNinos, grados, notificar }) {
	const vacio = { nombre_completo: "", grado: "", acudiente: "", telefono: "" };
	const [form, setForm] = useState(vacio);
	const [guardando, setGuardando] = useState(false);

	const nextId = useMemo(() => {
		let max = 0;
		ninos.forEach((n) => {
			const v = parseInt(idNinoDe(n), 10);
			if (!isNaN(v) && v > max) max = v;
		});
		return max + 1;
	}, [ninos]);

	const guardar = async () => {
		if (guardando) return;
		if (!form.nombre_completo || !form.grado) {
			notificar("Nombre y grado son obligatorios", "error");
			return;
		}
		setGuardando(true);

		const optimista = {
			rowId: "temp-" + Date.now(),
			"id_niño": nextId,
			id_ni_o: nextId,
			...form,
			_pending: true,
		};
		const prev = ninos;
		const lista = [...ninos, optimista];
		setNinos(lista);
		setCache("Niños", lista);
		const formGuardado = { ...form };
		setForm(vacio);

		try {
			const r = await postAction({
				action: "create",
				sheet: "Niños",
				data: { "id_niño": nextId, ...formGuardado },
			});
			if (r.status !== "success") throw new Error(r.message);

			const confirmada = lista.map((n) => (n.rowId === optimista.rowId ? { ...n, _pending: false } : n));
			setNinos(confirmada);
			setCache("Niños", confirmada);
			notificar("Estudiante creado");
		} catch (e) {
			setNinos(prev);
			setCache("Niños", prev);
			setForm(formGuardado);
			notificar("No se pudo crear: " + (e.message || "error"), "error");
		} finally {
			setGuardando(false);
		}
	};

	return (
		<main className="rc-main no-print">
			<section className="rc-card">
				<h2 className="rc-h2">Nuevo estudiante</h2>
				<div className="rc-form-grid">
					<div className="rc-field">
						<label>Nombre completo</label>
						<input
							value={form.nombre_completo}
							onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })}
						/>
					</div>
					<div className="rc-field">
						<label>Grado</label>
						<input
							value={form.grado}
							onChange={(e) => setForm({ ...form, grado: e.target.value })}
							placeholder="Ej: FIRST GRADE"
							list="rc-grados"
						/>
						<datalist id="rc-grados">
							{grados.map((g) => (
								<option key={g} value={g} />
							))}
						</datalist>
					</div>
					<div className="rc-field">
						<label>Acudiente (correo)</label>
						<input
							type="email"
							value={form.acudiente}
							onChange={(e) => setForm({ ...form, acudiente: e.target.value })}
							placeholder="correo@ejemplo.com"
						/>
					</div>
					<div className="rc-field">
						<label>Teléfono</label>
						<input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
					</div>
				</div>
				<div className="rc-actions">
					<button className="rc-primary" onClick={guardar} disabled={guardando}>
						{guardando ? "Guardando…" : "Crear estudiante"}
					</button>
				</div>
			</section>

			<section className="rc-card">
				<h2 className="rc-h2">Estudiantes ({ninos.length})</h2>
				<div className="rc-table-wrap">
					<table className="rc-table">
						<thead>
							<tr>
								<th>Nombre</th>
								<th>Grado</th>
								<th>Acudiente (correo)</th>
								<th>Teléfono</th>
							</tr>
						</thead>
						<tbody>
							{ninos.map((n, i) => (
								<tr key={n.rowId ?? i} className={n._pending ? "rc-pending" : ""}>
									<td>{n.nombre_completo}</td>
									<td>{n.grado}</td>
									<td>{n.acudiente}</td>
									<td>{n.telefono}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</main>
	);
}

/* ======================================================
   CRUD CONCEPTOS (optimistic)
   ====================================================== */
function CrudConceptos({ conceptos, setConceptos, notificar }) {
	const [form, setForm] = useState({ concepto: "", valor: "" });
	const [guardando, setGuardando] = useState(false);

	const nextId = useMemo(() => {
		let max = 0;
		conceptos.forEach((c) => {
			const v = parseInt(c.id_concepto, 10);
			if (!isNaN(v) && v > max) max = v;
		});
		return max + 1;
	}, [conceptos]);

	const guardar = async () => {
		if (guardando) return;
		if (!form.concepto || !form.valor) {
			notificar("Concepto y valor son obligatorios", "error");
			return;
		}
		setGuardando(true);

		const optimista = {
			rowId: "temp-" + Date.now(),
			id_concepto: nextId,
			concepto: form.concepto,
			valor: Number(form.valor),
			_pending: true,
		};
		const prev = conceptos;
		const lista = [...conceptos, optimista];
		setConceptos(lista);
		setCache("Conceptos", lista);
		const formGuardado = { ...form };
		setForm({ concepto: "", valor: "" });

		try {
			const r = await postAction({
				action: "create",
				sheet: "Conceptos",
				data: { id_concepto: nextId, concepto: formGuardado.concepto, valor: Number(formGuardado.valor) },
			});
			if (r.status !== "success") throw new Error(r.message);

			const confirmada = lista.map((c) => (c.rowId === optimista.rowId ? { ...c, _pending: false } : c));
			setConceptos(confirmada);
			setCache("Conceptos", confirmada);
			notificar("Concepto creado");
		} catch (e) {
			setConceptos(prev);
			setCache("Conceptos", prev);
			setForm(formGuardado);
			notificar("No se pudo crear: " + (e.message || "error"), "error");
		} finally {
			setGuardando(false);
		}
	};

	return (
		<main className="rc-main no-print">
			<section className="rc-card">
				<h2 className="rc-h2">Nuevo concepto</h2>
				<div className="rc-form-grid">
					<div className="rc-field">
						<label>Concepto</label>
						<input
							value={form.concepto}
							onChange={(e) => setForm({ ...form, concepto: e.target.value })}
							placeholder="Ej: Pensión mensual"
						/>
					</div>
					<div className="rc-field">
						<label>Valor</label>
						<input
							type="number"
							value={form.valor}
							onChange={(e) => setForm({ ...form, valor: e.target.value })}
							placeholder="350000"
						/>
					</div>
				</div>
				<div className="rc-actions">
					<button className="rc-primary" onClick={guardar} disabled={guardando}>
						{guardando ? "Guardando…" : "Crear concepto"}
					</button>
				</div>
			</section>

			<section className="rc-card">
				<h2 className="rc-h2">Conceptos ({conceptos.length})</h2>
				<div className="rc-table-wrap">
					<table className="rc-table">
						<thead>
							<tr>
								<th>Concepto</th>
								<th className="rc-right">Valor</th>
							</tr>
						</thead>
						<tbody>
							{conceptos.map((c, i) => (
								<tr key={c.rowId ?? i} className={c._pending ? "rc-pending" : ""}>
									<td>{c.concepto}</td>
									<td className="rc-right">{COP(c.valor)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</main>
	);
}

/* ======================================================
   ANÁLISIS (protegido con clave)
   Periodo compartido: Recaudo / Ver recibos / Resumen impreso
   ====================================================== */
function Analisis({ ninos, conceptos, notificar, imprimir }) {
	const [ok, setOk] = useState(false);
	const [clave, setClave] = useState("");
	const [recibos, setRecibos] = useState([]);
	const [cargando, setCargando] = useState(false);
	const [vista, setVista] = useState("recaudo"); // "recaudo" | "verrecibos"
	const [verResumen, setVerResumen] = useState(false);

	// Periodo
	const [modo, setModo] = useState("dia"); // dia | semana | mes | todo
	const [refISO, setRefISO] = useState(hoyISO());

	const cargarRecibos = async () => {
		setCargando(true);
		try {
			setRecibos(await getSheet("Recibos"));
		} catch {
			notificar("No se pudieron cargar los recibos", "error");
		} finally {
			setCargando(false);
		}
	};

	const entrar = () => {
		if (clave.trim() === CLAVE_ANALISIS) {
			setOk(true);
			cargarRecibos();
		} else {
			notificar("Clave incorrecta", "error");
		}
	};

	const rango = useMemo(() => rangoPeriodo(modo, refISO), [modo, refISO]);

	// Filas de la hoja dentro del periodo
	const filasPeriodo = useMemo(() => {
		if (!rango.desde) return recibos;
		return recibos.filter((r) => {
			const d = parseFecha(r.fecha);
			if (!d) return false;
			const k = isoLocal(d);
			return k >= rango.desde && k <= rango.hasta;
		});
	}, [recibos, rango]);

	const grupos = useMemo(() => agruparRecibos(filasPeriodo), [filasPeriodo]);
	const activos = useMemo(() => grupos.filter((g) => g.estado !== "ANULADO"), [grupos]);
	const anulados = useMemo(() => grupos.filter((g) => g.estado === "ANULADO"), [grupos]);

	const totalPeriodo = useMemo(() => activos.reduce((a, g) => a + g.total, 0), [activos]);
	const valorAnulado = useMemo(() => anulados.reduce((a, g) => a + g.total, 0), [anulados]);
	const itemsActivos = useMemo(() => activos.reduce((a, g) => a + g.items.length, 0), [activos]);

	// Cuadre por concepto: todos los conceptos creados (aunque estén en 0) + los que aparezcan en recibos
	const cuadre = useMemo(() => {
		const map = new Map();
		const norm = (s) => (s ?? "").toString().trim();
		conceptos.forEach((c) => {
			const k = norm(c.concepto);
			if (k && !map.has(k)) map.set(k, { concepto: k, tarifa: Number(c.valor) || 0, cantidad: 0, total: 0 });
		});
		activos.forEach((g) =>
			g.items.forEach((it) => {
				const k = norm(it.concepto) || "Otro";
				if (!map.has(k)) map.set(k, { concepto: k, tarifa: null, cantidad: 0, total: 0 });
				const row = map.get(k);
				row.cantidad += 1;
				row.total += it.valor;
			})
		);
		return [...map.values()].sort((a, b) => b.total - a.total || a.concepto.localeCompare(b.concepto, "es"));
	}, [conceptos, activos]);

	// Serie para el gráfico: por día (semana/mes) o por mes (todo)
	const serie = useMemo(() => {
		if (modo === "dia") return [];
		const map = new Map();
		activos.forEach((g) => {
			const d = parseFecha(g.fecha);
			if (!d) return;
			const k = modo === "todo" ? isoLocal(d).slice(0, 7) : isoLocal(d);
			map.set(k, (map.get(k) || 0) + g.total);
		});
		return [...map.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([k, valor]) => {
				let periodo = k;
				if (k.length === 10) {
					const d = parseFecha(k);
					periodo = `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}`;
				} else {
					periodo = `${MESES[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}`;
				}
				return { periodo, valor };
			});
	}, [activos, modo]);

	// Datos del resumen gerencial (hoja carta)
	const datosResumen = useMemo(() => {
		const nums = activos.map((g) => Number(g.id_recibo)).filter((n) => !isNaN(n));
		const dias = new Map();
		activos.forEach((g) => {
			const d = parseFecha(g.fecha);
			if (!d) return;
			const k = isoLocal(d);
			const row = dias.get(k) || { fecha: k, recibos: 0, total: 0 };
			row.recibos += 1;
			row.total += g.total;
			dias.set(k, row);
		});
		return {
			periodo: rango.label,
			generado: `${fmtFecha(hoyISO())} ${horaLocal()}`,
			recibosActivos: activos.length,
			recibosAnulados: anulados.length,
			valorAnulado,
			itemsActivos,
			rango: nums.length ? `${numRecibo(Math.min(...nums))} – ${numRecibo(Math.max(...nums))}` : "",
			conceptos: cuadre.filter((c) => c.cantidad > 0),
			total: totalPeriodo,
			porDia: [...dias.values()]
				.sort((a, b) => a.fecha.localeCompare(b.fecha))
				.map((d) => {
					const f = parseFecha(d.fecha);
					return { ...d, etiqueta: `${DIAS[f.getDay()]} ${fmtFecha(d.fecha)}` };
				}),
			detalle: [...grupos].sort((a, b) => Number(a.id_recibo) - Number(b.id_recibo)),
		};
	}, [activos, anulados, grupos, cuadre, rango, valorAnulado, itemsActivos, totalPeriodo]);

	// Abre el diálogo normal del navegador → elegir la impresora carta
	const imprimirResumen = () => imprimir({ tipo: "resumen", data: datosResumen });

	// ---- Pantalla de clave ----
	if (!ok) {
		return (
			<main className="rc-main no-print">
				<section className="rc-card rc-lock">
					<div className="rc-lock-icon">🔒</div>
					<h2 className="rc-h2">Análisis protegido</h2>
					<p className="rc-hint" style={{ marginBottom: 16 }}>
						Ingresa la clave para ver los reportes de recaudo.
					</p>
					<div className="rc-lock-row">
						<input
							type="password"
							value={clave}
							onChange={(e) => setClave(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && entrar()}
							placeholder="Clave"
							className="rc-lock-input"
							autoFocus
						/>
						<button className="rc-primary" onClick={entrar}>
							Entrar
						</button>
					</div>
				</section>
			</main>
		);
	}

	return (
		<main className="rc-main rc-main-wide no-print">
			{/* ---- Barra de periodo (aplica a todo el análisis) ---- */}
			<section className="rc-card rc-periodo">
				<div className="rc-periodo-top">
					<div className="rc-seg">
						<button className={vista === "recaudo" ? "on" : ""} onClick={() => setVista("recaudo")}>
							Recaudo
						</button>
						<button className={vista === "verrecibos" ? "on" : ""} onClick={() => setVista("verrecibos")}>
							Ver recibos
						</button>
					</div>

					<div className="rc-periodo-acciones">
						<button className="rc-refresh" onClick={cargarRecibos} disabled={cargando}>
							<span className={cargando ? "spin" : ""}>↻</span>
							{cargando ? "Cargando…" : "Recargar"}
						</button>
						<button className="rc-btn-resumen" onClick={() => setVerResumen(true)} disabled={cargando}>
							⎙ Resumen
						</button>
					</div>
				</div>

				<div className="rc-periodo-bottom">
					<div className="rc-seg">
						{[
							["dia", "Día"],
							["semana", "Semana"],
							["mes", "Mes"],
							["todo", "Todo"],
						].map(([k, l]) => (
							<button key={k} className={modo === k ? "on" : ""} onClick={() => setModo(k)}>
								{l}
							</button>
						))}
					</div>

					{modo !== "todo" && (
						<div className="rc-nav">
							<button onClick={() => setRefISO(moverReferencia(modo, refISO, -1))} aria-label="Anterior">
								‹
							</button>
							{modo === "mes" ? (
								<input
									type="month"
									value={refISO.slice(0, 7)}
									onChange={(e) => e.target.value && setRefISO(`${e.target.value}-01`)}
								/>
							) : (
								<input
									type="date"
									value={refISO}
									onChange={(e) => e.target.value && setRefISO(e.target.value)}
								/>
							)}
							<button onClick={() => setRefISO(moverReferencia(modo, refISO, 1))} aria-label="Siguiente">
								›
							</button>
							<button className="rc-hoy" onClick={() => setRefISO(hoyISO())}>
								Hoy
							</button>
						</div>
					)}

					<div className="rc-periodo-label">{rango.label}</div>
				</div>
			</section>

			{vista === "recaudo" ? (
				<>
					{/* ---- KPIs ---- */}
					<section className="rc-stats rc-stats-4">
						<div className="rc-stat rc-stat-main">
							<span>Debe haber en caja</span>
							<strong>{COP(totalPeriodo)}</strong>
						</div>
						<div className="rc-stat">
							<span>Recibos válidos</span>
							<strong>{activos.length}</strong>
						</div>
						<div className="rc-stat">
							<span>Ítems cobrados</span>
							<strong>{itemsActivos}</strong>
						</div>
						<div className="rc-stat rc-stat-err">
							<span>Anulados</span>
							<strong>{anulados.length}</strong>
							{anulados.length > 0 && <small>{COP(valorAnulado)} fuera del total</small>}
						</div>
					</section>

					{/* ---- Cuadre por concepto ---- */}
					<section className="rc-card">
						<div className="rc-card-head">
							<h2 className="rc-h2" style={{ margin: 0 }}>Cuadre por concepto</h2>
							<span className="rc-hint" style={{ margin: 0 }}>{rango.label}</span>
						</div>

						<div className="rc-table-wrap">
							<table className="rc-table rc-cuadre">
								<thead>
									<tr>
										<th>Concepto</th>
										<th className="rc-right">Tarifa</th>
										<th className="rc-right">Cant.</th>
										<th className="rc-right">Total</th>
										<th className="rc-col-part">Participación</th>
									</tr>
								</thead>
								<tbody>
									{cuadre.length === 0 ? (
										<tr>
											<td colSpan={5} className="rc-vacio">Aún no hay conceptos.</td>
										</tr>
									) : (
										cuadre.map((c) => {
											const pct = totalPeriodo ? (c.total / totalPeriodo) * 100 : 0;
											return (
												<tr key={c.concepto} className={c.cantidad === 0 ? "rc-cero" : ""}>
													<td>{c.concepto}</td>
													<td className="rc-right rc-num">{c.tarifa == null ? "—" : COP(c.tarifa)}</td>
													<td className="rc-right rc-num">{c.cantidad}</td>
													<td className="rc-right rc-num"><b>{COP(c.total)}</b></td>
													<td className="rc-col-part">
														<div className="rc-barra">
															<i style={{ width: `${pct}%` }} />
														</div>
														<span className="rc-pct">{pct.toFixed(0)}%</span>
													</td>
												</tr>
											);
										})
									)}
								</tbody>
								<tfoot>
									<tr>
										<td>Total</td>
										<td />
										<td className="rc-right rc-num">{itemsActivos}</td>
										<td className="rc-right rc-num">{COP(totalPeriodo)}</td>
										<td className="rc-col-part" />
									</tr>
								</tfoot>
							</table>
						</div>
					</section>

					{/* ---- Gráfico (semana / mes / todo) ---- */}
					{modo !== "dia" && (
						<section className="rc-card">
							<h2 className="rc-h2">
								Recaudo {modo === "todo" ? "por mes" : "por día"}
							</h2>
							{serie.length === 0 ? (
								<p className="rc-hint">No hay recibos en este periodo.</p>
							) : (
								<div style={{ width: "100%", height: 260 }}>
									<ResponsiveContainer>
										<BarChart data={serie} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
											<CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" vertical={false} />
											<XAxis dataKey="periodo" tick={{ fontSize: 12 }} />
											<YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
											<Tooltip formatter={(v) => COP(v)} />
											<Bar dataKey="valor" fill="#1b2a4a" radius={[6, 6, 0, 0]} />
										</BarChart>
									</ResponsiveContainer>
								</div>
							)}
						</section>
					)}
				</>
			) : (
				<VerRecibos
					grupos={grupos}
					setRecibos={setRecibos}
					ninos={ninos}
					cargando={cargando}
					notificar={notificar}
					imprimir={imprimir}
					totalPeriodo={totalPeriodo}
					activos={activos.length}
				/>
			)}

			{verResumen && (
				<div className="rc-modal no-print" onClick={() => setVerResumen(false)}>
					<div className="rc-modal-bar" onClick={(e) => e.stopPropagation()}>
						<div>
							<b>Resumen · {rango.label}</b>
							<span>Se imprime en hoja carta — elige tu impresora normal en el diálogo.</span>
						</div>
						<div className="rc-modal-btns">
							<button className="rc-ghost" onClick={() => setVerResumen(false)}>
								Cerrar
							</button>
							<button className="rc-primary" onClick={imprimirResumen}>
								⎙ Imprimir
							</button>
						</div>
					</div>
					<div className="rc-modal-hoja" onClick={(e) => e.stopPropagation()}>
						<ResumenCarta data={datosResumen} />
					</div>
				</div>
			)}
		</main>
	);
}

/* ======================================================
   VER / ANULAR / REIMPRIMIR RECIBOS
   ====================================================== */
function VerRecibos({ grupos, setRecibos, ninos, cargando, notificar, imprimir, totalPeriodo, activos }) {
	const [busqueda, setBusqueda] = useState("");
	const [anulandoId, setAnulandoId] = useState(null);
	const [confirmando, setConfirmando] = useState(null);
	const [motivo, setMotivo] = useState("");

	const filtrados = useMemo(() => {
		const q = busqueda.trim().toLowerCase();
		if (!q) return grupos;
		return grupos.filter(
			(r) =>
				r.id_recibo.includes(q.replace(/^0+/, "")) ||
				r.items.some(
					(it) =>
						(it.estudiante ?? "").toLowerCase().includes(q) ||
						(it.concepto ?? "").toLowerCase().includes(q)
				)
		);
	}, [grupos, busqueda]);

	const correoDelRecibo = (recibo) => {
		const primer = recibo.items[0];
		if (!primer) return "";
		const nino = ninos.find((n) => (n.nombre_completo ?? "") === primer.estudiante);
		return (nino?.acudiente ?? "").toString().trim();
	};

	const enviarCorreoAnulacion = (recibo, correoDestino, motivoTexto) => {
		const lineasItems = recibo.items
			.map((it) => `${it.estudiante} (${it.grado}) — ${it.concepto}: ${COP(it.valor)}`)
			.join("\n");

		return emailjs.send(
			EMAILJS_SERVICE,
			EMAILJS_TEMPLATE,
			{
				email: correoDestino,
				numero_recibo: numRecibo(recibo.id_recibo),
				fecha: fmtFecha(recibo.fecha),
				items: lineasItems,
				observacion: motivoTexto ? `ANULADO · ${motivoTexto}` : recibo.observacion || "ANULADO",
				total: COP(recibo.total),
				estado_banner: BANNER_ANULADO,
			},
			{ publicKey: EMAILJS_PUBLIC_KEY }
		);
	};

	const anular = async (recibo) => {
		if (anulandoId) return;
		setAnulandoId(recibo.id_recibo);

		const correoDestino = correoDelRecibo(recibo);
		const motivoTexto = motivo;

		try {
			const r = await postAction({ action: "anular_recibo", id_recibo: recibo.id_recibo, motivo: motivoTexto });
			if (r.status !== "success") throw new Error(r.message);

			notificar("Recibo N° " + numRecibo(recibo.id_recibo) + " anulado");
			setRecibos((prev) =>
				prev.map((row) =>
					(row.id_recibo ?? "").toString() === recibo.id_recibo ? { ...row, estado: "ANULADO" } : row
				)
			);

			if (esCorreoValido(correoDestino)) {
				enviarCorreoAnulacion(recibo, correoDestino, motivoTexto)
					.then(() => notificar("Correo de anulación enviado a " + correoDestino))
					.catch((e) =>
						notificar("Anulado, pero falló el correo: " + (e.text || e.message || "error"), "error")
					);
			}
		} catch (e) {
			notificar("No se pudo anular: " + (e.message || "error"), "error");
		} finally {
			setAnulandoId(null);
			setConfirmando(null);
			setMotivo("");
		}
	};

	const reimprimir = (r) =>
		imprimir({
			tipo: "recibo",
			copias: ["COPIA · REIMPRESIÓN"],
			data: { numero: r.id_recibo, fecha: r.fecha, items: r.items, observacion: r.observacion, total: r.total },
		});

	return (
		<section className="rc-card">
			<div className="rc-card-head">
				<div>
					<h2 className="rc-h2" style={{ margin: 0 }}>Recibos emitidos</h2>
					<p className="rc-hint" style={{ margin: "4px 0 0" }}>
						{activos} válidos · {COP(totalPeriodo)}
						{grupos.length !== activos ? ` · ${grupos.length - activos} anulados` : ""}
					</p>
				</div>
				<input
					type="text"
					value={busqueda}
					onChange={(e) => setBusqueda(e.target.value)}
					placeholder="Buscar N°, estudiante o concepto"
					className="rc-lock-input rc-buscar"
				/>
			</div>

			{filtrados.length === 0 ? (
				<p className="rc-hint">{cargando ? "Cargando recibos…" : "No hay recibos en este periodo."}</p>
			) : (
				<ul className="rc-items">
					{filtrados.map((r) => (
						<li key={r.id_recibo} className={`rc-recibo-row ${r.estado === "ANULADO" ? "is-anulado" : ""}`}>
							<div className="rc-recibo-id">
								<span className="rc-item-name">N° {numRecibo(r.id_recibo)}</span>
								<span className="rc-item-grade">{fmtFecha(r.fecha)}</span>
							</div>

							<div className="rc-recibo-items">
								{r.items.map((it, i) => (
									<div key={i}>
										<b>{it.estudiante}</b> · {it.concepto} · {COP(it.valor)}
									</div>
								))}
								{r.observacion ? <div className="rc-recibo-obs">{r.observacion}</div> : null}
							</div>

							<span className="rc-item-value">{COP(r.total)}</span>

							{r.estado === "ANULADO" ? (
								<span className="rc-badge-anulado">ANULADO</span>
							) : confirmando === r.id_recibo ? (
								<div className="rc-confirm-row">
									<input
										type="text"
										value={motivo}
										onChange={(e) => setMotivo(e.target.value)}
										placeholder="Motivo (opcional)"
										className="rc-lock-input"
									/>
									<button
										className="rc-btn-confirm-anular"
										onClick={() => anular(r)}
										disabled={anulandoId === r.id_recibo}
									>
										{anulandoId === r.id_recibo ? "Anulando…" : "Confirmar anulación"}
									</button>
									<button
										className="rc-ghost"
										onClick={() => {
											setConfirmando(null);
											setMotivo("");
										}}
										disabled={anulandoId === r.id_recibo}
									>
										Cancelar
									</button>
								</div>
							) : (
								<div className="rc-recibo-btns">
									<button className="rc-btn-sec" onClick={() => reimprimir(r)} title="Reimprimir">
										⎙
									</button>
									<button className="rc-btn-anular" onClick={() => setConfirmando(r.id_recibo)}>
										Anular
									</button>
								</div>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export default Home;