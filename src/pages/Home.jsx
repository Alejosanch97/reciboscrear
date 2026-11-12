import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import "../styles/home.css";
import emailjs from "@emailjs/browser";
import { postAction, getSheet, leerSesion, borrarSesion, onSesionExpirada } from "./api.js";
import { getCachedThenRevalidate, refreshSheet, setCache, peekCache } from "./cache.js";
import {
	CURSOS, COP, numRecibo, hoyISO, horaLocal, parseFecha, fmtFecha, idNinoDe, esCorreoValido,
	rankGrado, inscrito, estadoCurso, etiquetaMes, conceptoConMes,
} from "./utils.js";
import { Login, Escudo } from "../components/recibos/Login.jsx";
import { Cursos } from "../components/recibos/Cursos.jsx";
import { Analisis } from "../components/recibos/Analisis.jsx";
import { Ticket, ResumenCarta } from "../components/recibos/Impresion.jsx";

// Copias que salen al guardar un recibo (cada una se corta / rasga por separado)
const COPIAS_RECIBO = ["ORIGINAL · ACUDIENTE", "COPIA · ARCHIVO"];

// Ancho del rollo de la impresora térmica (58 u 80)
const ANCHO_PAPEL_MM = 58;

// ---- EmailJS ----
const EMAILJS_SERVICE = "service_8dqywo2";
const EMAILJS_TEMPLATE = "template_xmgt31a";
const EMAILJS_PUBLIC_KEY = "VQ0tJwGauSCwIY_cf";

const esCurso = (idConcepto) => CURSOS.some((c) => c.id === String(idConcepto));
const cursoDe = (idConcepto) => CURSOS.find((c) => c.id === String(idConcepto));

// Valor con puntos de miles mientras se escribe: 500000 → 500.000
const soloDigitos = (s) => (s ?? "").toString().replace(/\D/g, "");
const miles = (s) => soloDigitos(s).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const tieneValor = (c) => Number(c?.valor) > 0;

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
		/* modo privado */
	}
};

/* ======================================================
   HOME — puerta de entrada (login)
   ====================================================== */
export const Home = () => {
	const [sesion, setSesion] = useState(() => leerSesion());
	const [aviso, setAviso] = useState("");

	useEffect(() => {
		onSesionExpirada((msg) => {
			setAviso(msg);
			setSesion(null);
		});
	}, []);

	if (!sesion) {
		return (
			<Login
				aviso={aviso}
				onLogin={(s) => {
					setAviso("");
					setSesion(s);
				}}
			/>
		);
	}

	return (
		<App
			sesion={sesion}
			onSalir={(msg) => {
				borrarSesion();
				setAviso(typeof msg === "string" ? msg : "");
				setSesion(null);
			}}
		/>
	);
};

/* ======================================================
   APP
   ====================================================== */
