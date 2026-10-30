// Tutoriais em vídeo (migração 0029): o dono grava os vídeos do sistema e
// cadastra aqui, por módulo. A página Ajuda das empresas mostra só os
// publicados; rascunho fica visível apenas no painel.
import { useCallback, useEffect, useMemo, useState } from "react";
import { MODULOS, excluirTutorial, listarTutoriais, rotuloModulo, salvarTutorial, videoEmbutido } from "../../lib/suporte";
import type { Tutorial } from "../../lib/suporte";
import { avisar, confirmar, Dica, Rotulo } from "../ui";
import { Carregando, ICO, Ico, Kpi, Topo } from "./comum";

type Filtro = "todos" | "publicados" | "rascunhos";
type Rascunho = Partial<Tutorial> & { modulo: string; titulo: string };

const msgErro = (e: unknown) => String(e instanceof Error ? e.message : e);
const faltaMigracao = (e: unknown) => /does not exist|could not find|schema cache|PGRST20[25]|404/i.test(msgErro(e));
const DURACAO = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** De onde vem o vídeo, pelo link. */
function origem(url: string | null): string | null {
  if (!url) return null;
  if (/youtu\.?be/.test(url)) return "YouTube";
  if (/vimeo\.com/.test(url)) return "Vimeo";
  if (/loom\.com/.test(url)) return "Loom";
  if (/drive\.google\.com/.test(url)) return "Google Drive";
  return "Link";
}

