// Ajuda: vídeos tutoriais por módulo (cadastrados pelo superadmin, 0029), o
// atalho para abrir um chamado no suporte e o guia de primeiros passos
// (docs/guia-primeiros-passos.md).
import { useEffect, useMemo, useState } from "react";
import guia from "../../docs/guia-primeiros-passos.md?raw";
import { SUPORTE_EMAIL, SUPORTE_PRAZO, SUPORTE_WHATSAPP, TERMOS_PUBLICADOS } from "../lib/config";
import { listarTutoriais, MODULOS, rotuloModulo, videoDireto, videoEmbutido } from "../lib/suporte";
import type { Tutorial } from "../lib/suporte";
import { Markdown } from "./Documento";
import { abrirSuporte } from "./suporte/SuporteChat";
import { CabecalhoPagina, Dica } from "./ui";
import "./suporte/ajuda.css";

const PLAY = "M8 5v14l11-7z";

export function Ajuda() {
  const [tutoriais, setTutoriais] = useState<Tutorial[] | null>(null);
  const [modulo, setModulo] = useState("todos");
  const [assistindo, setAssistindo] = useState<Tutorial | null>(null);
  const [busca, setBusca] = useState("");
  const [verGuia, setVerGuia] = useState(false);

  useEffect(() => { listarTutoriais().then((t) => setTutoriais(t.filter((x) => x.publicado))).catch(() => setTutoriais([])); }, []);

  const modulos = useMemo(() => MODULOS.filter((m) => (tutoriais ?? []).some((t) => t.modulo === m.chave)), [tutoriais]);
  const visiveis = (tutoriais ?? []).filter((t) => (modulo === "todos" || t.modulo === modulo)
    && (!busca.trim() || `${t.titulo} ${t.descricao ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase())));

  return (
    <div className="pagina fade aj">
      <CabecalhoPagina olho="Suporte" titulo="Ajuda e tutoriais" descricao="Vídeos curtos de cada parte do sistema, o guia de primeiros passos e o suporte" />

      <section className="aj-suporte">
        <div>
          <h2>Precisa de uma mão?</h2>
          <p>{SUPORTE_PRAZO || "Abra um chamado e converse com o suporte do Vertces aqui mesmo, sem sair do sistema."}</p>
        </div>
        <div className="aj-suporte-acoes">
          <button type="button" className="principal" onClick={() => abrirSuporte({ novo: true })}>Abrir um chamado</button>
          <button type="button" onClick={() => abrirSuporte()}>Minhas conversas</button>
          {SUPORTE_WHATSAPP && <a className="botao-download" href={`https://wa.me/${SUPORTE_WHATSAPP}`} target="_blank" rel="noreferrer">WhatsApp</a>}
          {SUPORTE_EMAIL && <a className="botao-download" href={`mailto:${SUPORTE_EMAIL}`}>E-mail</a>}
        </div>
      </section>

      <section className="bloco">
        <header>
          <h3>Vídeos tutoriais<Dica>passo a passo de cada parte do Vertces; novos vídeos aparecem aqui assim que publicados</Dica></h3>
          {tutoriais && tutoriais.length > 0 && <span className="desc">{tutoriais.length} vídeo(s)</span>}
        </header>
        {tutoriais === null ? <div className="aj-grade">{[0, 1, 2].map((i) => <div key={i} className="aj-cartao aj-esq" />)}</div>
          : tutoriais.length === 0 ? (
            <div className="aj-vazio">
              <span className="aj-play grande"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAY} /></svg></span>
              <b>Os vídeos tutoriais estão sendo gravados</b>
              <span>Enquanto isso, siga o guia de primeiros passos abaixo ou abra um chamado: respondemos por aqui.</span>
            </div>
          ) : (
            <>
              <div className="aj-filtros">
                <div className="eq-filtro" role="group" aria-label="Módulo">
                  <button className={modulo === "todos" ? "ativo" : ""} onClick={() => setModulo("todos")}>Todos</button>
                  {modulos.map((m) => <button key={m.chave} className={modulo === m.chave ? "ativo" : ""} onClick={() => setModulo(m.chave)}>{m.rotulo}</button>)}
                </div>
                {tutoriais.length > 6 && <input type="search" className="aj-busca" placeholder="Buscar vídeo" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar vídeo" />}
              </div>
              <div className="aj-grade">
                {visiveis.map((t) => { const capa = videoDireto(t.video_url)?.capa; return (
                  <button type="button" key={t.id} className="aj-cartao" onClick={() => setAssistindo(t)}>
                    <span className="aj-capa" style={capa ? { backgroundImage: `url(${capa})` } : undefined}>
                      <span className="aj-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAY} /></svg></span>
                      {t.duracao && <span className="aj-duracao">{t.duracao}</span>}
                    </span>
                    <span className="aj-modulo">{rotuloModulo(t.modulo)}</span>
                    <b>{t.titulo}</b>
                    {t.descricao && <small>{t.descricao}</small>}
                  </button>
                ); })}
                {visiveis.length === 0 && <p className="sub">Nenhum vídeo com “{busca}”.</p>}
              </div>
            </>
          )}
      </section>

      <section className="bloco guia" aria-label="Guia de primeiros passos">
        <header>
          <h3>Guia de primeiros passos</h3>
          <button type="button" className="link" onClick={() => setVerGuia((v) => !v)}>{verGuia ? "Recolher" : "Ler o guia"}</button>
        </header>
        {verGuia ? <Markdown texto={guia} /> : <p className="sub sem-margem">Do cadastro da empresa ao primeiro serviço gerado, em texto, para consultar quando quiser.</p>}
      </section>

      {TERMOS_PUBLICADOS && <p className="sub"><a href="#/termos">Termos de Uso</a> · <a href="#/privacidade">Política de Privacidade</a></p>}

      {assistindo && <Player t={assistindo} onFechar={() => setAssistindo(null)} />}
    </div>
  );
}

function Player({ t, onFechar }: { t: Tutorial; onFechar: () => void }) {
  const src = videoEmbutido(t.video_url);
  const direto = videoDireto(t.video_url);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [onFechar]);
  return (
    <div className="aj-veu" onClick={onFechar} role="dialog" aria-modal="true" aria-label={t.titulo}>
      <div className="aj-player" onClick={(e) => e.stopPropagation()}>
        <header>
          <div><span className="aj-modulo">{rotuloModulo(t.modulo)}</span><b>{t.titulo}</b></div>
          <button type="button" className="fantasma" onClick={onFechar} aria-label="Fechar">✕</button>
        </header>
        {direto ? <video src={direto.src} poster={direto.capa ?? undefined} controls autoPlay playsInline preload="metadata" />
          : src ? <iframe src={src} title={t.titulo} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
          : t.video_url ? <a className="aj-externo" href={t.video_url} target="_blank" rel="noreferrer">Abrir o vídeo em outra aba</a>
            : <p className="sub">Vídeo ainda não disponível.</p>}
        {t.descricao && <p className="aj-desc">{t.descricao}</p>}
      </div>
    </div>
  );
}
