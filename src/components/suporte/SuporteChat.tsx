// Central de suporte da empresa: um botão no canto da tela abre um painel à
// direita, como um chat. Ali a pessoa vê as conversas dela (ou da empresa,
// para quem gerencia a equipe), abre chamado com print e anexos e conversa com
// o suporte do Vertces, que responde pelo painel do superadmin.
//
// Sem a 0029 no banco o botão não aparece. Abre também de fora, pelo evento
// `suporte:abrir` (barra lateral, página Ajuda): ver abrirSuporte().
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  abrirChamado, CATEGORIAS, contextoDaTela, ehImagem, encerrarChamado, enviarAnexo, LIMITE_ANEXO, marcarLido, MAX_ANEXOS,
  mensagensDoChamado, meusChamados, responderChamado, rotuloCategoria, semSuporte, STATUS_CLIENTE, tamanhoLegivel, urlDoAnexo,
  listarTutoriais, rotuloModulo,
} from "../../lib/suporte";
import type { Anexo, CategoriaChamado, Chamado, Mensagem, Tutorial } from "../../lib/suporte";
import { SUPORTE_EMAIL, SUPORTE_PRAZO, SUPORTE_WHATSAPP } from "../../lib/config";
import { quandoFoi } from "../Auditoria";
import { avisar, confirmar } from "../ui";
import "./suporte.css";

const EVENTO = "suporte:abrir";
const MUDOU = "suporte:mudou";

/** Abre o painel de suporte de qualquer lugar (opcionalmente já no formulário). */
export function abrirSuporte(o: { novo?: boolean; assunto?: string; categoria?: CategoriaChamado } = {}): void {
  dispatchEvent(new CustomEvent(EVENTO, { detail: o }));
}

/** Não lidas do suporte, para o selo da barra lateral. */
export function useNaoLidasSuporte(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    const f = (e: Event) => setN((e as CustomEvent<number | null>).detail);
    addEventListener(MUDOU, f);
    return () => removeEventListener(MUDOU, f);
  }, []);
  return n;
}

const P = {
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  fechar: "M18 6 6 18M6 6l12 12",
  voltar: "M15 18l-6-6 6-6",
  clipe: "m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5",
  enviar: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  mais: "M12 5v14M5 12h14",
  play: "M8 5v14l11-7z",
  arquivo: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  ok: "M20 6 9 17l-5-5",
  zap: "M13 2 3 14h9l-1 8 10-12h-9z",
  seta: "M5 12h14M12 5l7 7-7 7",
};
const Ico = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

type Vista = { v: "inicio" } | { v: "novo"; assunto?: string; categoria?: CategoriaChamado } | { v: "conversa"; id: string };