export function TutoriaisAdmin() {
  const [lista, setLista] = useState<Tutorial[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semBanco, setSemBanco] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [modulo, setModulo] = useState("");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Rascunho | null>(null);

  const carregar = useCallback(async () => {
    try { setLista(await listarTutoriais()); setErro(null); }
    catch (e) { if (faltaMigracao(e)) setSemBanco(true); else setErro(msgErro(e)); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const todos = lista ?? [];
  const publicados = todos.filter((t) => t.publicado).length;
  const cobertos = new Set(todos.filter((t) => t.publicado).map((t) => t.modulo));
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todos
      .filter((t) => filtro === "todos" || (filtro === "publicados") === t.publicado)
      .filter((t) => !modulo || t.modulo === modulo)
      .filter((t) => !q || [t.titulo, t.descricao ?? "", rotuloModulo(t.modulo)].some((x) => x.toLowerCase().includes(q)));
  }, [todos, filtro, modulo, busca]);
  // módulos na ordem do sistema; um módulo antigo, que saiu da lista, vai para o fim
  const grupos = useMemo(() => {
    const chaves = [...MODULOS.map((m) => m.chave), ...new Set(visiveis.map((t) => t.modulo).filter((m) => !MODULOS.some((x) => x.chave === m)))];
    return chaves.map((m) => ({ m, itens: visiveis.filter((t) => t.modulo === m).sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo)) }))
      .filter((g) => g.itens.length);
  }, [visiveis]);
  const vazios = MODULOS.filter((m) => !todos.some((t) => t.modulo === m.chave));

  const novo = (m = modulo || MODULOS[0].chave) => {
    const ordem = Math.max(0, ...todos.filter((t) => t.modulo === m).map((t) => t.ordem)) + 1;
    setEditando({ modulo: m, titulo: "", descricao: "", video_url: "", duracao: "", ordem, publicado: false });
  };

  async function publicar(t: Tutorial, publicado: boolean) {
    setLista((l) => l?.map((x) => (x.id === t.id ? { ...x, publicado } : x)) ?? l);
    try {
      await salvarTutorial({ id: t.id, modulo: t.modulo, titulo: t.titulo, publicado });
      avisar("ok", publicado ? `"${t.titulo}" está na página Ajuda das empresas.` : `"${t.titulo}" voltou a ser rascunho.`);
    } catch (e) { avisar("erro", msgErro(e)); }
    await carregar();
  }

  async function apagar(t: Pick<Tutorial, "id" | "titulo">) {
    if (!(await confirmar({ titulo: "Excluir o tutorial?", texto: `"${t.titulo}" sai do catálogo e da página Ajuda das empresas.`, confirmar: "Excluir", perigo: true }))) return false;
    try { await excluirTutorial(t.id); avisar("ok", "Tutorial excluído."); await carregar(); return true; }
    catch (e) { avisar("erro", msgErro(e)); return false; }
  }

  if (semBanco) {
    return (
      <>
        <Topo olho="Catálogo" titulo="Tutoriais em vídeo" />
        <section className="sa-card sa-cx-vazio grande">
          <span className="ic"><Ico d={ICO.tutoriais} /></span>
          <b>Os tutoriais precisam da migração 0029</b>
          <p>Aplique <code>supabase/migrations/0029_suporte_equipe_clientes.sql</code> no banco para cadastrar os vídeos.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <Topo olho="Catálogo" titulo="Tutoriais em vídeo" sub="Os vídeos que as empresas assistem na página Ajuda do sistema.">
        <button type="button" className="principal" onClick={() => novo()}><Ico d={ICO.mais} />Novo tutorial</button>
      </Topo>

      <section className="sa-kpis sa-kpis-3" aria-label="Indicadores dos tutoriais">
        <Kpi rotulo="Publicados" valor={lista ? publicados : "—"} icone={ICO.tutoriais} detalhe="aparecem na Ajuda das empresas" onClick={() => setFiltro("publicados")} />
        <Kpi rotulo="Rascunhos" valor={lista ? todos.length - publicados : "—"} icone={ICO.editar} tom="escuro"
          detalhe="só o painel vê" onClick={() => setFiltro("rascunhos")} />
        <Kpi rotulo="Módulos com vídeo" valor={lista ? <>{cobertos.size}<small className="sa-cx-de5"> / {MODULOS.length}</small></> : "—"} icone={ICO.recursos}
          tom={lista && cobertos.size < MODULOS.length ? "alerta" : undefined}
          detalhe={vazios.length ? `${vazios.length} módulo(s) ainda sem nenhum vídeo` : "todos os módulos têm vídeo"} />
      </section>

      <div className="sa-filtros">
        <div className="sa-segmento" role="group" aria-label="Situação">
          {([["todos", "Todos", todos.length], ["publicados", "Publicados", publicados], ["rascunhos", "Rascunhos", todos.length - publicados]] as [Filtro, string, number][]).map(([f, r, n]) => (
            <button key={f} type="button" className={filtro === f ? "ativo" : ""} onClick={() => setFiltro(f)}>{r}<span className="n">{n}</span></button>
          ))}
        </div>
        <select value={modulo} onChange={(e) => setModulo(e.target.value)} aria-label="Módulo" className="sa-tut-modulo">
          <option value="">Todos os módulos</option>
          {MODULOS.map((m) => <option key={m.chave} value={m.chave}>{m.rotulo}</option>)}
        </select>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo título ou descrição" aria-label="Buscar tutoriais" />
      </div>

      {erro ? (
        <section className="sa-card sa-cx-vazio">
          <span className="ic erro"><Ico d={ICO.alerta} /></span><b>Não foi possível carregar os tutoriais</b><p>{erro}</p>
          <button type="button" onClick={carregar}>Tentar de novo</button>
        </section>
      ) : !lista ? <Carregando /> : todos.length === 0 ? (
        <section className="sa-card sa-cx-vazio grande">
          <span className="ic"><Ico d={ICO.tutoriais} /></span>
          <b>Nenhum tutorial cadastrado</b>
          <p>Grave um vídeo curto de cada parte do sistema, suba no YouTube, Vimeo, Loom ou Google Drive e cole o link aqui.</p>
          <button type="button" className="principal" onClick={() => novo()}><Ico d={ICO.mais} />Cadastrar o primeiro</button>
        </section>
      ) : (
        <div className="sa-tut-grupos">
          {grupos.length === 0 && (
            <section className="sa-card sa-cx-vazio"><b>Nada encontrado</b><p>Nenhum tutorial com esses filtros.</p>
              <button type="button" onClick={() => { setFiltro("todos"); setModulo(""); setBusca(""); }}>Limpar filtros</button></section>
          )}
          {grupos.map((g) => (
            <section key={g.m} className="sa-card sa-tut-grupo">
              <header>
                <h3>{rotuloModulo(g.m)}</h3>
                <span className="sub">{g.itens.length} vídeo(s) · {g.itens.filter((t) => t.publicado).length} publicado(s)</span>
                <button type="button" className="fantasma" onClick={() => novo(g.m)}><Ico d={ICO.mais} />Adicionar</button>
              </header>
              <div className="sa-tut-itens">
                {g.itens.map((t) => (
                  <div key={t.id} className={`sa-tut-item${t.publicado ? "" : " rascunho"}`}>
                    <button type="button" className="sa-tut-capa" onClick={() => setEditando({ ...t })} aria-label={`Editar ${t.titulo}`}
                      data-sem={videoEmbutido(t.video_url) ? undefined : "1"}>
                      <Ico d="M8 5.5v13l11-6.5z" />
                      {t.duracao && <span className="dur">{t.duracao}</span>}
                    </button>
                    <div className="tx">
                      <b>{t.titulo}</b>
                      {t.descricao && <p>{t.descricao}</p>}
                      <span className="meta">
                        {origem(t.video_url) ? <a href={t.video_url!} target="_blank" rel="noreferrer">{origem(t.video_url)}</a> : <span className="pede">sem link de vídeo</span>}
                        <span>ordem {t.ordem}</span>
                      </span>
                    </div>
                    <label className="sa-tut-pub">
                      <span className={`sa-pill ${t.publicado ? "ativo" : "neutro"}`}>{t.publicado ? "Publicado" : "Rascunho"}</span>
                      <button type="button" role="switch" className="sa-switch" aria-checked={t.publicado}
                        aria-label={t.publicado ? `Tirar "${t.titulo}" da Ajuda` : `Publicar "${t.titulo}"`} onClick={() => publicar(t, !t.publicado)} />
                    </label>
                    <div className="acoes">
                      <button type="button" onClick={() => setEditando({ ...t })}><Ico d={ICO.editar} />Editar</button>
                      <button type="button" className="sa-cx-icone sa-tut-excluir" onClick={() => apagar(t)} aria-label={`Excluir ${t.titulo}`} title="Excluir"><Ico d={ICO.lixeira} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {vazios.length > 0 && !modulo && filtro === "todos" && !busca && (
            <section className="sa-card sa-tut-falta">
              <header><h3>Módulos ainda sem vídeo<Dica>a página Ajuda das empresas não mostra nada para estes módulos</Dica></h3></header>
              <div className="chips">
                {vazios.map((m) => (
                  <button key={m.chave} type="button" onClick={() => novo(m.chave)}><Ico d={ICO.mais} />{m.rotulo}</button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {editando && (
        <Editor t={editando} onFechar={() => setEditando(null)}
          onSalvo={async () => { setEditando(null); await carregar(); }}
          onExcluir={async () => { if (editando.id && (await apagar({ id: editando.id, titulo: editando.titulo }))) setEditando(null); }} />
      )}
    </>
  );
}

function Editor({ t, onFechar, onSalvo, onExcluir }: {
  t: Rascunho; onFechar: () => void; onSalvo: () => Promise<void>; onExcluir: () => void;
}) {
  const [f, setF] = useState<Rascunho>(t);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const embutido = videoEmbutido(f.video_url ?? null);
  const linkRuim = !!f.video_url?.trim() && !embutido;
  const duracaoRuim = !!f.duracao?.trim() && !DURACAO.test(f.duracao.trim());

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !salvando) onFechar(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onFechar, salvando]);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (f.titulo.trim().length < 3) { setErro("Escreva o título do tutorial."); return; }
    if (linkRuim) { setErro("O link do vídeo não foi reconhecido. Use YouTube, Vimeo, Loom ou Google Drive."); return; }
    if (duracaoRuim) { setErro("Duração no formato 4:30."); return; }
    setSalvando(true); setErro(null);
    try {
      await salvarTutorial({
        ...(f.id ? { id: f.id } : {}), modulo: f.modulo, titulo: f.titulo.trim(), descricao: f.descricao?.trim() || null,
        video_url: f.video_url?.trim() || null, duracao: f.duracao?.trim() || null, ordem: Number(f.ordem) || 0, publicado: !!f.publicado,
      });
      avisar("ok", f.id ? "Tutorial salvo." : f.publicado ? "Tutorial publicado na Ajuda das empresas." : "Tutorial salvo como rascunho.");
      await onSalvo();
    } catch (e) { setErro(msgErro(e)); }
    finally { setSalvando(false); }
  }

  return (
    <>
      <div className="sa-veu" onClick={() => !salvando && onFechar()} />
      <form className="sa-gaveta sa-tut-editor" role="dialog" aria-modal="true" aria-label={f.id ? "Editar tutorial" : "Novo tutorial"} onSubmit={salvar}>
        <header>
          <span className="sa-olho">Tutorial</span>
          <h2>{f.id ? "Editar tutorial" : "Novo tutorial"}</h2>
        </header>
        <div className="corpo">
          <div className="sa-tut-previa" data-vazio={embutido ? undefined : "1"}>
            {embutido ? (
              <iframe src={embutido} title={`Prévia: ${f.titulo || "vídeo"}`} allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy" />
            ) : (
              <span><Ico d={ICO.tutoriais} />{linkRuim ? "Link não reconhecido" : "Cole o link do vídeo para ver a prévia"}</span>
            )}
          </div>
          <div className="sa-campos dois">
            <label className="largo">Título
              <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Como gerar a planta do SIGEF" required autoFocus maxLength={140} />
            </label>
            <label className="largo"><Rotulo dica="YouTube (pode ser não listado), Vimeo, Loom ou Google Drive com acesso por link">Link do vídeo</Rotulo>
              <input value={f.video_url ?? ""} onChange={(e) => setF({ ...f, video_url: e.target.value })} placeholder="https://youtu.be/…" inputMode="url" />
              {linkRuim && <span className="erro-campo">Use um link do YouTube, Vimeo, Loom ou Google Drive.</span>}
            </label>
            <label>Módulo
              <select value={f.modulo} onChange={(e) => setF({ ...f, modulo: e.target.value })}>
                {MODULOS.map((m) => <option key={m.chave} value={m.chave}>{m.rotulo}</option>)}
              </select>
            </label>
            <label><Rotulo dica="minutos:segundos, como aparece para a empresa">Duração</Rotulo>
              <input value={f.duracao ?? ""} onChange={(e) => setF({ ...f, duracao: e.target.value })} placeholder="4:30" className="mono" />
              {duracaoRuim && <span className="erro-campo">Formato 4:30.</span>}
            </label>
            <label><Rotulo dica="posição dentro do módulo: o menor aparece primeiro">Ordem</Rotulo>
              <input type="number" min={0} value={f.ordem ?? 0} onChange={(e) => setF({ ...f, ordem: Number(e.target.value) })} />
            </label>
            <label><Rotulo dica="publicado aparece na página Ajuda de todas as empresas; rascunho só aqui">Situação</Rotulo>
              <span className="sa-tut-situacao">
                <button type="button" role="switch" className="sa-switch" aria-checked={!!f.publicado} onClick={() => setF({ ...f, publicado: !f.publicado })}
                  aria-label="Publicado" />
                <span>{f.publicado ? "Publicado" : "Rascunho"}</span>
              </span>
            </label>
            <label className="largo">Descrição
              <textarea value={f.descricao ?? ""} onChange={(e) => setF({ ...f, descricao: e.target.value })} rows={3} maxLength={500}
                placeholder="O que a pessoa aprende neste vídeo, em uma ou duas frases." />
            </label>
          </div>
          {erro && <div className="sa-aviso erro" style={{ marginTop: 14, marginBottom: 0 }}>{erro}</div>}
        </div>
        <footer>
          {t.id && <button type="button" className="fantasma" style={{ marginRight: "auto" }} onClick={onExcluir} disabled={salvando}><Ico d={ICO.lixeira} />Excluir</button>}
          <button type="button" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="submit" className="principal" disabled={salvando}>{salvando ? "Salvando…" : f.id ? "Salvar" : f.publicado ? "Publicar" : "Salvar rascunho"}</button>
        </footer>
      </form>
    </>
  );
}
