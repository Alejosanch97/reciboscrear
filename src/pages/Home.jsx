import { useState, useEffect, useMemo, useCallback } from "react";
import "../styles/home.css";
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
	LineChart,
	Line,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	PieChart,
	Pie,
	Cell,
	Legend,
} from "recharts";

const CLAVE_ANALISIS = "CREAR1966";

const COP = (n) =>
	new Intl.NumberFormat("es-CO", {
		style: "currency",
		currency: "COP",
		maximumFractionDigits: 0,
	}).format(Number(n) || 0);

const hoyISO = () => new Date().toISOString().slice(0, 10);

// id_niño puede llegar como "id_niño" o "id_ni_o" (versión limpia del backend)
const idNinoDe = (n) => (n.id_niño ?? n.id_ni_o ?? "").toString();

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
	const [reciboEmitido, setReciboEmitido] = useState(null);
	const [emitiendo, setEmitiendo] = useState(false); // bloquea doble clic

	const [gradoSel, setGradoSel] = useState("");
	const [ninoSel, setNinoSel] = useState("");
	const [conceptoSel, setConceptoSel] = useState("");

	const notificar = useCallback((msg, tipo = "ok") => {
		setToast({ msg, tipo });
		setTimeout(() => setToast(null), 3000);
	}, []);

	// Stale-while-revalidate: pinta caché y refresca en segundo plano
	useEffect(() => {
		const cachedN = getCachedThenRevalidate("Niños", (fresh) => setNinos(fresh));
		const cachedC = getCachedThenRevalidate("Conceptos", (fresh) => setConceptos(fresh));
		if (cachedN.length) setNinos(cachedN);
		if (cachedC.length) setConceptos(cachedC);
	}, []);

	// Botón actualizar
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
	const normGrado = (g) =>
		g.toString().trim().toLowerCase()
			.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
			.replace(/\s+/g, " ");

	const ordenGrados = [
		"pre jardin",
		"jardin",
		"transition",
		"first grade",
		"second grade",
		"third grade",
		"fourth grade",
		"fifth grade",
		"sixth grade",
		"seventh grade",
		"eighth grade",
		"ninth grade",
		"tenth grade",
		"eleventh grade",
	];

	const rankGrado = (g) => {
		const i = ordenGrados.indexOf(normGrado(g));
		return i === -1 ? 999 : i;
	};

	const grados = useMemo(() => {
		const set = new Set(ninos.map((n) => (n.grado ?? "").toString()).filter(Boolean));
		return [...set].sort((a, b) => {
			const ra = rankGrado(a);
			const rb = rankGrado(b);
			if (ra !== rb) return ra - rb;
			return a.localeCompare(b);
		});
	}, [ninos]);

	const ninosDelGrado = useMemo(
		() =>
			ninos
				.filter((n) => (n.grado ?? "").toString() === gradoSel)
				.sort((a, b) =>
					(a.nombre_completo ?? "").localeCompare(b.nombre_completo ?? "", "es")
				),
		[ninos, gradoSel]
	);

	const total = useMemo(
		() => items.reduce((acc, it) => acc + (Number(it.valor) || 0), 0),
		[items]
	);

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
				acudiente: nino.acudiente,
				id_concepto: concepto.id_concepto.toString(),
				concepto: concepto.concepto,
				valor: Number(concepto.valor) || 0,
			},
		]);
		setConceptoSel("");
		setReciboEmitido(null);
	};

	const quitarItem = (idx) => {
		setItems((prev) => prev.filter((_, i) => i !== idx));
		setReciboEmitido(null);
	};

	const limpiarRecibo = () => {
		setItems([]);
		setObservacion("");
		setReciboEmitido(null);
		setGradoSel("");
		setNinoSel("");
		setConceptoSel("");
	};

	const emitirEImprimir = async () => {
		// Guarda anti-doble-clic: si ya está emitiendo, no hace nada
		if (emitiendo) return;
		if (items.length === 0) {
			notificar("Agrega al menos un ítem", "error");
			return;
		}
		setEmitiendo(true);
		try {
			// Guarda TODOS los ítems en paralelo (mucho más rápido que uno por uno)
			const respuestas = await Promise.all(
				items.map((it) =>
					postAction({
						action: "emitir_recibo",
						id_niño: it.id_niño,
						id_concepto: it.id_concepto,
						fecha,
						observacion,
					})
				)
			);
			const falló = respuestas.find((r) => r.status !== "success");
			if (falló) throw new Error(falló.message || "Error al emitir");

			const numero = respuestas[0]?.recibo?.id_recibo ?? "";
			setReciboEmitido({ numero, fecha, items, observacion, total });
			setEmitiendo(false);
			// Pinta la vista y abre impresión enseguida
			setTimeout(() => window.print(), 150);
		} catch (e) {
			notificar(e.message, "error");
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
					<button className={tab === "recibos" ? "on" : ""} onClick={() => setTab("recibos")}>
						Recibos
					</button>
					<button className={tab === "estudiantes" ? "on" : ""} onClick={() => setTab("estudiantes")}>
						Estudiantes
					</button>
					<button className={tab === "conceptos" ? "on" : ""} onClick={() => setTab("conceptos")}>
						Conceptos
					</button>
					<button className={tab === "analisis" ? "on" : ""} onClick={() => setTab("analisis")}>
						Análisis
					</button>
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

							<button className="rc-add-btn" onClick={agregarItem}>
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
							<button className="rc-ghost" onClick={limpiarRecibo} disabled={emitiendo}>
								Limpiar
							</button>
							<button
								className="rc-primary"
								onClick={emitirEImprimir}
								disabled={items.length === 0 || emitiendo}
							>
								{emitiendo ? "Guardando…" : "Guardar e imprimir"}
							</button>
						</div>
					</section>
				</main>
			)}

			{/* ---------------- ESTUDIANTES ---------------- */}
			{tab === "estudiantes" && (
				<CrudEstudiantes ninos={ninos} setNinos={setNinos} grados={grados} notificar={notificar} />
			)}

			{/* ---------------- CONCEPTOS ---------------- */}
			{tab === "conceptos" && (
				<CrudConceptos conceptos={conceptos} setConceptos={setConceptos} notificar={notificar} />
			)}

			{/* ---------------- ANÁLISIS ---------------- */}
			{tab === "analisis" && <Analisis notificar={notificar} />}

			{/* ---------------- IMPRIMIBLE ---------------- */}
			{reciboEmitido && (
				<div className="print-area">
					<Ticket copia="RECIBO DE CAJA" data={reciboEmitido} />
				</div>
			)}

			{toast && <div className={`rc-toast ${toast.tipo} no-print`}>{toast.msg}</div>}
		</div>
	);
};

