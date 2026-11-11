import { useState, useEffect } from "react";
import { iniciarSesion } from "../../pages/api.js";

// Escudo del colegio. Si algún día falla el link, descarga la imagen,
// guárdala en /public/escudo.jpg y cambia esta línea por: "/escudo.jpg"
export const ESCUDO_URL = "https://i.pinimg.com/736x/db/1e/03/db1e03964f0c50df7b69c3aa10bba738.jpg";

export function Escudo({ className = "" }) {
	const [falla, setFalla] = useState(false);
	return (
		<span className={`escudo ${className}`}>
			{falla ? (
				<b>IC</b>
			) : (
				<img src={ESCUDO_URL} alt="Escudo Instituto Pedagógico Crear" onError={() => setFalla(true)} />
			)}
		</span>
	);
}

const IcoUsuario = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<circle cx="12" cy="8" r="4" />
		<path d="M4 20c1.6-3.6 4.5-5.4 8-5.4s6.4 1.8 8 5.4" />
	</svg>
);
const IcoCandado = () => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<rect x="5" y="10.5" width="14" height="10" rx="2.5" />
		<path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
	</svg>
);
const IcoOjo = ({ abierto }) => (
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
		<circle cx="12" cy="12" r="3" />
		{!abierto && <path d="M4 4l16 16" />}
	</svg>
);

export function Login({ onLogin, aviso }) {
	const [usuario, setUsuario] = useState("");
	const [clave, setClave] = useState("");
	const [ver, setVer] = useState(false);
	const [mayus, setMayus] = useState(false);
	const [error, setError] = useState(aviso || "");
	const [entrando, setEntrando] = useState(false);
	const [sacudir, setSacudir] = useState(false);
	const [bienvenida, setBienvenida] = useState(null);
	const [ahora, setAhora] = useState(new Date());

	useEffect(() => {
		const t = setInterval(() => setAhora(new Date()), 15000);
		return () => clearInterval(t);
	}, []);

	const entrar = async (e) => {
		e.preventDefault();
		if (entrando) return;
		setError("");
		setEntrando(true);
		try {
			const sesion = await iniciarSesion(usuario.trim(), clave);
			setBienvenida(sesion);
			setTimeout(() => onLogin(sesion), 1100);
		} catch (err) {
			setError(err.message || "No se pudo iniciar sesión");
			setEntrando(false);
			setSacudir(true);
			setTimeout(() => setSacudir(false), 500);
		}
	};

	const revisarMayus = (e) => setMayus(!!e.getModifierState?.("CapsLock"));
	const hora = ahora.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
	const fechaTxt = ahora.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
	const fecha = fechaTxt.charAt(0).toUpperCase() + fechaTxt.slice(1);

	return (
		<div className="lg">
			{/* ================= IZQUIERDA ================= */}
			<section className="lg-izq">
				<header className="lg-marca">
					<Escudo className="lg-escudo" />
					<div>
						<b>Instituto Pedagógico Crear</b>
						<span>Sistema de caja y recaudo</span>
					</div>
				</header>

				<div className="lg-centro">
					<p className="lg-kicker">Libro de caja · {ahora.getFullYear()}</p>
					<h1 className="lg-titulo">
						Cada peso,
						<br />
						<em>en su lugar.</em>
					</h1>
					<p className="lg-bajada">
						Recibos al instante, cursos al día y cierres de caja firmados por quien los hace.
					</p>
				</div>

				<footer className="lg-cifras">
					<div><b>02</b><span>copias por recibo</span></div>
					<div><b>10</b><span>meses por curso</span></div>
					<div><b>100%</b><span>movimientos firmados</span></div>
				</footer>
			</section>

			{/* ================= DERECHA ================= */}
			<section className="lg-der">
				<form className={`lg-card ${sacudir ? "is-sacudir" : ""}`} onSubmit={entrar}>
					<div className="lg-card-top">
						<span>{fecha}</span>
						<span className="lg-hora">{hora}</span>
					</div>

					<h2>Abrir la caja</h2>
					<p className="lg-sub">Ingresa con tu usuario. Todo lo que registres queda firmado a tu nombre.</p>

					<label className="lg-label" htmlFor="lg-usuario">Usuario</label>
					<div className="lg-input">
						<IcoUsuario />
						<input
							id="lg-usuario"
							value={usuario}
							onChange={(e) => setUsuario(e.target.value)}
							placeholder="tu.usuario"
							autoComplete="username"
							autoCapitalize="none"
							spellCheck="false"
							autoFocus
							required
						/>
					</div>

					<label className="lg-label" htmlFor="lg-clave">Contraseña</label>
					<div className="lg-input">
						<IcoCandado />
						<input
							id="lg-clave"
							type={ver ? "text" : "password"}
							value={clave}
							onChange={(e) => setClave(e.target.value)}
							onKeyUp={revisarMayus}
							onKeyDown={revisarMayus}
							placeholder="••••••••"
							autoComplete="current-password"
							required
						/>
						<button
							type="button"
							className="lg-ojo"
							onClick={() => setVer((v) => !v)}
							aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
						>
							<IcoOjo abierto={ver} />
						</button>
					</div>
					{mayus && <p className="lg-mayus">Bloq Mayús está activado</p>}

					{error && <div className="lg-error">{error}</div>}

					<button className="lg-btn" type="submit" disabled={entrando}>
						{entrando ? (
							<>
								<span className="lg-spin" /> Verificando
							</>
						) : (
							<>
								Entrar <span className="lg-flecha">→</span>
							</>
						)}
					</button>

					<p className="lg-pie">La sesión se cierra tras 10 minutos sin actividad.</p>

					{bienvenida && (
						<div className="lg-ok">
							<svg viewBox="0 0 52 52" aria-hidden="true">
								<circle cx="26" cy="26" r="24" />
								<path d="M15 27l7 7 15-15" />
							</svg>
							<b>Hola, {(bienvenida.nombre || bienvenida.usuario).split(" ")[0]}</b>
							<span>Abriendo la caja…</span>
						</div>
					)}
				</form>
			</section>
		</div>
	);
}