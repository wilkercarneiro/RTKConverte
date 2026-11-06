// Terraplanagem (#/terraplanagem): quanto custa deixar o terreno plano para
// galpão, casa ou quadra — corte, aterro, saldo e caminhões. Plano em
// docs/plano-ferramentas-campo-consulta-terraplanagem.md, seção 4.
//
// Entrada: soltar o arquivo do levantamento já abre o resultado (a cota de
// equilíbrio e a plataforma no contorno dos pontos são o padrão). Sem
// levantamento, o relevo público dá uma estimativa a partir de uma coordenada,
// de um link do Google Maps ou de um KML. Tudo grava sozinho: no aparelho e na conta.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Rota } from "../../lib/rota";
import { supabase } from "../../lib/supabase";
import type { ResultadoTerraplanagem } from "../../lib/terraplanagem/calculo.ts";
import { fmtN } from "../../lib/terraplanagem/calculo.ts";
import { ACEITOS_PONTOS, lerArquivoDePontos, lerCoordenada, lerPoligonoKml, quadradoEm, terrenoPublico } from "../../lib/terraplanagem/entrada.ts";
import type { Pt } from "../../lib/terraplanagem/geometria.ts";
import type { ProjetoTerraplanagem } from "../../lib/terraplanagem/modelo.ts";
import { projetoNovo } from "../../lib/terraplanagem/modelo.ts";
import type { Armazenamento, ResumoTerraplanagem } from "../../lib/terraplanagem/persistencia.ts";
import { armazenamentoConta, armazenamentoLocal } from "../../lib/terraplanagem/persistencia.ts";
import { Icone, ICONE } from "../Icone";
import { BotaoPerigo, CabecalhoPagina, Dica, EstadoErro, EstadoVazio, Esqueleto, avisar } from "../ui";
import { EditorTerraplanagem } from "./EditorTerraplanagem";
import type { EstadoGravacao } from "./EditorTerraplanagem";
import "./terraplanagem.css";

const ULTIMO = "vertces.terraplanagem.ultimo";
const hora = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const semExt = (s: string) => s.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();