function App({ sesion, onSalir }) {
	const [tab, setTab] = useState("recibos");

	const [ninos, setNinos] = useState(() => peekCache("Niños"));
	const [conceptos, setConceptos] = useState(() => peekCache("Conceptos"));
	const [refrescando, setRefrescando] = useState(false);
	const [toast, setToast] = useState(null);

	// Recibos (los usan Cursos, Análisis y el control de meses ya pagados)
	const [recibos, setRecibos] = useState([]);
	const [cargandoRecibos, setCargandoRecibos] = useState(false);

	// ---- Recibo en construcción ----
	const [items, setItems] = useState([]);
	const [fecha, setFecha] = useState(hoyISO());
	const [observacion, setObservacion] = useState("");
	const [emitiendo, setEmitiendo] = useState(false);
	const [autoImprimir, setAutoImprimir] = useState(() => leerPref("rc_auto_print", true));

	const [gradoSel, setGradoSel] = useState("");
	const [ninoSel, setNinoSel] = useState("");
	const [conceptoSel, setConceptoSel] = useState("");
	const [mesSel, setMesSel] = useState("");
	const [valorLibre, setValorLibre] = useState("");

	// ---- Impresión ----
	const [printJob, setPrintJob] = useState(null);
	const imprimir = useCallback((job) => setPrintJob({ ...job, n: Date.now() }), []);

	// Antes de imprimir, mide el recibo y le dice a Chrome el tamaño EXACTO de cada copia
	// (58 mm de ancho x lo que mida el recibo). Así no sale una tira larga en blanco.
	useEffect(() => {
		if (!printJob) return;
		const t = setTimeout(() => {
			let estilo = document.getElementById("rc-tam-papel");
			if (!estilo) {
				estilo = document.createElement("style");
				estilo.id = "rc-tam-papel";
				document.head.appendChild(estilo);
			}
			estilo.textContent = "";
			if (printJob.tipo === "recibo") {
				const tickets = [...document.querySelectorAll(".print-area .ticket")];
				const altoPx = Math.max(...tickets.map((el) => el.getBoundingClientRect().height), 0);
				const altoMm = Math.ceil((altoPx * 25.4) / 96) + 2;
				estilo.textContent = `@page { size: ${ANCHO_PAPEL_MM}mm ${altoMm}mm; margin: 0; }`;
			}
			window.print();
		}, 120);
		return () => clearTimeout(t);
	}, [printJob?.n]); // eslint-disable-line react-hooks/exhaustive-deps

	const notificar = useCallback((msg, tipo = "ok") => setToast({ msg, tipo, n: Date.now() }), []);

	// ---- Cierre automático: 10 minutos sin actividad ----
	const salirRef = useRef(onSalir);
	salirRef.current = onSalir;
	useEffect(() => {
		const LIMITE = 10 * 60 * 1000;
		const AVISO = 9 * 60 * 1000;
		let ultimo = Date.now();
		let avisado = false;
		const marcar = () => {
			ultimo = Date.now();
			avisado = false;
		};
		const eventos = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
		eventos.forEach((ev) => window.addEventListener(ev, marcar, { passive: true }));
		const revisar = () => {
			const quieto = Date.now() - ultimo;
			if (quieto > LIMITE) {
				salirRef.current("Tu sesión se cerró por 10 minutos sin actividad.");
			} else if (quieto > AVISO && !avisado) {
				avisado = true;
				notificar("Sin actividad: la sesión se cerrará en 1 minuto", "error");
			}
		};
		const t = setInterval(revisar, 10000);
		document.addEventListener("visibilitychange", revisar);
		return () => {
			eventos.forEach((ev) => window.removeEventListener(ev, marcar));
			clearInterval(t);
			document.removeEventListener("visibilitychange", revisar);
		};
	}, [notificar]);

	useEffect(() => {
		if (!toast) return;
		const t = setTimeout(() => setToast(null), 3400);
		return () => clearTimeout(t);
	}, [toast]);

	const cargarRecibos = useCallback(async () => {
		setCargandoRecibos(true);
		try {
			setRecibos(await getSheet("Recibos"));
		} catch (e) {
			notificar("No se pudieron cargar los recibos: " + (e.message || ""), "error");
		} finally {
			setCargandoRecibos(false);
		}
	}, [notificar]);

	useEffect(() => {
		const cachedN = getCachedThenRevalidate("Niños", (fresh) => setNinos(fresh));
		const cachedC = getCachedThenRevalidate("Conceptos", (fresh) => setConceptos(fresh));
		if (cachedN.length) setNinos(cachedN);
		if (cachedC.length) setConceptos(cachedC);
		cargarRecibos();
	}, [cargarRecibos]);

	const actualizar = async () => {
		setRefrescando(true);
		try {
			const [n, c] = await Promise.all([refreshSheet("Niños"), refreshSheet("Conceptos")]);
			setNinos(n);
			setConceptos(c);
			await cargarRecibos();
			notificar("Datos actualizados");
		} catch {
			notificar("No se pudo actualizar", "error");
		} finally {
			setRefrescando(false);
		}
	};

	const grados = useMemo(() => {
		const set = new Set(ninos.map((n) => (n.grado ?? "").toString()).filter(Boolean));
		return [...set].sort((a, b) => rankGrado(a) - rankGrado(b) || a.localeCompare(b));
	}, [ninos]);

	const ninosDelGrado = useMemo(
		() =>
			ninos
				.filter((n) => (n.grado ?? "").toString() === gradoSel)
				.sort((a, b) => (a.nombre_completo ?? "").localeCompare(b.nombre_completo ?? "", "es")),
		[ninos, gradoSel]
	);

	const total = useMemo(() => items.reduce((acc, it) => acc + (Number(it.valor) || 0), 0), [items]);

	/* ---------- Mes del curso ---------- */
	const anioRecibo = (parseFecha(fecha) || new Date()).getFullYear();
	const conceptoEsCurso = esCurso(conceptoSel);
	const conceptoObj = conceptos.find((c) => (c.id_concepto ?? "").toString() === conceptoSel);
	const esValorLibre = !!conceptoObj && !tieneValor(conceptoObj);
	const ninoActual = ninos.find((n) => idNinoDe(n) === ninoSel);

	// Los cursos solo aparecen si el estudiante tiene OK en su columna de la hoja Niños
	const conceptosVisibles = useMemo(
		() =>
			conceptos.filter((c) => {
				const curso = cursoDe(c.id_concepto);
				if (!curso) return true;
				return !!ninoActual && inscrito(ninoActual, curso.columna);
			}),
		[conceptos, ninoActual]
	);

	// Si cambias de estudiante y el curso elegido ya no le aplica, se limpia
	useEffect(() => {
		if (conceptoSel && !conceptosVisibles.some((c) => (c.id_concepto ?? "").toString() === conceptoSel)) {
			setConceptoSel("");
		}
	}, [conceptosVisibles]); // eslint-disable-line react-hooks/exhaustive-deps

	const opcionesMes = useMemo(() => {
		if (!conceptoEsCurso || !ninoSel) return [];
		const est = estadoCurso(recibos, ninoSel, conceptoSel, anioRecibo);
		return est.meses.map((m) => ({
			...m,
			enRecibo: items.some((it) => it.id_niño === ninoSel && it.id_concepto === conceptoSel && it.mes === m.key),
		}));
	}, [conceptoEsCurso, ninoSel, conceptoSel, anioRecibo, recibos, items]);

	// Sugiere el primer mes que debe (o el siguiente pendiente)
	useEffect(() => {
		if (!opcionesMes.length) {
			setMesSel("");
			return;
		}
		const libre = (m) => m.estado !== "pagado" && !m.enRecibo;
		const sugerido = opcionesMes.find((m) => m.estado === "debe" && libre(m)) || opcionesMes.find(libre);
		setMesSel(sugerido ? sugerido.key : "");
	}, [opcionesMes]);

	/* ---------- ítems ---------- */
	const agregarItem = () => {
		const nino = ninoActual;
		const concepto = conceptos.find((c) => c.id_concepto.toString() === conceptoSel);
		if (!nino || !concepto) {
			notificar("Elige grado, estudiante y concepto", "error");
			return;
		}
		const valorItem = tieneValor(concepto) ? Number(concepto.valor) : Number(soloDigitos(valorLibre));
		if (!(valorItem > 0)) {
			notificar("Escribe el valor a cobrar de " + concepto.concepto, "error");
			return;
		}
		if (conceptoEsCurso) {
			if (!mesSel) {
				notificar("Elige el mes que está pagando", "error");
				return;
			}
			const op = opcionesMes.find((m) => m.key === mesSel);
			if (op?.estado === "pagado") {
				notificar(`Ese mes ya está pagado (recibo N° ${numRecibo(op.pago.id_recibo)})`, "error");
				return;
			}
			if (op?.enRecibo) {
				notificar("Ese mes ya está en este recibo", "error");
				return;
			}
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
				valor: valorItem,
				mes: conceptoEsCurso ? mesSel : "",
			},
		]);
		setValorLibre("");
		if (!conceptoEsCurso) setConceptoSel("");
	};

	const quitarItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

	const limpiarRecibo = () => {
		setItems([]);
		setObservacion("");
		setGradoSel("");
		setNinoSel("");
		setConceptoSel("");
		setMesSel("");
	};

	// Desde Cursos: "Cobrar meses pendientes"
	const cobrarDesdeCurso = (nino, idConcepto, meses) => {
		const concepto = conceptos.find((c) => c.id_concepto.toString() === idConcepto);
		if (!concepto) {
			notificar("Ese curso no existe en Conceptos", "error");
			return;
		}
		if (items.length && !window.confirm("Hay un recibo en construcción. ¿Reemplazarlo por este cobro?")) return;
		setItems(
			meses.map((mes) => ({
				id_niño: idNinoDe(nino),
				estudiante: nino.nombre_completo,
				grado: nino.grado,
				acudiente: nino.acudiente,
				id_concepto: idConcepto,
				concepto: concepto.concepto,
				valor: Number(concepto.valor) || 0,
				mes,
			}))
		);
		setGradoSel((nino.grado ?? "").toString());
		setNinoSel(idNinoDe(nino));
		setConceptoSel(idConcepto);
		setTab("recibos");
		notificar(`${meses.length} ${meses.length === 1 ? "mes listo" : "meses listos"} para cobrar`);
	};

	const cambiarAutoImprimir = (v) => {
		setAutoImprimir(v);
		guardarPref("rc_auto_print", v);
	};

	const enviarCorreo = (recibo, correoDestino) =>
		emailjs.send(
			EMAILJS_SERVICE,
			EMAILJS_TEMPLATE,
			{
				email: correoDestino,
				numero_recibo: numRecibo(recibo.numero),
				fecha: fmtFecha(recibo.fecha),
				items: recibo.items
					.map((it) => `${it.estudiante} (${it.grado}) — ${conceptoConMes(it)}: ${COP(it.valor)}`)
					.join("\n"),
				observacion: recibo.observacion || "—",
				total: COP(recibo.total),
				estado_banner: "",
			},
			{ publicKey: EMAILJS_PUBLIC_KEY }
		);

	/* ---------- Guardar → imprimir → correo ---------- */
	const emitirYEnviar = async () => {
		if (emitiendo) return;
		if (items.length === 0) {
			notificar("Agrega al menos un ítem", "error");
			return;
		}

		const correoDestino = (items[0].acudiente ?? "").toString().trim();
		const itemsSnapshot = items;
		const fechaSnapshot = fecha;
		const obsSnapshot = observacion;
		const totalSnapshot = total;

		setEmitiendo(true);
		try {
			const r = await postAction({
				action: "emitir_recibo_multi",
				fecha: fechaSnapshot,
				observacion: obsSnapshot,
				items: itemsSnapshot.map((it) => ({
					id_niño: it.id_niño,
					id_concepto: it.id_concepto,
					mes: it.mes || "",
					valor: it.valor,
				})),
			});
			if (r.status !== "success") throw new Error(r.message || "Error al emitir");

			const recibo = {
				numero: r.recibo?.id_recibo ?? "",
				fecha: fechaSnapshot,
				hora: horaLocal(),
				items: itemsSnapshot,
				observacion: obsSnapshot,
				total: totalSnapshot,
				usuario: sesion.nombre || sesion.usuario,
			};

			if (autoImprimir) imprimir({ tipo: "recibo", data: recibo, copias: COPIAS_RECIBO });

			// Suma las filas nuevas sin recargar (Cursos y Análisis se actualizan al instante)
			setRecibos((prev) => [...prev, ...(r.recibo?.items || []).map((it) => ({ ...it, estado: "" }))]);

			limpiarRecibo();
			notificar(`Recibo N° ${numRecibo(recibo.numero)} guardado`);

			if (esCorreoValido(correoDestino)) {
				enviarCorreo(recibo, correoDestino)
					.then(() => notificar("Correo enviado a " + correoDestino))
					.catch((e) => notificar("Guardado, pero falló el correo: " + (e.text || e.message || "error"), "error"));
			}
		} catch (e) {
			notificar("No se pudo guardar: " + (e.message || "error"), "error");
		} finally {
			setEmitiendo(false);
		}
	};

	const cursoNoInscrito =
		conceptoEsCurso && ninoActual && !inscrito(ninoActual, cursoDe(conceptoSel).columna);

	return (
		<div className="rc-app">
			<header className="rc-top no-print">
				<div className="rc-brand">
					<Escudo className="rc-escudo" />
					<div className="rc-brand-txt">
						<div className="rc-brand-name">Instituto Pedagógico Crear</div>
						<div className="rc-brand-sub">Recibos de caja</div>
					</div>
				</div>

				<nav className="rc-tabs">
					{[
						["recibos", "Recibos"],
						["cursos", "Cursos"],
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
					<span className="rc-refresh-txt">{refrescando ? "Actualizando…" : "Actualizar"}</span>
				</button>
			</header>

			<div className="rc-sesion no-print">
				<div className="rc-sesion-in">
					<span className="rc-avatar">{(sesion.nombre || sesion.usuario).slice(0, 1).toUpperCase()}</span>
					<div className="rc-sesion-txt">
						<span><i className="rc-punto" /> Sesión activa</span>
						<b>{sesion.nombre || sesion.usuario}</b>
					</div>
					<span className="rc-rol">{sesion.rol}</span>
					<span className="rc-sesion-meta">
						@{sesion.usuario} · desde{" "}
						{new Date(sesion.exp - 12 * 3600 * 1000).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
					</span>
					<button className="rc-salir" onClick={onSalir}>Cerrar sesión</button>
				</div>
			</div>

			{/* ---------------- RECIBOS ---------------- */}
			{tab === "recibos" && (
				<main className="rc-main rc-main-wide no-print">
					<section className="rc-card">
						<h2 className="rc-h2">Nuevo recibo</h2>

						<div className={`rc-add-grid ${conceptoEsCurso ? "con-mes" : ""} ${esValorLibre ? "con-valor" : ""}`}>
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
										<option key={g} value={g}>{g}</option>
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
											<option key={id} value={id}>{n.nombre_completo}</option>
										);
									})}
								</select>
							</div>

							<div className="rc-field">
								<label>Concepto</label>
								<select
									value={conceptoSel}
									onChange={(e) => {
										setConceptoSel(e.target.value);
										setValorLibre("");
									}}
								>
									<option value="">—</option>
									{conceptosVisibles.map((c) => (
										<option key={c.id_concepto} value={c.id_concepto}>
											{c.concepto} · {tieneValor(c) ? COP(c.valor) : "valor libre"}
										</option>
									))}
								</select>
							</div>

							{esValorLibre && (
								<div className="rc-field rc-field-valor">
									<label>Valor a cobrar</label>
									<div className="rc-pesos">
										<span>$</span>
										<input
											inputMode="numeric"
											value={valorLibre}
											onChange={(e) => setValorLibre(miles(e.target.value))}
											onKeyDown={(e) => e.key === "Enter" && agregarItem()}
											placeholder="500.000"
											autoFocus
										/>
									</div>
								</div>
							)}

							{conceptoEsCurso && (
								<div className="rc-field rc-field-mes">
									<label>Mes que paga</label>
									<select value={mesSel} onChange={(e) => setMesSel(e.target.value)} disabled={!ninoSel}>
										<option value="">—</option>
										{opcionesMes.map((m) => (
											<option key={m.key} value={m.key} disabled={m.estado === "pagado" || m.enRecibo}>
												{etiquetaMes(m.key, false)}
												{m.estado === "pagado" ? " · pagado" : m.enRecibo ? " · en este recibo" : m.estado === "debe" ? " · debe" : ""}
											</option>
										))}
									</select>
								</div>
							)}

							<button className="rc-add-btn" onClick={agregarItem} disabled={emitiendo}>
								+ Agregar
							</button>
						</div>

						{cursoNoInscrito ? (
							<p className="rc-hint rc-hint-warn">
								⚠ {ninoActual.nombre_completo} no tiene OK en {cursoDe(conceptoSel).columna} (hoja Niños). Puedes
								cobrar igual, pero no aparecerá en la lista del curso.
							</p>
						) : (
							<p className="rc-hint">
								{conceptoEsCurso
									? "¿Paga varios meses? Agrega un ítem por cada mes; el mes sugerido es el primero que debe."
									: "¿Hermanos? Cambia el grado y el estudiante y agrega otro ítem al mismo recibo."}
							</p>
						)}

						{items.length > 0 && (
							<ul className="rc-items">
								{items.map((it, i) => (
									<li key={i}>
										<div className="rc-item-main">
											<span className="rc-item-name">{it.estudiante}</span>
											<span className="rc-item-grade">{it.grado}</span>
										</div>
										<span className="rc-item-concept">
											{it.concepto}
											{it.mes && <span className="rc-mes-tag">{etiquetaMes(it.mes)}</span>}
										</span>
										<span className="rc-item-value">{COP(it.valor)}</span>
										<button className="rc-item-del" onClick={() => quitarItem(i)} aria-label="Quitar" disabled={emitiendo}>
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
									placeholder="Opcional"
								/>
							</div>
							<div className="rc-total">
								<span>Total</span>
								<strong>{COP(total)}</strong>
							</div>
						</div>

						<div className="rc-actions">
							<label className="rc-toggle">
								<input type="checkbox" checked={autoImprimir} onChange={(e) => cambiarAutoImprimir(e.target.checked)} />
								<span>Imprimir 2 copias al guardar</span>
							</label>
							<button className="rc-ghost" onClick={limpiarRecibo} disabled={emitiendo}>
								Limpiar
							</button>
							<button className="rc-primary" onClick={emitirYEnviar} disabled={items.length === 0 || emitiendo}>
								{emitiendo ? "Guardando…" : autoImprimir ? "Guardar e imprimir" : "Guardar y enviar"}
							</button>
						</div>
					</section>
				</main>
			)}

			{tab === "cursos" && (
				<Cursos
					ninos={ninos}
					conceptos={conceptos}
					recibos={recibos}
					cargando={cargandoRecibos}
					onRecargar={cargarRecibos}
					onCobrar={cobrarDesdeCurso}
				/>
			)}

			{tab === "estudiantes" && (
				<CrudEstudiantes
					ninos={ninos}
					setNinos={setNinos}
					grados={grados}
					conceptos={conceptos}
					notificar={notificar}
				/>
			)}

			{tab === "conceptos" && (
				<CrudConceptos conceptos={conceptos} setConceptos={setConceptos} notificar={notificar} />
			)}

			{tab === "analisis" && (
				<Analisis
					sesion={sesion}
					recibos={recibos}
					setRecibos={setRecibos}
					cargando={cargandoRecibos}
					cargarRecibos={cargarRecibos}
					ninos={ninos}
					conceptos={conceptos}
					notificar={notificar}
					imprimir={imprimir}
				/>
			)}

			{/* ---------------- IMPRIMIBLE (oculto en pantalla) ---------------- */}
			{printJob &&
				createPortal(
					<div
						className={`print-area ${printJob.tipo === "resumen" ? "print-carta" : "print-ticket"}`}
						key={printJob.n}
					>
						{printJob.tipo === "recibo" &&
							printJob.copias.map((c) => <Ticket key={c} copia={c} data={printJob.data} />)}
						{printJob.tipo === "resumen" && <ResumenCarta data={printJob.data} />}
					</div>,
					document.body
				)}

			{toast && (
				<div key={toast.n} className={`rc-toast ${toast.tipo} no-print`}>
					{toast.msg}
				</div>
			)}
		</div>
	);
}

/* ======================================================
   CRUD ESTUDIANTES (optimistic) + cursos
   ====================================================== */
function CrudEstudiantes({ ninos, setNinos, grados, conceptos, notificar }) {
	const vacio = { nombre_completo: "", grado: "", acudiente: "", telefono: "" };
	const [form, setForm] = useState(vacio);
	const [cursosSel, setCursosSel] = useState([]);
	const [guardando, setGuardando] = useState(false);
	const [busqueda, setBusqueda] = useState("");

	const nombreCurso = (c) => conceptos.find((x) => (x.id_concepto ?? "").toString() === c.id)?.concepto || c.columna;

	const nextId = useMemo(() => {
		let max = 0;
		ninos.forEach((n) => {
			const v = parseInt(idNinoDe(n), 10);
			if (!isNaN(v) && v > max) max = v;
		});
		return max + 1;
	}, [ninos]);

	const toggleCurso = (col) =>
		setCursosSel((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));

	const guardar = async () => {
		if (guardando) return;
		if (!form.nombre_completo || !form.grado) {
			notificar("Nombre y grado son obligatorios", "error");
			return;
		}
		setGuardando(true);

		const cursosData = {};
		CURSOS.forEach((c) => (cursosData[c.columna] = cursosSel.includes(c.columna) ? "OK" : ""));

		const optimista = {
			rowId: "temp-" + Date.now(),
			"id_niño": nextId,
			id_ni_o: nextId,
			...form,
			...cursosData,
			_pending: true,
		};
		const prev = ninos;
		const lista = [...ninos, optimista];
		setNinos(lista);
		setCache("Niños", lista);
		const formGuardado = { ...form };
		const cursosGuardados = [...cursosSel];
		setForm(vacio);
		setCursosSel([]);

		try {
			const r = await postAction({
				action: "create",
				sheet: "Niños",
				data: { "id_niño": nextId, ...formGuardado, ...cursosData },
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
			setCursosSel(cursosGuardados);
			notificar("No se pudo crear: " + (e.message || "error"), "error");
		} finally {
			setGuardando(false);
		}
	};

	const visibles = useMemo(() => {
		const q = busqueda.trim().toLowerCase();
		const base = q
			? ninos.filter(
					(n) =>
						(n.nombre_completo ?? "").toLowerCase().includes(q) ||
						(n.grado ?? "").toString().toLowerCase().includes(q)
			  )
			: ninos;
		return base;
	}, [ninos, busqueda]);

	return (
		<main className="rc-main rc-main-wide no-print">
			<section className="rc-card">
				<h2 className="rc-h2">Nuevo estudiante</h2>
				<div className="rc-form-grid">
					<div className="rc-field">
						<label>Nombre completo</label>
						<input value={form.nombre_completo} onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })} />
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

				<div className="rc-field" style={{ marginTop: 16 }}>
					<label>Cursos inscritos</label>
					<div className="rc-cursos-check">
						{CURSOS.map((c) => (
							<button
								type="button"
								key={c.id}
								className={cursosSel.includes(c.columna) ? "on" : ""}
								onClick={() => toggleCurso(c.columna)}
							>
								{cursosSel.includes(c.columna) ? "✓ " : ""}
								{nombreCurso(c)}
							</button>
						))}
					</div>
				</div>

				<div className="rc-actions">
					<button className="rc-primary" onClick={guardar} disabled={guardando}>
						{guardando ? "Guardando…" : "Crear estudiante"}
					</button>
				</div>
			</section>

			<section className="rc-card">
				<div className="rc-card-head">
					<h2 className="rc-h2" style={{ margin: 0 }}>Estudiantes ({ninos.length})</h2>
					<input
						className="rc-lock-input rc-buscar"
						value={busqueda}
						onChange={(e) => setBusqueda(e.target.value)}
						placeholder="Buscar nombre o grado"
					/>
				</div>
				<div className="rc-table-wrap">
					<table className="rc-table">
						<thead>
							<tr>
								<th>Nombre</th>
								<th>Grado</th>
								<th>Acudiente (correo)</th>
								<th>Cursos</th>
							</tr>
						</thead>
						<tbody>
							{visibles.map((n, i) => (
								<tr key={n.rowId ?? i} className={n._pending ? "rc-pending" : ""}>
									<td>{n.nombre_completo}</td>
									<td>{n.grado}</td>
									<td>{n.acudiente}</td>
									<td>
										<div className="rc-cursos-tags">
											{CURSOS.filter((c) => inscrito(n, c.columna)).map((c) => (
												<span key={c.id}>{nombreCurso(c)}</span>
											))}
										</div>
									</td>
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
		if (!form.concepto.trim()) {
			notificar("Escribe el nombre del concepto", "error");
			return;
		}
		const valorNum = soloDigitos(form.valor) ? Number(soloDigitos(form.valor)) : "";
		setGuardando(true);

		const optimista = {
			rowId: "temp-" + Date.now(),
			id_concepto: nextId,
			concepto: form.concepto,
			valor: valorNum,
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
				data: { id_concepto: nextId, concepto: formGuardado.concepto, valor: valorNum },
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
						<label>Valor (vacío = valor libre)</label>
						<input
							inputMode="numeric"
							value={form.valor}
							onChange={(e) => setForm({ ...form, valor: miles(e.target.value) })}
							placeholder="350.000"
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
								<th>Tipo</th>
								<th className="rc-right">Valor</th>
							</tr>
						</thead>
						<tbody>
							{conceptos.map((c, i) => (
								<tr key={c.rowId ?? i} className={c._pending ? "rc-pending" : ""}>
									<td>{c.concepto}</td>
									<td>{esCurso(c.id_concepto) ? <span className="rc-mes-tag">Curso mensual</span> : "—"}</td>
									<td className="rc-right">
										{tieneValor(c) ? COP(c.valor) : <span className="rc-mes-tag">Valor libre</span>}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</main>
	);
}

export default Home;