export function SuporteChat({ escritorioId, nome }: { escritorioId: string; nome?: string | null }) {
  const [aberto, setAberto] = useState(false);
  const [vista, setVista] = useState<Vista>({ v: "inicio" });
  const [chamados, setChamados] = useState<Chamado[] | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const c = await meusChamados();
      setChamados(c);
      dispatchEvent(new CustomEvent(MUDOU, { detail: c.reduce((s, x) => s + x.nao_lidas, 0) }));
    } catch (e) {
      if (semSuporte(e)) { setIndisponivel(true); dispatchEvent(new CustomEvent(MUDOU, { detail: null })); }
    }
  }, []);

  // não lidas: a cada 60 s fechado, 15 s aberto
  useEffect(() => {
    carregar();
    const t = window.setInterval(carregar, aberto ? 15_000 : 60_000);
    return () => window.clearInterval(t);
  }, [carregar, aberto]);

  useEffect(() => {
    const f = (e: Event) => {
      const o = (e as CustomEvent<{ novo?: boolean; assunto?: string; categoria?: CategoriaChamado }>).detail ?? {};
      setAberto(true);
      setVista(o.novo ? { v: "novo", assunto: o.assunto, categoria: o.categoria } : { v: "inicio" });
    };
    addEventListener(EVENTO, f);
    return () => removeEventListener(EVENTO, f);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [aberto]);

  if (indisponivel) return null;
  const naoLidas = (chamados ?? []).reduce((s, x) => s + x.nao_lidas, 0);

  return (
    <>
      {!aberto && (
        <button type="button" className="sp-lancador" onClick={() => { setAberto(true); setVista({ v: "inicio" }); }}
          aria-label={naoLidas ? `Suporte: ${naoLidas} resposta(s) nova(s)` : "Falar com o suporte"}>
          <Ico d={P.chat} size={22} />
          <span className="sp-lancador-tx">Suporte</span>
          {naoLidas > 0 && <span className="sp-selo">{naoLidas}</span>}
        </button>
      )}
      {aberto && (
        <aside className="sp-painel" role="dialog" aria-label="Suporte do Vertces">
          {vista.v === "inicio" && (
            <Inicio nome={nome} chamados={chamados} onFechar={() => setAberto(false)}
              onNovo={() => setVista({ v: "novo" })} onAbrir={(id) => setVista({ v: "conversa", id })} />
          )}
          {vista.v === "novo" && (
            <Novo escritorioId={escritorioId} assunto={vista.assunto} categoria={vista.categoria}
              onVoltar={() => setVista({ v: "inicio" })} onFechar={() => setAberto(false)}
              onCriado={(id) => { carregar(); setVista({ v: "conversa", id }); }} />
          )}
          {vista.v === "conversa" && (
            <Conversa key={vista.id} id={vista.id} escritorioId={escritorioId}
              chamado={(chamados ?? []).find((c) => c.id === vista.id) ?? null}
              onVoltar={() => { setVista({ v: "inicio" }); carregar(); }} onFechar={() => setAberto(false)} onMudou={carregar} />
          )}
        </aside>
      )}
    </>
  );
}

function Cabeca({ titulo, sub, onVoltar, onFechar, children }: { titulo: ReactNode; sub?: ReactNode; onVoltar?: () => void; onFechar: () => void; children?: ReactNode }) {
  return (
    <header className="sp-cabeca">
      {onVoltar && <button type="button" className="sp-icone" onClick={onVoltar} aria-label="Voltar"><Ico d={P.voltar} /></button>}
      <div className="sp-cabeca-tx"><b>{titulo}</b>{sub && <span>{sub}</span>}</div>
      {children}
      <button type="button" className="sp-icone" onClick={onFechar} aria-label="Fechar o suporte"><Ico d={P.fechar} /></button>
    </header>
  );
}

function StatusChip({ c }: { c: Pick<Chamado, "status" | "ultima_mensagem_de"> }) {
  const tom = c.status === "resolvido" ? "ok" : c.status === "aguardando_cliente" ? "resp" : c.status === "em_atendimento" ? "atend" : "esp";
  return <span className={`sp-status ${tom}`}>{STATUS_CLIENTE[c.status]}</span>;
}

