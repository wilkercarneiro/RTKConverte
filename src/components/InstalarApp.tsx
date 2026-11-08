// "Instalar app" e o aviso de versão nova.
//
// • PainelInstalar: dois botões, Android e iPhone (começa no aparelho de quem
//   abriu). Android: baixar o APK + 4 passos desenhados + "bloqueou?" recolhido.
//   iPhone: atalho na tela de início pelo Safari, 4 passos desenhados.
//   Computador: QR para abrir no celular e os dois botões embaixo.
//   O mesmo conteúdo, em HTML puro, está em public/baixar/index.html.
// • InstalarAppGlobal: mora na casca; abrirInstalarApp() abre a gaveta.
// • FaixaVersao: pílula fixa "Nova versão do Vertces" → Atualizar (e a do APK).
// Laboratório: #/lab/instalar (LaboratorioInstalar.tsx).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Gaveta } from "./ui";
import { gerarQr, retangulosQr } from "../../supabase/functions/_shared/qr.ts";
import {
  atualizarApp, atualizarSistema, criarAtalho, lerVersaoServidor, navegadorIosDe, noApp, plataformaAtual,
  URL_APK, URL_APP, URL_BAIXAR, useAtalhoDisponivel, useVersao, versaoDoApp,
} from "../lib/versao";
import type { InfoAndroid, InfoServidor, Plataforma } from "../lib/versao";
import "./instalar.css";

const EVENTO_ABRIR = "vertces:instalar-app";

/** Abre a gaveta "Instalar app" em cima da tela atual. */
export function abrirInstalarApp(): void {
  dispatchEvent(new Event(EVENTO_ABRIR));
}

/** Mora no AppShell: escuta abrirInstalarApp(). */
export function InstalarAppGlobal() {
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    const f = () => setAberta(true);
    addEventListener(EVENTO_ABRIR, f);
    return () => removeEventListener(EVENTO_ABRIR, f);
  }, []);
  if (!aberta) return null;
  return (
    <Gaveta olho="Celular" titulo="Instalar app" onFechar={() => setAberta(false)}>
      <PainelInstalar />
    </Gaveta>
  );
}

// ─── ícones ───────────────────────────────────────────────────────────────────

