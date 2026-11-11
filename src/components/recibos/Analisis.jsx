import { useState, useMemo } from "react";
import emailjs from "@emailjs/browser";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { postAction } from "../../pages/api.js";
import { ResumenCarta } from "./Impresion.jsx";
import {
	COP, numRecibo, isoLocal, hoyISO, horaLocal, parseFecha, fmtFecha, MESES, DIAS,
	rangoPeriodo, moverReferencia, agruparRecibos, esCorreoValido, conceptoConMes, idNinoDe,
} from "../../pages/utils.js";

const CLAVE_ANALISIS = "CREAR1966";

const EMAILJS_SERVICE = "service_8dqywo2";
const EMAILJS_TEMPLATE = "template_xmgt31a";
const EMAILJS_PUBLIC_KEY = "VQ0tJwGauSCwIY_cf";

const BANNER_ANULADO = `
<div style="max-width:600px;margin:8px auto 0;background:#c02626;color:#fff;text-align:center;padding:14px;font-family:system-ui,sans-serif,Arial;">
  <span style="font-size:34px;font-weight:800;letter-spacing:6px;">ANULADO</span>
</div>`;

/* ======================================================
   ANÁLISIS — admin entra directo; los demás con clave
   ====================================================== */
export function Analisis({ sesion, recibos, setRecibos, cargando, cargarRecibos, ninos, conceptos, notificar, imprimir }) {
	const [ok, setOk] = useState(sesion?.rol === "admin");
	const [clave, setClave] = useState("");
	const [vista, setVista] = useState("recaudo");
	const [verResumen, setVerResumen] = useState(false);
	const [modo, setModo] = useState("dia");
	const [refISO, setRefISO] = useState(hoyISO());

	const entrar = () => {
		if (clave.trim() === CLAVE_ANALISIS) {
			setOk(true);
			cargarRecibos();
		} else {
			notificar("Clave incorrecta", "error");
		}
	};

	const rango = useMemo(() => rangoPeriodo(modo, refISO), [modo, refISO]);

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

	// Cuadre por concepto (todos los conceptos creados + los que aparezcan en recibos)
	const cuadre = useMemo(() => {
		const map = new Map();
		const n = (s) => (s ?? "").toString().trim();
		conceptos.forEach((c) => {
			const k = n(c.concepto);
			if (k && !map.has(k)) map.set(k, { concepto: k, tarifa: Number(c.valor) > 0 ? Number(c.valor) : null, cantidad: 0, total: 0 });
		});
		activos.forEach((g) =>
			g.items.forEach((it) => {
				const k = n(it.concepto) || "Otro";
				if (!map.has(k)) map.set(k, { concepto: k, tarifa: null, cantidad: 0, total: 0 });
				const row = map.get(k);
				row.cantidad += 1;
				row.total += it.valor;
			})
		);
		return [...map.values()].sort((a, b) => b.total - a.total || a.concepto.localeCompare(b.concepto, "es"));
	}, [conceptos, activos]);

	const porUsuario = useMemo(() => {
		const map = new Map();
		activos.forEach((g) => {
			const u = g.usuario || "sin usuario";
			const row = map.get(u) || { usuario: u, recibos: 0, total: 0 };
			row.recibos += 1;
			row.total += g.total;
			map.set(u, row);
		});
		return [...map.values()].sort((a, b) => b.total - a.total);
	}, [activos]);

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
				if (k.length === 10) {
					const d = parseFecha(k);
					return { periodo: `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}`, valor };
				}
				return { periodo: `${MESES[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}`, valor };
			});
	}, [activos, modo]);

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
			impresoPor: sesion?.nombre || sesion?.usuario,
			recibosActivos: activos.length,
			recibosAnulados: anulados.length,
			valorAnulado,
			itemsActivos,
			rango: nums.length ? `${numRecibo(Math.min(...nums))} – ${numRecibo(Math.max(...nums))}` : "",
			conceptos: cuadre.filter((c) => c.cantidad > 0),
			total: totalPeriodo,
			porUsuario,
			porDia: [...dias.values()]
				.sort((a, b) => a.fecha.localeCompare(b.fecha))
				.map((d) => {
					const f = parseFecha(d.fecha);
					return { ...d, etiqueta: `${DIAS[f.getDay()]} ${fmtFecha(d.fecha)}` };
				}),
			detalle: [...grupos].sort((a, b) => Number(a.id_recibo) - Number(b.id_recibo)),
		};
	}, [activos, anulados, grupos, cuadre, rango, valorAnulado, itemsActivos, totalPeriodo, porUsuario, sesion]);

	const imprimirResumen = () => imprimir({ tipo: "resumen", data: datosResumen });

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
						{[["dia", "Día"], ["semana", "Semana"], ["mes", "Mes"], ["todo", "Todo"]].map(([k, l]) => (
							<button key={k} className={modo === k ? "on" : ""} onClick={() => setModo(k)}>
								{l}
							</button>
						))}
					</div>

					{modo !== "todo" && (
						<div className="rc-nav">
							<button onClick={() => setRefISO(moverReferencia(modo, refISO, -1))} aria-label="Anterior">‹</button>
							{modo === "mes" ? (
								<input
									type="month"
									value={refISO.slice(0, 7)}
									onChange={(e) => e.target.value && setRefISO(`${e.target.value}-01`)}
								/>
							) : (
								<input type="date" value={refISO} onChange={(e) => e.target.value && setRefISO(e.target.value)} />
							)}
							<button onClick={() => setRefISO(moverReferencia(modo, refISO, 1))} aria-label="Siguiente">›</button>
							<button className="rc-hoy" onClick={() => setRefISO(hoyISO())}>Hoy</button>
						</div>
					)}

					<div className="rc-periodo-label">{rango.label}</div>
				</div>
			</section>

			{vista === "recaudo" ? (
				<>
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
										<tr><td colSpan={5} className="rc-vacio">Aún no hay conceptos.</td></tr>
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
														<div className="rc-barra"><i style={{ width: `${pct}%` }} /></div>
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

					{porUsuario.length > 0 && (
						<section className="rc-card">
							<h2 className="rc-h2">Recaudo por usuario</h2>
							<div className="rc-usuarios">
								{porUsuario.map((u) => (
									<div key={u.usuario} className="rc-usuario-fila">
										<span className="rc-avatar">{u.usuario.slice(0, 1).toUpperCase()}</span>
										<b>{u.usuario}</b>
										<span className="rc-hint" style={{ margin: 0 }}>{u.recibos} recibos</span>
										<strong>{COP(u.total)}</strong>
									</div>
								))}
							</div>
						</section>
					)}

					{modo !== "dia" && (
						<section className="rc-card">
							<h2 className="rc-h2">Recaudo {modo === "todo" ? "por mes" : "por día"}</h2>
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
					sesion={sesion}
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
							<button className="rc-ghost" onClick={() => setVerResumen(false)}>Cerrar</button>
							<button className="rc-primary" onClick={imprimirResumen}>⎙ Imprimir</button>
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
function VerRecibos({ grupos, setRecibos, ninos, cargando, notificar, imprimir, totalPeriodo, activos, sesion }) {
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
				(r.usuario || "").toLowerCase().includes(q) ||
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
		const nino =
			ninos.find((n) => idNinoDe(n) === primer.id_niño) ||
			ninos.find((n) => (n.nombre_completo ?? "") === primer.estudiante);
		return (nino?.acudiente ?? "").toString().trim();
	};

	const enviarCorreoAnulacion = (recibo, correoDestino, motivoTexto) =>
		emailjs.send(
			EMAILJS_SERVICE,
			EMAILJS_TEMPLATE,
			{
				email: correoDestino,
				numero_recibo: numRecibo(recibo.id_recibo),
				fecha: fmtFecha(recibo.fecha),
				items: recibo.items
					.map((it) => `${it.estudiante} (${it.grado}) — ${conceptoConMes(it)}: ${COP(it.valor)}`)
					.join("\n"),
				observacion: motivoTexto ? `ANULADO · ${motivoTexto}` : recibo.observacion || "ANULADO",
				total: COP(recibo.total),
				estado_banner: BANNER_ANULADO,
			},
			{ publicKey: EMAILJS_PUBLIC_KEY }
		);

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
					(row.id_recibo ?? "").toString() === recibo.id_recibo
						? { ...row, estado: "ANULADO", motivo_anulacion: motivoTexto, anulado_por: sesion?.usuario }
						: row
				)
			);

			if (esCorreoValido(correoDestino)) {
				enviarCorreoAnulacion(recibo, correoDestino, motivoTexto)
					.then(() => notificar("Correo de anulación enviado a " + correoDestino))
					.catch((e) => notificar("Anulado, pero falló el correo: " + (e.text || e.message || "error"), "error"));
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
			data: {
				numero: r.id_recibo,
				fecha: r.fecha,
				items: r.items,
				observacion: r.observacion,
				total: r.total,
				usuario: r.usuario,
			},
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
					placeholder="Buscar N°, estudiante, concepto o usuario"
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
								{r.usuario && <span className="rc-stamp">por {r.usuario}</span>}
							</div>

							<div className="rc-recibo-items">
								{r.items.map((it, i) => (
									<div key={i}>
										<b>{it.estudiante}</b> · {conceptoConMes(it)} · {COP(it.valor)}
									</div>
								))}
								{r.observacion ? <div className="rc-recibo-obs">{r.observacion}</div> : null}
								{r.estado === "ANULADO" && (r.anulado_por || r.motivo) ? (
									<div className="rc-recibo-obs">
										Anulado{r.anulado_por ? ` por ${r.anulado_por}` : ""}
										{r.motivo ? ` · ${r.motivo}` : ""}
									</div>
								) : null}
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
									<button className="rc-btn-sec" onClick={() => reimprimir(r)} title="Reimprimir">⎙</button>
									<button className="rc-btn-anular" onClick={() => setConfirmando(r.id_recibo)}>Anular</button>
								</div>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