function quando(iso: string): string {
  const d = new Date(iso), agora = Date.now();
  const min = Math.round((agora - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24 && d.getDate() === new Date().getDate()) return `hoje às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const resumoDe = (p: ProjetoTerraplanagem, r: ResultadoTerraplanagem | null): ResumoTerraplanagem => ({
  id: p.id, nome: p.nome, atualizadoEm: p.atualizadoEm, nPontos: p.pontos.length,
  corte: r ? Math.round(r.corte * 10) / 10 : null, aterro: r ? Math.round(r.aterro * 10) / 10 : null, cota: r ? Math.round(r.cota * 1000) / 1000 : null,
});

export function Terraplanagem({ ir, armazenamento = armazenamentoConta, inicial = null, emitente: emitenteFixo }: {
  ir: (r: Rota) => void;
  armazenamento?: Armazenamento;
  /** projeto aberto ao entrar (laboratório) */
  inicial?: ProjetoTerraplanagem | null;
  emitente?: string | null;
}) {
  void ir;
  const [projeto, setProjeto] = useState<ProjetoTerraplanagem | null>(inicial);
  const [avisosLeitura, setAvisosLeitura] = useState<string[]>([]);
  const [trocando, setTrocando] = useState(false);
  const [gravacao, setGravacao] = useState<EstadoGravacao>({ estado: "ocioso", hora: null });
  const [emitente, setEmitente] = useState<string | null>(emitenteFixo ?? null);
  const sujo = useRef(false);
  /** a última versão editada ainda não gravada (para gravar ao voltar ou sair da tela) */
  const pendente = useRef<ProjetoTerraplanagem | null>(null);
  const resultado = useRef<ResultadoTerraplanagem | null>(null);
  const [resumoChave, setResumoChave] = useState("");

  // quem emite o relatório (razão social da empresa)
  useEffect(() => {
    if (emitenteFixo !== undefined || armazenamento !== armazenamentoConta) return;
    let vivo = true;
    void Promise.resolve(supabase.from("config_empresa").select("value").eq("key", "razao_social").maybeSingle())
      .then(({ data }) => { if (vivo && data?.value) setEmitente(String(data.value)); }, () => { /* sem empresa: sem emitente */ });
    return () => { vivo = false; };
  }, [armazenamento, emitenteFixo]);

  // grava sozinho (no aparelho e na conta), 0,9 s depois da última mudança
  const salvar = useCallback(async (p: ProjetoTerraplanagem) => {
    setGravacao((g) => ({ ...g, estado: "salvando" }));
    try {
      const g = await armazenamento.salvar(p, resumoDe(p, resultado.current));
      setGravacao(g.naConta ? { estado: "conta", hora: hora(), motivo: g.motivo }
        : g.noAparelho ? { estado: "aparelho", hora: hora(), motivo: g.motivo }
        : { estado: "falhou", hora: hora(), motivo: g.motivo });
      // gravou e ninguém mexeu depois: nada pendente
      if ((g.naConta || g.noAparelho) && pendente.current === p) { sujo.current = false; pendente.current = null; }
    } catch (e) {
      setGravacao({ estado: "falhou", hora: hora(), motivo: e instanceof Error ? e.message : String(e) });
    }
    try { localStorage.setItem(ULTIMO, p.id); } catch { /* sem storage */ }
  }, [armazenamento]);
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  /** grava já o que estiver pendente (voltar à lista, sair da tela, fechar a aba) */
  const gravarPendente = useCallback(() => {
    const p = pendente.current;
    if (!p || !sujo.current) return;
    void salvarRef.current(p);
  }, []);
  useEffect(() => {
    if (!projeto || !sujo.current) return;
    const t = setTimeout(() => void salvar(projeto), 900);
    return () => clearTimeout(t);
  }, [projeto, resumoChave, salvar]);
  // fechou a aba ou trocou de tela pelo menu no meio da digitação: grava na hora
  useEffect(() => {
    const sair = () => { const p = pendente.current; if (p && sujo.current) void armazenamentoLocal.salvar(p, resumoDe(p, resultado.current)); };
    addEventListener("pagehide", sair);
    return () => { removeEventListener("pagehide", sair); gravarPendente(); };
  }, [gravarPendente]);

  const editar = (p: ProjetoTerraplanagem) => {
    sujo.current = true;
    const novo = { ...p, atualizadoEm: new Date().toISOString() };
    pendente.current = novo;
    setProjeto(novo);
  };

  const abrirNovo = (p: ProjetoTerraplanagem, avisos: string[]) => {
    resultado.current = null;
    setAvisosLeitura(avisos);
    sujo.current = true;
    pendente.current = p;
    setTrocando(false);
    setGravacao({ estado: "ocioso", hora: null });
    setProjeto(p);
  };

  if (projeto && !trocando) {
    return (
      <EditorTerraplanagem
        key={projeto.id}
        projeto={projeto}
        onProjeto={editar}
        onResultado={(r) => { resultado.current = r; setResumoChave(r ? `${r.corte.toFixed(1)}|${r.aterro.toFixed(1)}|${r.cota.toFixed(3)}` : ""); }}
        onTrocarPontos={() => { gravarPendente(); setTrocando(true); }}
        gravacao={gravacao}
        avisosLeitura={avisosLeitura}
        emitente={emitente}
        topo={
          <div className="tp-topo-nome">
            <button type="button" className="fantasma cp-voltar" onClick={() => { gravarPendente(); setProjeto(null); setAvisosLeitura([]); setGravacao({ estado: "ocioso", hora: null }); }}>← Terraplanagens</button>
            <input className="tp-nome" aria-label="Nome do projeto" value={projeto.nome} maxLength={120}
              onChange={(e) => editar({ ...projeto, nome: e.target.value })}
              onBlur={(e) => { if (!e.target.value.trim()) editar({ ...projeto, nome: "Terraplanagem" }); }} />
          </div>
        } />
    );
  }

  return (
    <Inicio armazenamento={armazenamento} trocando={trocando ? projeto : null} onCancelarTroca={() => setTrocando(false)}
      onAbrir={async (id) => {
        try {
          const p = await armazenamento.carregar(id);
          if (!p) { avisar("erro", "Este projeto não foi encontrado (apagado em outro aparelho?)."); return; }
          sujo.current = false; pendente.current = null; resultado.current = null; setAvisosLeitura([]);
          setGravacao({ estado: "ocioso", hora: null });
          setProjeto(p);
          try { localStorage.setItem(ULTIMO, p.id); } catch { /* sem storage */ }
        } catch (e) { avisar("erro", `Não deu para abrir: ${e instanceof Error ? e.message : String(e)}`); }
      }}
      onPontos={(pontos, nome, fonte, fuso, avisos, plataforma) => {
        if (trocando && projeto) {
          abrirNovo({ ...projeto, pontos, fonte, fuso: projeto.fuso ?? fuso, atualizadoEm: new Date().toISOString(), plataforma: plataforma ?? projeto.plataforma }, avisos);
          avisar("ok", `Pontos trocados: ${fmtN(pontos.length, 0)} pontos.`);
          return;
        }
        const p = projetoNovo(nome, pontos, fonte, fuso);
        abrirNovo(plataforma ? { ...p, plataforma } : p, avisos);
      }} />
  );
}

type AoPontos = (pontos: ProjetoTerraplanagem["pontos"], nome: string, fonte: ProjetoTerraplanagem["fonte"], fuso: number | null, avisos: string[], plataforma?: ProjetoTerraplanagem["plataforma"]) => void;

function Inicio({ armazenamento, trocando, onCancelarTroca, onAbrir, onPontos }: {
  armazenamento: Armazenamento;
  trocando: ProjetoTerraplanagem | null;
  onCancelarTroca: () => void;
  onAbrir: (id: string) => void;
  onPontos: AoPontos;
}) {
  const [lista, setLista] = useState<{ estado: "carregando" } | { estado: "erro"; msg: string } | { estado: "ok"; itens: ResumoTerraplanagem[]; soNoAparelho: boolean; semConexao?: boolean }>({ estado: "carregando" });
  const [lendo, setLendo] = useState(false);
  const [falha, setFalha] = useState<string[] | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [coord, setCoord] = useState("");
  const [relevo, setRelevo] = useState<{ estado: "ocioso" | "buscando" } | { estado: "erro"; msg: string }>({ estado: "ocioso" });
  const kmlRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(() => {
    setLista({ estado: "carregando" });
    armazenamento.listar().then((r) => setLista({ estado: "ok", ...r }), (e) => setLista({ estado: "erro", msg: e instanceof Error ? e.message : String(e) }));
  }, [armazenamento]);
  useEffect(() => { carregar(); }, [carregar]);

  const arquivo = async (f: File) => {
    setLendo(true); setFalha(null);
    try {
      const l = await lerArquivoDePontos(f);
      if (l.pontos.length < 3) { setFalha(l.avisos.length ? l.avisos : ["Não achei pontos com cota neste arquivo."]); return; }
      onPontos(l.pontos, semExt(f.name), { tipo: "arquivo", arquivo: f.name }, l.fuso, l.avisos);
    } catch (e) {
      setFalha([`Não deu para ler o arquivo: ${e instanceof Error ? e.message : String(e)}`]);
    } finally { setLendo(false); }
  };

  const usarRelevo = async (origem: { tipo: "coord"; texto: string } | { tipo: "kml"; f: File }) => {
    setRelevo({ estado: "buscando" });
    try {
      let utm: Pt[], fuso: number, descricao: string, nome: string;
      const avisos: string[] = [];
      if (origem.tipo === "coord") {
        const ll = lerCoordenada(origem.texto);
        if (!ll) throw new Error("Não entendi a coordenada. Use \"-12,9714, -38,5014\" ou cole o link do Google Maps.");
        ({ utm, fuso } = quadradoEm(ll, 60));
        descricao = `relevo público em ${ll[1].toFixed(5)}, ${ll[0].toFixed(5)}`;
        nome = `Terreno em ${ll[1].toFixed(4)}, ${ll[0].toFixed(4)}`;
      } else {
        const k = await lerPoligonoKml(origem.f, null);
        utm = k.utm; fuso = k.fuso;
        if (k.furoIgnorado) avisos.push("O KML tem um furo (área interna): a plataforma usa só o contorno de fora.");
        descricao = `relevo público na área de ${origem.f.name}`;
        nome = k.nome || semExt(origem.f.name);
      }
      const t = await terrenoPublico(utm, fuso);
      setRelevo({ estado: "ocioso" });
      onPontos(t.pontos, nome, { tipo: "relevo", descricao }, fuso, avisos,
        { modo: "poligono", folga: null, retangulo: null, poligono: t.plataforma, nomePoligono: origem.tipo === "kml" ? origem.f.name : "quadrado de 60 × 60 m" });
    } catch (e) {
      setRelevo({ estado: "erro", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="pagina tp-inicio">
      <CabecalhoPagina olho="Ferramentas" titulo={trocando ? `Trocar os pontos de ${trocando.nome}` : "Terraplanagem"}
        descricao={trocando ? "A plataforma, a cota e os taludes continuam os mesmos; só o terreno muda." : "Quanto de corte e de aterro para deixar o terreno plano — e quantos caminhões. Envie o levantamento e o resultado aparece na hora."}
        voltar={trocando ? { rotulo: trocando.nome, onClick: onCancelarTroca } : undefined} />

      <div className="tp-entrada">
        <label className={`tp-soltar${arrastando ? " arrastando" : ""}${lendo ? " lendo" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files?.[0]; if (f) void arquivo(f); }}>
          <span className="tp-soltar-icone" aria-hidden="true">{lendo ? <span className="spinner" /> : <Icone d={ICONE.upload} size={26} />}</span>
          <b>{lendo ? "Lendo os pontos…" : "Solte aqui o arquivo do levantamento"}</b>
          <span className="sub">TXT ou CSV com nome, E, N e cota — em qualquer ordem e separador. Também GSI, XML da coletora e DXF com pontos.</span>
          <span className="tp-soltar-botao">Escolher arquivo</span>
          <input type="file" accept={ACEITOS_PONTOS} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void arquivo(f); }} />
        </label>

        <div className="tp-relevo bloco">
          <header>
            <h3>Sem levantamento ainda?<Dica>O relevo público é o modelo digital de elevação de ~30 m (o mesmo do loteamento). Serve para uma primeira conversa com o cliente — a obra pede o levantamento planialtimétrico.</Dica></h3>
          </header>
          <p className="sub">Estimativa pelo relevo público: cole a coordenada ou o link do Google Maps do terreno (área de 60 × 60 m), ou envie o KML da área.</p>
          <form className="tp-relevo-linha" onSubmit={(e) => { e.preventDefault(); if (coord.trim()) void usarRelevo({ tipo: "coord", texto: coord }); }}>
            <input value={coord} onChange={(e) => setCoord(e.target.value)} placeholder="-12,9714, -38,5014 ou link do Maps" aria-label="Coordenada ou link do Google Maps" />
            <button type="submit" disabled={!coord.trim() || relevo.estado === "buscando"}>{relevo.estado === "buscando" ? <><span className="spinner" /> Buscando…</> : "Usar o relevo"}</button>
            <button type="button" disabled={relevo.estado === "buscando"} onClick={() => kmlRef.current?.click()}>KML da área</button>
          </form>
          <input ref={kmlRef} type="file" accept=".kml,.kmz" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void usarRelevo({ tipo: "kml", f }); }} />
          {relevo.estado === "erro" && <p className="erro" role="alert">{relevo.msg}</p>}
        </div>
      </div>
      {falha && (
        <div className="tp-falha" role="alert">
          <b>Não deu para usar este arquivo</b>
          {falha.map((f) => <span key={f}>{f}</span>)}
          <span className="sub">O arquivo precisa ter uma linha por ponto com nome, E, N e cota. Exemplo: <code>12;487401,25;8634210,80;308,912</code></span>
        </div>
      )}

      {!trocando && (
        <section className="bloco lista tp-recentes" aria-labelledby="tp-recentes-t">
          <header>
            <h3 id="tp-recentes-t">Projetos recentes</h3>
            {lista.estado === "ok" && lista.semConexao && <span className="desc tp-sem-conexao">sem conexão com a conta — mostrando os deste aparelho<button type="button" className="link" onClick={carregar}>tentar de novo</button></span>}
            {lista.estado === "ok" && !lista.semConexao && lista.soNoAparelho && lista.itens.length > 0 && <span className="desc">guardados neste aparelho</span>}
          </header>
          {lista.estado === "carregando" && <div style={{ padding: "0 20px 16px" }}><Esqueleto linhas={3} rotulo="Carregando os projetos…" /></div>}
          {lista.estado === "erro" && <EstadoErro mensagem={lista.msg} onTentar={carregar} />}
          {lista.estado === "ok" && !lista.itens.length && (
            <EstadoVazio compacto icone={ICONE.arquivo} titulo="Nenhum projeto ainda"
              texto="O primeiro aparece aqui assim que você enviar um levantamento. Tudo grava sozinho." />
          )}
          {lista.estado === "ok" && lista.itens.length > 0 && (
            <ul className="tp-lista">
              {lista.itens.map((it) => (
                <li key={it.id}>
                  <button type="button" className="tp-item" onClick={() => onAbrir(it.id)}>
                    <span className="tp-item-nome">{it.nome}</span>
                    <span className="tp-item-num">
                      {it.corte != null && <span><i className="corte" />corte {fmtN(it.corte, 0)} m³</span>}
                      {it.aterro != null && <span><i className="aterro" />aterro {fmtN(it.aterro, 0)} m³</span>}
                      {it.cota != null && <span className="sub">cota {fmtN(it.cota, 2)}</span>}
                    </span>
                    <span className="tp-item-quando sub">{fmtN(it.nPontos, 0)} pontos · {quando(it.atualizadoEm)}</span>
                  </button>
                  <BotaoPerigo titulo="Apagar este projeto" confirmacao="Apagar de vez"
                    onConfirmar={() => { void armazenamento.apagar(it.id).then(carregar, (e) => avisar("erro", `Não deu para apagar: ${e instanceof Error ? e.message : String(e)}`)); }}>
                    apagar
                  </BotaoPerigo>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
