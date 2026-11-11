import { useState, useMemo, useEffect } from "react";
import {
	CURSOS, COP, numRecibo, fmtFecha, etiquetaMes, idNinoDe, inscrito, rankGrado, estadoCurso,
} from "../../pages/utils.js";

export function Cursos({ ninos, conceptos, recibos, cargando, onRecargar, onCobrar }) {
	const [cursoId, setCursoId] = useState(CURSOS[0].id);
	const [anio, setAnio] = useState(new Date().getFullYear());
	const [filtro, setFiltro] = useState("todos"); // todos | deben | aldia
	const [busqueda, setBusqueda] = useState("");
	const [ninoSel, setNinoSel] = useState(null);

	const conceptoDe = (id) => conceptos.find((c) => (c.id_concepto ?? "").toString() === id);
	const nombreCurso = (c) => conceptoDe(c.id)?.concepto || c.columna;

	const curso = CURSOS.find((c) => c.id === cursoId);
	const tarifa = Number(conceptoDe(cursoId)?.valor) || 0;

	const conteos = useMemo(() => {
		const out = {};
		CURSOS.forEach((c) => (out[c.id] = ninos.filter((n) => inscrito(n, c.columna)).length));
		return out;
	}, [ninos]);

	const filas = useMemo(
		() =>
			ninos
				.filter((n) => inscrito(n, curso.columna))
				.map((n) => ({ n, id: idNinoDe(n), est: estadoCurso(recibos, idNinoDe(n), cursoId, anio) }))
				.sort(
					(a, b) =>
						rankGrado(a.n.grado) - rankGrado(b.n.grado) ||
						(a.n.nombre_completo ?? "").localeCompare(b.n.nombre_completo ?? "", "es")
				),
		[ninos, recibos, curso, cursoId, anio]
	);

	const resumen = useMemo(() => {
		const deben = filas.filter((f) => f.est.debe.length > 0);
		const mesesDeuda = deben.reduce((a, f) => a + f.est.debe.length, 0);
		return {
			inscritos: filas.length,
			alDia: filas.length - deben.length,
			deben: deben.length,
			mesesDeuda,
			valorDeuda: mesesDeuda * tarifa,
		};
	}, [filas, tarifa]);

	const visibles = useMemo(() => {
		const q = busqueda.trim().toLowerCase();
		return filas.filter((f) => {
			if (filtro === "deben" && f.est.debe.length === 0) return false;
			if (filtro === "aldia" && f.est.debe.length > 0) return false;
			if (q && !(f.n.nombre_completo ?? "").toLowerCase().includes(q)) return false;
			return true;
		});
	}, [filas, filtro, busqueda]);

	// Al cambiar de curso, deja seleccionado el primero de la lista
	useEffect(() => {
		if (!visibles.some((f) => f.id === ninoSel)) setNinoSel(visibles[0]?.id ?? null);
	}, [visibles]); // eslint-disable-line react-hooks/exhaustive-deps

	const sel = filas.find((f) => f.id === ninoSel);

	return (
		<main className="rc-main rc-main-wide no-print">
			{/* ---- Selector de curso ---- */}
			<section className="rc-card cu-top">
				<div className="rc-card-head" style={{ marginBottom: 14 }}>
					<h2 className="rc-h2" style={{ margin: 0 }}>Cursos extracurriculares</h2>
					<div className="cu-top-acciones">
						<div className="rc-nav">
							<button onClick={() => setAnio((a) => a - 1)} aria-label="Año anterior">‹</button>
							<span className="cu-anio">{anio}</span>
							<button onClick={() => setAnio((a) => a + 1)} aria-label="Año siguiente">›</button>
						</div>
						<button className="rc-refresh" onClick={onRecargar} disabled={cargando}>
							<span className={cargando ? "spin" : ""}>↻</span>
							{cargando ? "Cargando…" : "Recargar"}
						</button>
					</div>
				</div>

				<div className="cu-chips">
					{CURSOS.map((c) => (
						<button
							key={c.id}
							className={`cu-chip ${c.id === cursoId ? "on" : ""}`}
							onClick={() => setCursoId(c.id)}
						>
							<span>{nombreCurso(c)}</span>
							<em>{conteos[c.id]}</em>
						</button>
					))}
				</div>
			</section>

			{/* ---- Indicadores del curso ---- */}
			<section className="rc-stats rc-stats-4">
				<div className="rc-stat rc-stat-main">
					<span>Por cobrar a la fecha</span>
					<strong>{COP(resumen.valorDeuda)}</strong>
					<small className="cu-small-claro">{resumen.mesesDeuda} mensualidades · tarifa {COP(tarifa)}</small>
				</div>
				<div className="rc-stat">
					<span>Inscritos</span>
					<strong>{resumen.inscritos}</strong>
				</div>
				<div className="rc-stat cu-stat-ok">
					<span>Al día</span>
					<strong>{resumen.alDia}</strong>
				</div>
				<div className="rc-stat rc-stat-err">
					<span>Con deuda</span>
					<strong>{resumen.deben}</strong>
				</div>
			</section>

			{filas.length === 0 ? (
				<section className="rc-card">
					<p className="rc-hint" style={{ margin: 0 }}>
						No hay estudiantes inscritos en <b>{nombreCurso(curso)}</b>. Escribe <b>OK</b> en la columna{" "}
						<b>{curso.columna}</b> de la hoja Niños y presiona Recargar arriba (o Actualizar en la barra
						superior).
					</p>
				</section>
			) : (
				<div className="cu-grid">
					{/* ---- Lista de estudiantes ---- */}
					<section className="rc-card cu-lista">
						<div className="cu-lista-head">
							<div className="rc-seg">
								{[["todos", "Todos"], ["deben", "Deben"], ["aldia", "Al día"]].map(([k, l]) => (
									<button key={k} className={filtro === k ? "on" : ""} onClick={() => setFiltro(k)}>
										{l}
									</button>
								))}
							</div>
							<input
								className="rc-lock-input"
								value={busqueda}
								onChange={(e) => setBusqueda(e.target.value)}
								placeholder="Buscar estudiante"
							/>
						</div>

						<ul className="cu-ninos">
							{visibles.map((f) => (
								<li key={f.id}>
									<button
										className={`cu-nino ${f.id === ninoSel ? "on" : ""}`}
										onClick={() => setNinoSel(f.id)}
									>
										<div className="cu-nino-txt">
											<b>{f.n.nombre_completo}</b>
											<span>{f.n.grado}</span>
										</div>
										<div className="cu-barra" aria-hidden="true">
											{f.est.meses.map((m) => (
												<i key={m.key} className={`is-${m.estado}`} />
											))}
										</div>
										{f.est.debe.length > 0 ? (
											<span className="cu-badge cu-badge-debe">Debe {f.est.debe.length}</span>
										) : (
											<span className="cu-badge cu-badge-ok">Al día</span>
										)}
									</button>
								</li>
							))}
							{visibles.length === 0 && <li className="rc-hint">Nadie coincide con el filtro.</li>}
						</ul>
					</section>

					{/* ---- Detalle del estudiante ---- */}
					{sel && (
						<section className="rc-card cu-detalle">
							<div className="cu-det-head">
								<div>
									<p className="cu-kicker">{nombreCurso(curso)} · {anio}</p>
									<h3>{sel.n.nombre_completo}</h3>
									<p className="rc-hint" style={{ margin: "2px 0 0" }}>
										{sel.n.grado}
										{sel.n.acudiente ? ` · ${sel.n.acudiente}` : ""}
										{sel.n.telefono && sel.n.telefono !== 1 ? ` · ${sel.n.telefono}` : ""}
									</p>
								</div>
								<div className={`cu-veredicto ${sel.est.debe.length ? "is-debe" : "is-ok"}`}>
									{sel.est.debe.length ? (
										<>
											<b>Debe {sel.est.debe.length}</b>
											<span>{COP(sel.est.debe.length * tarifa)}</span>
										</>
									) : (
										<>
											<b>Al día</b>
											<span>{sel.est.pagados} de 10 pagos</span>
										</>
									)}
								</div>
							</div>

							{sel.est.debe.length > 0 && (
								<p className="cu-debe-txt">
									Debe{" "}
									{sel.est.debe.map((m, i) => (
										<span key={m.key}>
											<b>{etiquetaMes(m.key, false)}</b>
											{i < sel.est.debe.length - 2 ? ", " : i === sel.est.debe.length - 2 ? " y " : ""}
										</span>
									))}
									.
								</p>
							)}

							<div className="cu-meses">
								{sel.est.meses.map((m) => (
									<div key={m.key} className={`cu-mes is-${m.estado}`}>
										<span className="cu-mes-nombre">{etiquetaMes(m.key, false)}</span>
										{m.estado === "pagado" ? (
											<>
												<b>Pagado</b>
												<small>
													N° {numRecibo(m.pago.id_recibo)} · {fmtFecha(m.pago.fecha)}
												</small>
											</>
										) : m.estado === "debe" ? (
											<b>Debe</b>
										) : (
											<b>Pendiente</b>
										)}
									</div>
								))}
							</div>

							{sel.est.sinMes.length > 0 && (
								<p className="cu-aviso">
									⚠ {sel.est.sinMes.length} pago(s) de este curso sin mes asignado (recibo{" "}
									{sel.est.sinMes.map((p) => `N° ${numRecibo(p.id_recibo)}`).join(", ")}). Son anteriores
									al control por meses: revísalos y, si corresponde, escribe el mes en la columna
									<b> mes</b> de la hoja Recibos (formato 2026-03).
								</p>
							)}

							<div className="cu-acciones">
								<span className="cu-leyenda">
									<i className="is-pagado" /> Pagado <i className="is-debe" /> Debe <i className="is-pendiente" />{" "}
									Pendiente
								</span>
								{sel.est.debe.length > 0 && (
									<button
										className="rc-primary"
										onClick={() => onCobrar(sel.n, cursoId, sel.est.debe.map((m) => m.key))}
									>
										Cobrar {sel.est.debe.length} {sel.est.debe.length === 1 ? "mes" : "meses"} ·{" "}
										{COP(sel.est.debe.length * tarifa)}
									</button>
								)}
							</div>
						</section>
					)}
				</div>
			)}
		</main>
	);
}