// ------------------------------------------------------------------ início do painel
function Inicio({ nome, chamados, onFechar, onNovo, onAbrir }: {
  nome?: string | null; chamados: Chamado[] | null; onFechar: () => void; onNovo: () => void; onAbrir: (id: string) => void;
}) {
  const [tutoriais, setTutoriais] = useState<Tutorial[]>([]);
  useEffect(() => { listarTutoriais().then((t) => setTutoriais(t.filter((x) => x.publicado).slice(0, 3))).catch(() => {}); }, []);
  const primeiro = (nome ?? "").split(/[\s@._-]+/)[0];
  const quem = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
  const abertos = (chamados ?? []).filter((c) => c.status !== "resolvido");
  const resolvidos = (chamados ?? []).filter((c) => c.status === "resolvido");
  const [verResolvidos, setVerResolvidos] = useState(false);

  return (
    <div className="sp-corpo sp-inicio">
      <div className="sp-heroi">
        <div className="sp-heroi-topo">
          <span className="sp-marca">Suporte Vertces</span>
          <button type="button" className="sp-icone claro" onClick={onFechar} aria-label="Fechar o suporte"><Ico d={P.fechar} /></button>
        </div>
        <h2>Olá{quem ? `, ${quem}` : ""}.<br />Como podemos ajudar?</h2>
        <p>{SUPORTE_PRAZO || "Respondemos aqui mesmo, no horário comercial. Você recebe o aviso no botão de suporte."}</p>
        <button type="button" className="sp-cta" onClick={onNovo}>
          <span><b>Abrir um chamado</b><small>Dúvida, erro, acesso ou sugestão</small></span>
          <Ico d={P.seta} />
        </button>
      </div>

      <section className="sp-bloco">
        <h3>Suas conversas{abertos.length > 0 && <span className="sp-n">{abertos.length}</span>}</h3>
        {chamados === null ? <div className="sp-esq" /> : abertos.length === 0 && resolvidos.length === 0 ? (
          <p className="sp-vazio">Nenhum chamado ainda. Quando abrir um, a conversa fica aqui.</p>
        ) : (
          <>
            {abertos.length === 0 && <p className="sp-vazio">Nenhuma conversa em aberto.</p>}
            <ul className="sp-lista">{abertos.map((c) => <ItemChamado key={c.id} c={c} onAbrir={onAbrir} />)}</ul>
            {resolvidos.length > 0 && (
              <>
                <button type="button" className="sp-link" onClick={() => setVerResolvidos((v) => !v)}>
                  {verResolvidos ? "Esconder" : "Ver"} resolvidos ({resolvidos.length})
                </button>
                {verResolvidos && <ul className="sp-lista">{resolvidos.map((c) => <ItemChamado key={c.id} c={c} onAbrir={onAbrir} />)}</ul>}
              </>
            )}
          </>
        )}
      </section>

      {tutoriais.length > 0 && (
        <section className="sp-bloco">
          <h3>Vídeos de ajuda</h3>
          <ul className="sp-videos">
            {tutoriais.map((t) => (
              <li key={t.id}>
                <a href="#/ajuda" onClick={onFechar}>
                  <span className="sp-play"><Ico d={P.play} size={14} /></span>
                  <span><b>{t.titulo}</b><small>{rotuloModulo(t.modulo)}{t.duracao ? ` · ${t.duracao}` : ""}</small></span>
                </a>
              </li>
            ))}
          </ul>
          <a className="sp-link" href="#/ajuda" onClick={onFechar}>Ver todos os vídeos</a>
        </section>
      )}

      {(SUPORTE_WHATSAPP || SUPORTE_EMAIL) && (
        <section className="sp-bloco sp-canais">
          <h3>Outros canais</h3>
          <div>
            {SUPORTE_WHATSAPP && <a className="sp-canal" href={`https://wa.me/${SUPORTE_WHATSAPP}`} target="_blank" rel="noreferrer">WhatsApp</a>}
            {SUPORTE_EMAIL && <a className="sp-canal" href={`mailto:${SUPORTE_EMAIL}`}>{SUPORTE_EMAIL}</a>}
          </div>
        </section>
      )}
    </div>
  );
}

function ItemChamado({ c, onAbrir }: { c: Chamado; onAbrir: (id: string) => void }) {
  return (
    <li>
      <button type="button" className={c.nao_lidas ? "sp-item novo" : "sp-item"} onClick={() => onAbrir(c.id)}>
        <span className="sp-item-topo">
          <b>{c.assunto}</b>
          <span className="sp-quando">{quandoFoi(c.ultima_mensagem_em)}</span>
        </span>
        <span className="sp-previa">{c.ultima_mensagem_de === "suporte" ? "Suporte: " : ""}{c.previa ?? ""}</span>
        <span className="sp-item-pe">
          <StatusChip c={c} />
          <span className="sp-num">#{c.numero} · {rotuloCategoria(c.categoria)}{!c.meu ? ` · ${c.autor}` : ""}</span>
          {c.nao_lidas > 0 && <span className="sp-selo pequeno">{c.nao_lidas}</span>}
        </span>
      </button>
    </li>
  );
}