/* ---------- Ticket imprimible ---------- */
function Ticket({ copia, data }) {
	return (
		<div className="ticket">
			<div className="t-inst">INSTITUTO PEDAGÓGICO CREAR</div>
			<div className="t-copia">{copia}</div>
			<div className="t-dash" />
			<div className="t-row">
				<span>Recibo N°</span>
				<b>{String(data.numero).padStart(5, "0")}</b>
			</div>
			<div className="t-row">
				<span>Fecha</span>
				<b>{data.fecha}</b>
			</div>
			<div className="t-dash" />
			{data.items.map((it, i) => (
				<div className="t-item" key={i}>
					<div className="t-item-top">
						<span className="t-est">{it.estudiante}</span>
						<span className="t-gr">{it.grado}</span>
					</div>
					<div className="t-item-bot">
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
			<div className="t-foot">Válido únicamente con sello original.</div>
		</div>
	);
}

/* ---------- CRUD Estudiantes (optimistic) ---------- */
function CrudEstudiantes({ ninos, setNinos, grados, notificar }) {
	const [form, setForm] = useState({ nombre_completo: "", grado: "", acudiente: "", telefono: "" });
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
			nombre_completo: form.nombre_completo,
			grado: form.grado,
			acudiente: form.acudiente,
			telefono: form.telefono,
			_pending: true,
		};
		const prev = ninos;
		const lista = [...ninos, optimista];
		setNinos(lista);
		setCache("Niños", lista);
		const formGuardado = { ...form };
		setForm({ nombre_completo: "", grado: "", acudiente: "", telefono: "" });

		try {
			const r = await postAction({
				action: "create",
				sheet: "Niños",
				data: { "id_niño": nextId, ...formGuardado },
			});
			if (r.status !== "success") throw new Error(r.message);

			const confirmada = lista.map((n) =>
				n.rowId === optimista.rowId ? { ...n, _pending: false } : n
			);
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
						<label>Acudiente</label>
						<input
							value={form.acudiente}
							onChange={(e) => setForm({ ...form, acudiente: e.target.value })}
						/>
					</div>
					<div className="rc-field">
						<label>Teléfono</label>
						<input
							value={form.telefono}
							onChange={(e) => setForm({ ...form, telefono: e.target.value })}
						/>
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
								<th>Acudiente</th>
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

/* ---------- CRUD Conceptos (optimistic) ---------- */
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

			const confirmada = lista.map((c) =>
				c.rowId === optimista.rowId ? { ...c, _pending: false } : c
			);
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
   ====================================================== */
const PALETA = ["#3d7bff", "#1b2a4a", "#12805c", "#e0a500", "#c02626", "#7c3aed", "#0891b2"];

function Analisis({ notificar }) {
	const [ok, setOk] = useState(false);
	const [clave, setClave] = useState("");
	const [recibos, setRecibos] = useState([]);
	const [cargando, setCargando] = useState(false);
	const [modo, setModo] = useState("dia"); // "dia" | "mes"

	const entrar = () => {
		if (clave.trim() === CLAVE_ANALISIS) {
			setOk(true);
			cargarRecibos();
		} else {
			notificar("Clave incorrecta", "error");
		}
	};

	const cargarRecibos = async () => {
		setCargando(true);
		try {
			const data = await getSheet("Recibos");
			setRecibos(data);
		} catch {
			notificar("No se pudieron cargar los recibos", "error");
		} finally {
			setCargando(false);
		}
	};

	// Normaliza la fecha del recibo a Date (soporta "2026-08-19" y "19/08/2026")
	const parseFecha = (f) => {
		if (!f) return null;
		const s = f.toString().trim();
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0, 10) + "T00:00:00");
		const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
		if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
		const d = new Date(s);
		return isNaN(d) ? null : d;
	};

	const claveDia = (d) => d.toISOString().slice(0, 10);
	const claveMes = (d) => d.toISOString().slice(0, 7);

	// Serie temporal: total por día o por mes
	const serie = useMemo(() => {
		const map = new Map();
		recibos.forEach((r) => {
			const d = parseFecha(r.fecha);
			if (!d) return;
			const k = modo === "dia" ? claveDia(d) : claveMes(d);
			const v = Number(r.valor) || 0;
			map.set(k, (map.get(k) || 0) + v);
		});
		return [...map.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([periodo, valor]) => ({ periodo, valor }));
	}, [recibos, modo]);

	// Distribución por concepto (pie)
	const porConcepto = useMemo(() => {
		const map = new Map();
		recibos.forEach((r) => {
			const c = (r.concepto ?? "Otro").toString();
			const v = Number(r.valor) || 0;
			map.set(c, (map.get(c) || 0) + v);
		});
		return [...map.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([name, value]) => ({ name, value }));
	}, [recibos]);

	const totalGeneral = useMemo(
		() => recibos.reduce((acc, r) => acc + (Number(r.valor) || 0), 0),
		[recibos]
	);

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

	// ---- Panel de análisis ----
	return (
		<main className="rc-main no-print">
			<section className="rc-card">
				<div className="rc-analisis-head">
					<h2 className="rc-h2" style={{ margin: 0 }}>Recaudo</h2>
					<div className="rc-seg">
						<button className={modo === "dia" ? "on" : ""} onClick={() => setModo("dia")}>
							Por día
						</button>
						<button className={modo === "mes" ? "on" : ""} onClick={() => setModo("mes")}>
							Por mes
						</button>
					</div>
					<button className="rc-refresh" onClick={cargarRecibos} disabled={cargando}>
						<span className={cargando ? "spin" : ""}>↻</span>
						{cargando ? "Cargando…" : "Recargar"}
					</button>
				</div>

				<div className="rc-stats">
					<div className="rc-stat">
						<span>Total recaudado</span>
						<strong>{COP(totalGeneral)}</strong>
					</div>
					<div className="rc-stat">
						<span>Recibos</span>
						<strong>{recibos.length}</strong>
					</div>
					<div className="rc-stat">
						<span>{modo === "dia" ? "Días" : "Meses"} con recaudo</span>
						<strong>{serie.length}</strong>
					</div>
				</div>
			</section>

			<section className="rc-card">
				<h2 className="rc-h2">Recaudo {modo === "dia" ? "diario" : "mensual"}</h2>
				{serie.length === 0 ? (
					<p className="rc-hint">Aún no hay recibos para mostrar.</p>
				) : (
					<div style={{ width: "100%", height: 300 }}>
						<ResponsiveContainer>
							{modo === "dia" ? (
								<BarChart data={serie} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
									<CartesianGrid strokeDasharray="3 3" stroke="#eee" />
									<XAxis dataKey="periodo" tick={{ fontSize: 12 }} />
									<YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
									<Tooltip formatter={(v) => COP(v)} />
									<Bar dataKey="valor" fill="#3d7bff" radius={[6, 6, 0, 0]} />
								</BarChart>
							) : (
								<LineChart data={serie} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
									<CartesianGrid strokeDasharray="3 3" stroke="#eee" />
									<XAxis dataKey="periodo" tick={{ fontSize: 12 }} />
									<YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v / 1000}k`} />
									<Tooltip formatter={(v) => COP(v)} />
									<Line type="monotone" dataKey="valor" stroke="#3d7bff" strokeWidth={3} dot={{ r: 4 }} />
								</LineChart>
							)}
						</ResponsiveContainer>
					</div>
				)}
			</section>

			<section className="rc-card">
				<h2 className="rc-h2">Distribución por concepto</h2>
				{porConcepto.length === 0 ? (
					<p className="rc-hint">Aún no hay datos.</p>
				) : (
					<div style={{ width: "100%", height: 300 }}>
						<ResponsiveContainer>
							<PieChart>
								<Pie
									data={porConcepto}
									dataKey="value"
									nameKey="name"
									cx="50%"
									cy="50%"
									outerRadius={100}
									label={(e) => e.name}
								>
									{porConcepto.map((_, i) => (
										<Cell key={i} fill={PALETA[i % PALETA.length]} />
									))}
								</Pie>
								<Tooltip formatter={(v) => COP(v)} />
								<Legend />
							</PieChart>
						</ResponsiveContainer>
					</div>
				)}
			</section>
		</main>
	);
}

export default Home;