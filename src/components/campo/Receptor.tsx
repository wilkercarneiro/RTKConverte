// A aba "Receptor RTK" do painel Precisão: o receptor GNSS do agrimensor ligado
// direto no navegador (Web Serial sobre Bluetooth SPP no Chrome do Android 138+,
// ou USB/Bluetooth no computador; Web Bluetooth BLE com UART), e a correção NTRIP
// (RBMC-IP do IBGE ou a rede que ele assina) repassada pelo servidor.
// Pesquisa: docs/pesquisa-tecnologias-precisao-gps.md, seção 1.
import { useMemo, useState, useSyncExternalStore } from "react";
import { CASTER_RBMC, listarMontagens } from "../../lib/campo/ntrip.ts";
import type { ConfigNtrip, Montagem } from "../../lib/campo/ntrip.ts";
import { suporteReceptor } from "../../lib/campo/receptor.ts";
import type { Receptor } from "../../lib/campo/receptor.ts";
import { distanciaM, textoDistancia, textoPrecisao } from "../../lib/campo/geometria.ts";
import type { Leitura, TipoFix } from "../../lib/campo/tipos.ts";
import { Dica } from "../ui";
import { AjudaReceptor } from "./Precisao";

const CHAVE_NTRIP = "vertces.campo.ntrip";
interface Armazem { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const NOME_FIX: Record<TipoFix, string> = {
  "rtk-fixo": "RTK fixo", "rtk-flutuante": "RTK flutuante", dgps: "DGPS", autonomo: "Autônomo", "sem-fix": "Sem solução",
};

interface NtripGuardado extends ConfigNtrip { lembrarSenha: boolean }

function lerNtrip(arm: Armazem | null): NtripGuardado {
  const padrao: NtripGuardado = { host: CASTER_RBMC.host, porta: CASTER_RBMC.porta, montagem: "", usuario: "", senha: "", enviarGga: true, lembrarSenha: true };
  try {
    const v = JSON.parse(arm?.getItem(CHAVE_NTRIP) ?? "null") as Partial<NtripGuardado> | null;
    return v ? { ...padrao, ...v, porta: Number(v.porta) || padrao.porta } : padrao;
  } catch { return padrao; }
}

export interface PropsReceptor {
  receptor: Receptor;
  arm: Armazem | null;
  leitura: Leitura | null;
  exigirFixo: boolean;
  onExigirFixo: (v: boolean) => void;
}

export function PainelReceptor({ receptor, arm, leitura, exigirFixo, onExigirFixo }: PropsReceptor) {
  const est = useSyncExternalStore(receptor.assinar, receptor.estado, receptor.estado);
  const suporte = useMemo(() => suporteReceptor(), []);
  const [cfg, setCfgEstado] = useState<NtripGuardado>(() => lerNtrip(arm));
  const [montagens, setMontagens] = useState<Montagem[] | null>(null);
  const [listando, setListando] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [ligando, setLigando] = useState(false);
  const [erroLigar, setErroLigar] = useState<string | null>(null);

  const setCfg = (c: NtripGuardado) => {
    setCfgEstado(c);
    try { arm?.setItem(CHAVE_NTRIP, JSON.stringify(c.lembrarSenha ? c : { ...c, senha: "" })); } catch { /* fica só nesta visita */ }
  };

  if (!suporte.serial && !suporte.bluetooth) return <AjudaReceptor semConexaoDireta />;

  async function ligar(como: "serial" | "bluetooth") {
    setLigando(true); setErroLigar(null);
    try {
      if (como === "serial") await receptor.conectarSerial(); else await receptor.conectarBluetooth();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // a pessoa fechou a janela de escolha: não é erro
      if (!/cancel|No port selected|User cancelled|NotFoundError/i.test(msg)) setErroLigar(msg);
    } finally { setLigando(false); }
  }

  async function listar() {
    setListando(true); setErroLista(null);
    try {
      const ms = await listarMontagens(cfg);
      const aqui = leitura;
      ms.sort((a, b) => (aqui && a.lat != null && a.lon != null && b.lat != null && b.lon != null)
        ? distanciaM(aqui, { lon: a.lon, lat: a.lat }) - distanciaM(aqui, { lon: b.lon, lat: b.lat })
        : a.nome.localeCompare(b.nome));
      setMontagens(ms);
    } catch (e) { setErroLista(e instanceof Error ? e.message : String(e)); } finally { setListando(false); }
  }

  const ntripLigado = est.ntrip.estado !== "desligado";
  const fix = est.fix;
  const classeFix = fix === "rtk-fixo" ? "boa" : fix === "rtk-flutuante" || fix === "dgps" ? "media" : "ruim";
  const escolhida = montagens?.find((m) => m.nome === cfg.montagem) ?? null;

  return (
    <div className="campo-precisao">
      <p className="campo-sub">
        Ligue o receptor GNSS pelo Bluetooth. Com a correção (NTRIP) em RTK fixo, o vértice sai com a precisão do receptor (centímetros), apto para o SIGEF.
        <Dica>Funciona no Chrome do Android (Bluetooth comum, o mesmo das coletoras) e no computador (USB ou Bluetooth). Pareie o receptor nas configurações do Android antes. No iPhone, use um receptor certificado pela Apple (veja "Outros caminhos" abaixo).</Dica>
      </p>

      <section className="campo-precisao-bloco">
        <b>Receptor</b>
        {!est.conectado ? (
          <>
            <div className="campo-acoes-linha">
              {suporte.serial && <button type="button" className="principal" disabled={ligando} onClick={() => void ligar("serial")}>{ligando ? "Ligando…" : "Ligar receptor (Bluetooth)"}</button>}
              {suporte.bluetooth && <button type="button" disabled={ligando} onClick={() => void ligar("bluetooth")}>Bluetooth LE</button>}
            </div>
            <span className="campo-sub">Escolha o receptor na lista que o navegador abre. Se ele não aparece, confira se está pareado e ligado.</span>
            {(erroLigar || est.erro) && <p className="campo-alerta" role="alert">{erroLigar ?? est.erro}</p>}
          </>
        ) : (
          <>
            <div className="campo-receptor-status">
              <span className={`campo-gps-selo ${classeFix}${fix === "rtk-fixo" ? " rtk" : ""}`}><i aria-hidden="true" />{fix ? NOME_FIX[fix] : "Esperando a posição"}</span>
              <span>{est.nome ?? "Receptor"}</span>
            </div>
            <dl className="campo-receptor-num">
              <div><dt>Precisão</dt><dd>{textoPrecisao(est.ultimaLeitura?.precisao ?? null)}</dd></div>
              <div><dt>Satélites</dt><dd>{est.sats ?? "—"}</dd></div>
              <div><dt>HDOP</dt><dd>{est.hdop != null ? est.hdop.toFixed(1).replace(".", ",") : "—"}</dd></div>
              <div><dt>Correção</dt><dd>{est.idadeCorrecaoS != null ? `${est.idadeCorrecaoS.toFixed(0)} s` : "—"}</dd></div>
            </dl>
            <button type="button" className="fantasma" onClick={() => void receptor.desconectar()}>Desligar o receptor</button>
          </>
        )}
      </section>

      <section className="campo-precisao-bloco">
        <b>Correção (NTRIP)
          <Dica>A RBMC-IP do IBGE é gratuita: peça o usuário e a senha no site do IBGE ("Obter acesso à RBMC-IP"). Escolha a estação mais perto (o sistema ordena pela distância). Se a sua rede é outra (PointPerfect, GEODNET, a sua base), troque o endereço e a porta. Se o receptor já recebe a correção por conta própria (rádio, chip), deixe esta parte desligada.</Dica>
        </b>
        <div className="campo-ntrip-linha caster">
          <label><span>Endereço do caster</span><input value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value.trim() })} autoComplete="off" /></label>
          <label><span>Porta</span><input type="number" inputMode="numeric" value={cfg.porta} onChange={(e) => setCfg({ ...cfg, porta: Number(e.target.value) || 2101 })} /></label>
        </div>
        <div className="campo-ntrip-linha">
          <label><span>Usuário</span><input value={cfg.usuario} onChange={(e) => setCfg({ ...cfg, usuario: e.target.value })} autoComplete="username" /></label>
          <label><span>Senha</span><input type="password" value={cfg.senha} onChange={(e) => setCfg({ ...cfg, senha: e.target.value })} autoComplete="current-password" /></label>
        </div>
        <div className="campo-ir-linha">
          {montagens?.length ? (
            <select value={cfg.montagem} onChange={(e) => { const m = montagens.find((x) => x.nome === e.target.value); setCfg({ ...cfg, montagem: e.target.value, enviarGga: m ? m.nmea || m.solucao === "rede" : cfg.enviarGga }); }} aria-label="Ponto de montagem">
              <option value="">Escolha a estação…</option>
              {montagens.map((m) => (
                <option key={m.nome} value={m.nome}>
                  {m.nome}{m.identificador ? ` · ${m.identificador}` : ""}{leitura && m.lat != null && m.lon != null ? ` · ${textoDistancia(distanciaM(leitura, { lon: m.lon, lat: m.lat }))}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input value={cfg.montagem} onChange={(e) => setCfg({ ...cfg, montagem: e.target.value.trim() })} placeholder="Ponto de montagem (ex.: BAVC0)" aria-label="Ponto de montagem" />
          )}
          <button type="button" disabled={listando || !cfg.host} onClick={() => void listar()}>{listando ? "Buscando…" : "Listar estações"}</button>
        </div>
        {erroLista && <p className="campo-alerta" role="alert">{erroLista}</p>}
        {escolhida && <span className="campo-sub">{escolhida.formato} · {escolhida.navegacao}{escolhida.solucao === "rede" ? " · solução de rede (manda a posição ao caster)" : ""}</span>}
        <label className="campo-chave"><input type="checkbox" checked={cfg.enviarGga} onChange={(e) => setCfg({ ...cfg, enviarGga: e.target.checked })} /><span>Mandar a posição ao caster (rede VRS pede)</span></label>
        <label className="campo-chave"><input type="checkbox" checked={cfg.lembrarSenha} onChange={(e) => setCfg({ ...cfg, lembrarSenha: e.target.checked })} /><span>Lembrar a senha neste aparelho</span></label>
        <div className="campo-acoes-linha">
          {!ntripLigado
            ? <button type="button" className="principal" disabled={!est.conectado || !cfg.montagem || !cfg.host} onClick={() => receptor.ligarNtrip(cfg)}>Ligar a correção</button>
            : <button type="button" onClick={() => receptor.desligarNtrip()}>Desligar a correção</button>}
        </div>
        {!est.conectado && <span className="campo-sub">Ligue o receptor primeiro.</span>}
        {ntripLigado && (
          <p className={est.ntrip.estado === "erro" ? "campo-alerta" : "campo-sub"} role="status">
            {est.ntrip.estado === "conectando" ? "Conectando ao caster…"
              : est.ntrip.estado === "recebendo" ? `Recebendo a correção · ${(est.ntrip.bytes / 1024).toFixed(0)} KB`
                : est.ntrip.mensagem ?? "A correção caiu; tentando de novo."}
          </p>
        )}
      </section>

      <section className="campo-precisao-bloco">
        <label className="campo-chave">
          <input type="checkbox" checked={exigirFixo} onChange={(e) => onExigirFixo(e.target.checked)} />
          <span>Só aceitar vértice em RTK fixo (ponto de SIGEF)</span>
        </label>
        <span className="campo-sub">Andando, a posição que não for RTK fixo não vira vértice; no Marcar ponto, o sistema avisa e pergunta.</span>
      </section>

      <details className="campo-como">
        <summary>Outros caminhos (iPhone, app de local fictício)</summary>
        <AjudaReceptor />
      </details>
    </div>
  );
}
