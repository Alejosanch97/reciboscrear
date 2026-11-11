import { COP, NOMBRE_COLEGIO, numRecibo, fmtFecha, etiquetaMes } from "../../pages/utils.js";

/* ======================================================
   TICKET TÉRMICO (recibo para el acudiente / archivo)
   ====================================================== */
export function Ticket({ copia, data }) {
	return (
		<div className="ticket">
			<div className="t-inst">{NOMBRE_COLEGIO}</div>
			<div className="t-sub">Recibo de caja</div>
			<div className="t-copia">{copia}</div>

			<div className="t-row t-big">
				<span>N° {numRecibo(data.numero)}</span>
				<span>
					{fmtFecha(data.fecha)}
					{data.hora ? ` ${data.hora}` : ""}
				</span>
			</div>
			<div className="t-dash" />

			{data.items.map((it, i) => (
				<div className="t-item" key={i}>
					<div className="t-est">{it.estudiante}</div>
					<div className="t-gr">{it.grado}</div>
					<div className="t-row">
						<span>
							{it.concepto}
							{it.mes ? <span className="t-mes"> · {etiquetaMes(it.mes)}</span> : null}
						</span>
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

			{data.usuario ? <div className="t-atendio">Atendió: {data.usuario}</div> : null}
			<div className="t-foot">Conserve este recibo · Gracias</div>
		</div>
	);
}

/* ======================================================
   RESUMEN GERENCIAL — hoja carta (impresora normal)
   ====================================================== */
export function ResumenCarta({ data }) {
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
					{data.impresoPor && <div><span>Por</span><b>{data.impresoPor}</b></div>}
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
			{data.conceptos.length === 0 ? (
				<p className="rs-vacio">No hubo cobros en este periodo.</p>
			) : (
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
							<tr key={c.concepto}>
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
			)}

			{data.porUsuario.length > 0 && (
				<>
					<h3 className="rs-h3">Recaudo por usuario</h3>
					<table className="rs-tabla">
						<thead>
							<tr>
								<th>Usuario</th>
								<th className="rs-r">Recibos</th>
								<th className="rs-r">Total</th>
							</tr>
						</thead>
						<tbody>
							{data.porUsuario.map((u) => (
								<tr key={u.usuario}>
									<td>{u.usuario}</td>
									<td className="rs-r">{u.recibos}</td>
									<td className="rs-r"><b>{COP(u.total)}</b></td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}

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
							<th>Usuario</th>
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
									<td>
										{it.concepto}
										{it.mes ? ` · ${etiquetaMes(it.mes)}` : ""}
									</td>
									<td className="rs-r">{COP(it.valor)}</td>
									<td>{i === 0 ? g.usuario || "—" : ""}</td>
									<td>
										{i === 0
											? g.estado === "ANULADO"
												? `Anulado${g.anulado_por ? ` por ${g.anulado_por}` : ""}${g.motivo ? ` · ${g.motivo}` : ""}`
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