const P = {
  compartilhar: "M12 3v12M8 7l4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1",
  adicionar: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v8M8 12h8",
  baixar: "M12 3v12M7 10l5 5 5-5M5 21h14",
  celular: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  ok: "M20 6 9 17l-5-5",
  atualizar: "M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5",
  alerta: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  copiar: "M9 9h11v11H9zM5 15H4V4h11v1",
};
const Ico = ({ d, className }: { d: string; className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

// ─── QR (gerador do servidor, sem dependência) ───────────────────────────────

function QrCode({ texto, tamanho = 168 }: { texto: string; tamanho?: number }) {
  const q = useMemo(() => gerarQr(texto, "M"), [texto]);
  const borda = 4;
  const lado = q.tamanho + borda * 2;
  return (
    <svg className="ia-qr" width={tamanho} height={tamanho} viewBox={`0 0 ${lado} ${lado}`} shapeRendering="crispEdges" role="img" aria-label={`QR code para ${texto}`}>
      <rect width={lado} height={lado} fill="#fff" />
      {retangulosQr(q).map((r, i) => <rect key={i} x={r.x + borda} y={r.y + borda} width={r.w} height={1} fill="#0E3B2B" />)}
    </svg>
  );
}

// ─── painel ───────────────────────────────────────────────────────────────────

export interface ForcarInstalar {
  plataforma?: Plataforma;
  noApp?: "android" | "atalho" | null;
  navegadorIos?: "safari" | "chrome" | "outro";
  atalho?: boolean;
  versaoApp?: number | null;
  servidor?: InfoServidor | null;
}

/** O conteúdo da gaveta. `forcar` (laboratório) fixa a plataforma e o estado. */
export function PainelInstalar({ forcar }: { forcar?: ForcarInstalar }) {
  const plataforma = forcar?.plataforma ?? plataformaAtual();
  const onde = forcar && "noApp" in forcar ? forcar.noApp ?? null : noApp();
  const navIos = forcar?.navegadorIos ?? (typeof navigator !== "undefined" ? navegadorIosDe(navigator.userAgent) : "safari");
  const atalhoChrome = useAtalhoDisponivel();
  const atalho = forcar?.atalho ?? atalhoChrome;
  const [servidor, setServidor] = useState<InfoServidor | null>(forcar?.servidor ?? null);
  useEffect(() => {
    if (forcar) return;
    void lerVersaoServidor().then((s) => s && setServidor(s));
  }, [forcar]);
  const android: InfoAndroid | null = servidor?.android ?? null;
  const instalado = forcar && "versaoApp" in forcar ? forcar.versaoApp ?? null : versaoDoApp();

  if (onde) {
    const velho = onde === "android" && !!android && !!instalado && android.versionCode > instalado;
    return (
      <div className="ia">
        <div className="ia-feito">
          <span className="ia-feito-ico"><Ico d={P.ok} /></span>
          <div>
            <b>Você já está no app.</b>
            <p>{onde === "android"
              ? `App Vertces para Android${instalado ? (android && android.versionCode === instalado ? ` · versão ${android.versionName}` : ` · versão nº ${instalado}`) : ""}.`
              : "O Vertces abriu pelo atalho da tela de início."}</p>
          </div>
        </div>
        {velho && (
          <div className="ia-cartao">
            <b>Há uma versão nova do app ({android.versionName}).</b>
            <p>Baixe e instale por cima. Os seus dados continuam.</p>
            <button className="principal" onClick={() => atualizarApp(android)}><Ico d={P.baixar} className="ia-bico" />Atualizar app</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ia">
      {plataforma === "computador" && (
        <div className="ia-cartao ia-qr-cartao">
          <QrCode texto={URL_BAIXAR} tamanho={132} />
          <div>
            <b>Aponte a câmera do celular</b>
            <p>O código abre <b>vertces.com.br/baixar</b> no celular, já no passo a passo certo.</p>
          </div>
        </div>
      )}
      <Escolha plataforma={plataforma} android={android} atalho={atalho} navIos={navIos} />
    </div>
  );
}

// ─── escolha do aparelho ──────────────────────────────────────────────────────

type So = "android" | "ios";

function Escolha({ plataforma, android, atalho, navIos }: {
  plataforma: Plataforma; android: InfoAndroid | null; atalho: boolean; navIos: "safari" | "chrome" | "outro";
}) {
  // começa no aparelho de quem abriu; no computador, nenhum (o QR vem primeiro)
  const [so, setSo] = useState<So | null>(plataforma === "computador" ? null : plataforma);
  const opcao = (id: So, nome: string, sub: string, ico: ReactNode) => (
    <button type="button" role="tab" id={`ia-tab-${id}`} aria-selected={so === id} aria-controls="ia-guia"
      className={so === id ? "ia-so ativo" : "ia-so"} onClick={() => setSo(id)}>
      <span className="ia-so-ico">{ico}</span>
      <span className="ia-so-tx"><b>{nome}</b><small>{sub}</small></span>
      {plataforma === id && <span className="ia-so-este">Este celular</span>}
    </button>
  );
  return (
    <>
      <div className="ia-escolha">
        <p className="ia-pergunta">{plataforma === "computador" ? "Ou veja o passo a passo do seu celular:" : "Qual é o seu celular?"}</p>
        <div className="ia-sos" role="tablist" aria-label="Qual é o seu celular?">
          {opcao("android", "Android", "Samsung, Motorola…", <CelAndroid />)}
          {opcao("ios", "iPhone", "e iPad", <CelIphone />)}
        </div>
      </div>
      {so && (
        <div className="ia-guia" id="ia-guia" role="tabpanel" aria-labelledby={`ia-tab-${so}`} key={so}>
          {so === "android" ? <GuiaAndroid android={android} atalho={atalho} /> : <GuiaIphone navIos={plataforma === "ios" ? navIos : "safari"} />}
        </div>
      )}
    </>
  );
}

/** Um passo: número na trilha, título curto, uma frase e o desenho do que aparece na tela. */
function Passo({ n, titulo, children, desenho }: { n: number; titulo: string; children?: ReactNode; desenho?: ReactNode }) {
  return (
    <li className="ia-passo">
      <span className="ia-num" aria-hidden="true">{n}</span>
      <div className="ia-passo-tx">
        <b>{titulo}</b>
        {children && <p>{children}</p>}
        {desenho && <div className="ia-desenho" aria-hidden="true">{desenho}</div>}
      </div>
    </li>
  );
}

function GuiaAndroid({ android, atalho }: { android: InfoAndroid | null; atalho: boolean }) {
  const href = android?.url ?? URL_APK;
  return (
    <>
      <a className="ia-baixar" href={href} download="vertces.apk">
        <Ico d={P.baixar} />Baixar o app
      </a>
      <p className="ia-baixar-info">Grátis{android ? ` · versão ${android.versionName}` : ""} · abre no Chrome do celular</p>
      <ol className="ia-trilha">
        <Passo n={1} titulo="Baixe o app">Toque no botão verde acima. O celular baixa o arquivo <b>vertces.apk</b>.</Passo>
        <Passo n={2} titulo="Abra o arquivo" desenho={<DesenhoDownload />}>
          Quando terminar, toque em <b>Abrir</b> no aviso. Sumiu? Abra pela pasta <b>Downloads</b>.
        </Passo>
        <Passo n={3} titulo="Toque em Instalar" desenho={<DesenhoInstalar />} />
        <Passo n={4} titulo="Pronto" desenho={<DesenhoTelaInicio />}>Abra o Vertces pelo ícone na tela de início.</Passo>
      </ol>
      <details className="ia-ajuda">
        <summary><Ico d={P.alerta} />O celular bloqueou a instalação?</summary>
        <div>
          <p>É normal: o app ainda não está na Play Store, então o Android pede confirmação.</p>
          <ul>
            <li><span className="ia-ajuda-aviso">“Não é permitido instalar apps desta fonte”</span> Toque em <b>Configurações</b>, ligue <b>Permitir desta fonte</b> e volte.</li>
            <li><span className="ia-ajuda-aviso">“Bloqueado pelo Play Protect”</span> Toque em <b>Mais detalhes</b> e em <b>Instalar mesmo assim</b>.</li>
            <li><span className="ia-ajuda-aviso">Não abre ou fica em branco</span> Atualize o <b>Google Chrome</b> pela Play Store.</li>
          </ul>
        </div>
      </details>
      {atalho && (
        <div className="ia-alt-linha">
          <span>Prefere não baixar nada?</span>
          <button type="button" className="ia-atalho" onClick={() => void criarAtalho()}><Ico d={P.adicionar} />Criar só um atalho</button>
        </div>
      )}
    </>
  );
}

function GuiaIphone({ navIos }: { navIos: "safari" | "chrome" | "outro" }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(URL_APP); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* sem permissão */ }
  };
  return (
    <>
      {navIos !== "safari" && (
        <div className="ia-safari-aviso">
          <Ico d={P.alerta} />
          <div>
            <b>Abra no Safari</b>
            <p>{navIos === "chrome"
              ? <>No Chrome do iPhone o passo a passo pode não aparecer. Copie o link e cole no <b>Safari</b>.</>
              : <>Este navegador não cria o ícone. Copie o link e cole no <b>Safari</b>.</>}</p>
            <button type="button" className="ia-copiar" onClick={() => void copiar()}>
              <Ico d={copiado ? P.ok : P.copiar} />{copiado ? "Link copiado" : "Copiar link"}
            </button>
          </div>
        </div>
      )}
      <p className="ia-intro">Sem App Store e sem baixar nada: o Vertces vira um ícone na tela de início e abre em tela cheia, como um app.</p>
      <ol className="ia-trilha">
        <Passo n={1} titulo="Toque em Compartilhar" desenho={<DesenhoSafari />}>
          No <b>Safari</b>, em <b>vertces.com.br/app</b>. Fica na barra de baixo. Não achou? <span className="ia-junto">Toque antes em <span className="ia-tecla">⋯</span></span>
        </Passo>
        <Passo n={2} titulo="Adicionar à Tela de Início" desenho={<DesenhoFolha />}>Role a lista para baixo até achar.</Passo>
        <Passo n={3} titulo="Toque em Adicionar" desenho={<DesenhoAdicionar />}>No canto de cima, à direita.</Passo>
        <Passo n={4} titulo="Pronto" desenho={<DesenhoTelaInicio ios />}>Abra o Vertces pelo ícone na tela de início.</Passo>
      </ol>
    </>
  );
}

// ─── desenhos (o que a pessoa vai ver na tela) ────────────────────────────────

/** Cabeça do robozinho do Android (traço simples, não o logotipo). */
const CelAndroid = () => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 22a10 10 0 0 1 20 0z" /><path d="M10.5 10.5 8 6.5M21.5 10.5 24 6.5" />
    <circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" /><circle cx="20" cy="17" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);
const CelIphone = () => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="3" width="16" height="26" rx="4" /><rect x="13.2" y="5.6" width="5.6" height="1.9" rx=".95" fill="currentColor" stroke="none" />
    <path d="M13.5 25.5h5" />
  </svg>
);
const IconeVertces = ({ tam = 34 }: { tam?: number }) => <img className="ia-d-icone" src="/icones/icone-192.png" alt="" width={tam} height={tam} />;

function DesenhoDownload() {
  return (
    <div className="ia-d ia-d-aviso">
      <span className="ia-d-aviso-ico"><Ico d={P.baixar} /></span>
      <span className="ia-d-aviso-tx"><b>vertces.apk</b><small>Download concluído</small></span>
      <span className="ia-d-alvo ia-d-txt">Abrir</span>
    </div>
  );
}
function DesenhoInstalar() {
  return (
    <div className="ia-d ia-d-dialogo">
      <div className="ia-d-dialogo-app"><IconeVertces tam={28} /><b>Vertces</b></div>
      <p>Quer instalar este app?</p>
      <div className="ia-d-botoes"><span>Cancelar</span><span className="ia-d-alvo ia-d-txt">Instalar</span></div>
    </div>
  );
}
function DesenhoSafari() {
  return (
    <div className="ia-d ia-d-safari">
      <div className="ia-d-safari-url">vertces.com.br/app</div>
      <div className="ia-d-safari-barra">
        <span><Ico d="M15 18l-6-6 6-6" /></span><span><Ico d="M9 18l6-6-6-6" /></span>
        <span className="ia-d-alvo"><Ico d={P.compartilhar} /></span>
        <span><Ico d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /></span>
        <span><Ico d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></span>
      </div>
    </div>
  );
}
function DesenhoFolha() {
  return (
    <div className="ia-d ia-d-folha">
      <span><em>Copiar</em><Ico d="M9 9h11v11H9zM5 15H4V4h11v1" /></span>
      <span><em>Adicionar aos Favoritos</em><Ico d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></span>
      <span className="ia-d-alvo"><em>Adicionar à Tela de Início</em><Ico d={P.adicionar} /></span>
    </div>
  );
}
function DesenhoAdicionar() {
  return (
    <div className="ia-d ia-d-add">
      <div className="ia-d-add-topo"><span>Cancelar</span><b>Adicionar à Tela de Início</b><span className="ia-d-alvo ia-d-txt">Adicionar</span></div>
      <div className="ia-d-add-app"><IconeVertces tam={30} /><span><b>Vertces</b><small>vertces.com.br</small></span></div>
    </div>
  );
}
function DesenhoTelaInicio({ ios }: { ios?: boolean }) {
  return (
    <div className={ios ? "ia-d ia-d-inicio ios" : "ia-d ia-d-inicio"}>
      <span className="ia-d-app c1" /><span className="ia-d-app c2" />
      <span className="ia-d-app-v"><IconeVertces tam={36} /><small>Vertces</small></span>
      <span className="ia-d-app c3" />
    </div>
  );
}

// ─── faixa de versão nova ─────────────────────────────────────────────────────

export interface ForcarFaixa { site?: boolean; app?: InfoAndroid | null }

/** Pílula fixa embaixo: "Nova versão do Vertces" → Atualizar; no app velho, "Atualizar app". */
export function FaixaVersao({ forcar, fixa = true }: { forcar?: ForcarFaixa; fixa?: boolean }) {
  const real = useVersao();
  const site = forcar?.site ?? real.site;
  const app = forcar && "app" in forcar ? forcar.app ?? null : real.app;
  // "Agora não" vale até aparecer outra versão
  const chave = app ? `app:${app.versionCode}` : site ? `site:${real.servidor?.versao ?? "?"}` : "";
  const [adiada, setAdiada] = useState<string | null>(() => { try { return sessionStorage.getItem("vertces.versao.adiada"); } catch { return null; } });
  if (!chave || (!forcar && adiada === chave && !real.appObrigatorio)) return null;
  const adiar = () => { setAdiada(chave); try { sessionStorage.setItem("vertces.versao.adiada", chave); } catch { /* modo privado */ } };
  return (
    <div className={fixa ? "versao-faixa" : "versao-faixa solta"} role="status" aria-live="polite">
      <span className="versao-ico"><Ico d={app ? P.baixar : P.atualizar} /></span>
      <span className="versao-tx">
        <b>{app ? "Há uma versão nova do app" : "Nova versão do Vertces disponível"}</b>
        <small>{app ? `Versão ${app.versionName}. Instale por cima da atual.` : "Atualize para usar a mais recente."}</small>
      </span>
      <button className="versao-bt" onClick={() => (app ? atualizarApp(app) : atualizarSistema())}>
        {app ? "Atualizar app" : "Atualizar"}
      </button>
      {!real.appObrigatorio && <button className="versao-x" onClick={adiar} aria-label="Agora não" title="Agora não">✕</button>}
    </div>
  );
}