// ------------------------------------------------------------------ anexos (enviar)
/** Arquivos escolhidos, arrastados ou colados (Ctrl+V de um print). */
function useAnexos() {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const juntar = (fs: File[]) => {
    const grandes = fs.filter((f) => f.size > LIMITE_ANEXO);
    if (grandes.length) avisar("erro", `${grandes.map((f) => f.name).join(", ")}: cada arquivo pode ter até 10 MB.`);
    setArquivos((a) => [...a, ...fs.filter((f) => f.size <= LIMITE_ANEXO)].slice(0, MAX_ANEXOS));
  };
  const colar = (e: React.ClipboardEvent) => {
    const fs = [...e.clipboardData.files];
    if (fs.length === 0) return;
    e.preventDefault();
    juntar(fs.map((f, i) => (f.name === "image.png" ? new File([f], `print-${new Date().toLocaleTimeString("pt-BR").replace(/:/g, "")}${i ? `-${i}` : ""}.png`, { type: f.type }) : f)));
  };
  return { arquivos, juntar, colar, tirar: (i: number) => setArquivos((a) => a.filter((_, j) => j !== i)), limpar: () => setArquivos([]) };
}

function ListaAnexos({ arquivos, onTirar }: { arquivos: File[]; onTirar: (i: number) => void }) {
  const urls = useMemo(() => arquivos.map((f) => (/^image\//.test(f.type) ? URL.createObjectURL(f) : null)), [arquivos]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  if (arquivos.length === 0) return null;
  return (
    <ul className="sp-anexos-novos">
      {arquivos.map((f, i) => (
        <li key={`${f.name}-${i}`}>
          {urls[i] ? <img src={urls[i]!} alt="" /> : <span className="sp-arq"><Ico d={P.arquivo} size={16} /></span>}
          <span className="sp-arq-tx"><b title={f.name}>{f.name}</b><small>{tamanhoLegivel(f.size)}</small></span>
          <button type="button" className="sp-icone mini" onClick={() => onTirar(i)} aria-label={`Tirar ${f.name}`}><Ico d={P.fechar} size={14} /></button>
        </li>
      ))}
    </ul>
  );
}

async function subir(escritorioId: string, pasta: string, fs: File[]): Promise<Anexo[]> {
  const r: Anexo[] = [];
  for (const f of fs) r.push(await enviarAnexo(escritorioId, pasta, f));
  return r;
}

// ------------------------------------------------------------------ novo chamado
function Novo({ escritorioId, assunto: assunto0, categoria: categoria0, onVoltar, onFechar, onCriado }: {
  escritorioId: string; assunto?: string; categoria?: CategoriaChamado; onVoltar: () => void; onFechar: () => void; onCriado: (id: string) => void;
}) {
  const [categoria, setCategoria] = useState<CategoriaChamado>(categoria0 ?? "duvida");
  const [assunto, setAssunto] = useState(assunto0 ?? "");
  const [texto, setTexto] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const anexos = useAnexos();
  const arquivo = useRef<HTMLInputElement>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (assunto.trim().length < 3) { setErro("Escreva um assunto curto (ex.: “Planta não gera”)."); return; }
    if (texto.trim().length < 3) { setErro("Conte o que aconteceu."); return; }
    setEnviando(true);
    try {
      const enviados = await subir(escritorioId, "novo", anexos.arquivos);
      const id = await abrirChamado({
        assunto: assunto.trim(), texto: texto.trim(), categoria, prioridade: urgente ? "urgente" : categoria === "erro" ? "alta" : "normal",
        anexos: enviados, contexto: contextoDaTela(),
      });
      avisar("ok", "Chamado aberto. O suporte responde por aqui.");
      onCriado(id);
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Cabeca titulo="Novo chamado" sub="O suporte do Vertces responde por aqui" onVoltar={onVoltar} onFechar={onFechar} />
      <form className="sp-corpo sp-form" onSubmit={enviar} onPaste={anexos.colar}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); anexos.juntar([...e.dataTransfer.files]); }}>
        <fieldset className="sp-categorias">
          <legend>Sobre o quê?</legend>
          {CATEGORIAS.map((c) => (
            <button type="button" key={c.chave} className={categoria === c.chave ? "ativo" : ""} onClick={() => setCategoria(c.chave)} title={c.dica}>
              {c.rotulo}
            </button>
          ))}
        </fieldset>
        <label className="sp-campo">Assunto
          <input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={140} autoFocus
            placeholder={categoria === "erro" ? "Ex.: A planta A1 não gera" : categoria === "acesso" ? "Ex.: Colega não consegue entrar" : "Ex.: Como dividir em glebas?"} />
        </label>
        <label className="sp-campo">Mensagem
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} maxLength={8000}
            placeholder={categoria === "erro"
              ? "O que você estava fazendo, em qual serviço, e o que apareceu na tela. Cole um print com Ctrl+V."
              : "Conte com detalhes. Pode colar prints com Ctrl+V."} />
        </label>
        <ListaAnexos arquivos={anexos.arquivos} onTirar={anexos.tirar} />
        <div className="sp-linha-acoes">
          <button type="button" className="sp-anexar" onClick={() => arquivo.current?.click()} disabled={anexos.arquivos.length >= MAX_ANEXOS}>
            <Ico d={P.clipe} size={16} /> Anexar print ou arquivo
          </button>
          <label className={urgente ? "sp-urgente ativo" : "sp-urgente"} title="Marque se o problema está parando o trabalho da equipe">
            <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />
            <Ico d={P.zap} size={14} /> Está parando o trabalho
          </label>
          <input ref={arquivo} type="file" multiple hidden accept="image/*,.pdf,.txt,.csv,.kml,.kmz,.zip,.docx,.ods,.xlsx"
            onChange={(e) => { anexos.juntar([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
        <p className="sp-nota">Vai junto, para o suporte reproduzir: a tela em que você está, o navegador e o tamanho da janela.</p>
        {erro && <div className="sp-erro" role="alert">{erro}</div>}
        <button type="submit" className="sp-enviar-grande" disabled={enviando}>{enviando ? "Enviando…" : "Enviar chamado"}</button>
      </form>
    </>
  );
}

// ------------------------------------------------------------------ conversa
function Conversa({ id, escritorioId, chamado, onVoltar, onFechar, onMudou }: {
  id: string; escritorioId: string; chamado: Chamado | null; onVoltar: () => void; onFechar: () => void; onMudou: () => void;
}) {
  const [msgs, setMsgs] = useState<Mensagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const anexos = useAnexos();
  const arquivo = useRef<HTMLInputElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const qtd = useRef(0);

  const carregar = useCallback(async () => {
    try {
      const m = await mensagensDoChamado(id);
      setMsgs(m);
      if (m.length !== qtd.current) { qtd.current = m.length; void marcarLido(id).then(onMudou); }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, [id, onMudou]);
  useEffect(() => {
    carregar();
    const t = window.setInterval(carregar, 10_000);
    return () => window.clearInterval(t);
  }, [carregar]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  async function enviar() {
    if (!texto.trim() && anexos.arquivos.length === 0) return;
    setEnviando(true);
    try {
      const enviados = await subir(escritorioId, id, anexos.arquivos);
      await responderChamado(id, texto.trim(), enviados);
      setTexto(""); anexos.limpar();
      await carregar(); onMudou();
    } catch (x) { avisar("erro", x instanceof Error ? x.message : String(x)); }
    finally { setEnviando(false); }
  }

  async function encerrar() {
    if (!(await confirmar({ titulo: "Encerrar este chamado?", texto: "Ele vai para os resolvidos. Se precisar, é só escrever de novo que ele reabre.", confirmar: "Encerrar" }))) return;
    try { await encerrarChamado(id); onMudou(); await carregar(); } catch (x) { avisar("erro", x instanceof Error ? x.message : String(x)); }
  }

  const resolvido = chamado?.status === "resolvido";
  return (
    <>
      <Cabeca titulo={chamado?.assunto ?? "Conversa"}
        sub={chamado ? <><StatusChip c={chamado} /> #{chamado.numero} · {rotuloCategoria(chamado.categoria)}</> : null}
        onVoltar={onVoltar} onFechar={onFechar}>
        {chamado && !resolvido && <button type="button" className="sp-encerrar" onClick={encerrar} title="Marcar como resolvido">Resolvido</button>}
      </Cabeca>
      <div className="sp-corpo sp-conversa" onPaste={anexos.colar}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); anexos.juntar([...e.dataTransfer.files]); }}>
        {erro ? <div className="sp-erro">{erro}</div> : !msgs ? <div className="sp-esq" /> : (
          <ol className="sp-mensagens">
            {msgs.map((m, i) => {
              const novoDia = i === 0 || new Date(m.created_at).toDateString() !== new Date(msgs[i - 1].created_at).toDateString();
              return (
                <li key={m.id} className={`sp-msg ${m.autor_tipo}`}>
                  {novoDia && <div className="sp-dia">{new Date(m.created_at).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</div>}
                  {m.autor_tipo === "sistema" ? <span className="sp-sistema">{m.texto}</span> : (
                    <div className="sp-bolha">
                      {m.autor_tipo === "suporte" && <span className="sp-autor">Suporte Vertces</span>}
                      {m.texto && <p>{m.texto}</p>}
                      {m.anexos.length > 0 && <AnexosMsg anexos={m.anexos} />}
                      <time>{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
                    </div>
                  )}
                </li>
              );
            })}
            {chamado && !resolvido && chamado.ultima_mensagem_de === "cliente" && (
              <li className="sp-msg sistema"><span className="sp-sistema">O suporte já recebeu e responde aqui.</span></li>
            )}
          </ol>
        )}
        {resolvido && chamado && <Avaliacao chamado={chamado} onFeito={onMudou} />}
        <div ref={fim} />
      </div>
      <div className="sp-compositor">
        <ListaAnexos arquivos={anexos.arquivos} onTirar={anexos.tirar} />
        <div className="sp-compositor-linha">
          <button type="button" className="sp-icone" onClick={() => arquivo.current?.click()} aria-label="Anexar arquivo" disabled={anexos.arquivos.length >= MAX_ANEXOS}><Ico d={P.clipe} /></button>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={1} placeholder={resolvido ? "Escreva para reabrir o chamado…" : "Escreva uma mensagem…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
            onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 140)}px`; }} />
          <button type="button" className="sp-enviar" onClick={enviar} disabled={enviando || (!texto.trim() && anexos.arquivos.length === 0)} aria-label="Enviar"><Ico d={P.enviar} /></button>
          <input ref={arquivo} type="file" multiple hidden onChange={(e) => { anexos.juntar([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
      </div>
    </>
  );
}

function AnexosMsg({ anexos }: { anexos: Anexo[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivo = true;
    Promise.all(anexos.map(async (a) => [a.path, await urlDoAnexo(a.path)] as const))
      .then((r) => { if (vivo) setUrls(Object.fromEntries(r.filter(([, u]) => u) as [string, string][])); });
    return () => { vivo = false; };
  }, [anexos]);
  return (
    <div className="sp-anexos">
      {anexos.map((a) => ehImagem(a) && urls[a.path] ? (
        <a key={a.path} href={urls[a.path]} target="_blank" rel="noreferrer" className="sp-miniatura"><img src={urls[a.path]} alt={a.nome} /></a>
      ) : (
        <a key={a.path} href={urls[a.path] ?? undefined} target="_blank" rel="noreferrer" className="sp-arquivo">
          <Ico d={P.arquivo} size={16} /><span><b>{a.nome}</b><small>{tamanhoLegivel(a.tamanho)}</small></span>
        </a>
      ))}
    </div>
  );
}

function Avaliacao({ chamado, onFeito }: { chamado: Chamado; onFeito: () => void }) {
  const [nota, setNota] = useState(chamado.avaliacao ?? 0);
  const [comentario, setComentario] = useState("");
  const [enviado, setEnviado] = useState(!!chamado.avaliacao);
  async function enviar(n: number) {
    setNota(n);
    try { await encerrarChamado(chamado.id, n, comentario); setEnviado(true); onFeito(); }
    catch (x) { avisar("erro", x instanceof Error ? x.message : String(x)); }
  }
  return (
    <div className="sp-avaliacao">
      <span className="sp-ok"><Ico d={P.ok} size={16} /></span>
      <b>{enviado ? "Obrigado pela avaliação!" : "Chamado resolvido. Como foi o atendimento?"}</b>
      <div className="sp-estrelas" role="radiogroup" aria-label="Nota do atendimento">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={nota === n} className={n <= nota ? "ativa" : ""}
            onClick={() => enviar(n)} aria-label={`${n} de 5`}>★</button>
        ))}
      </div>
      {!enviado && nota === 0 && (
        <input className="sp-comentario" value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentário (opcional), depois escolha as estrelas" />
      )}
    </div>
  );
}
