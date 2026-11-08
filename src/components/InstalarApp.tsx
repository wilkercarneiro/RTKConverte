// "Instalar app" e o aviso de versão nova.
//
// • PainelInstalar: o que fazer em cada aparelho — Android baixa o APK (app
//   próprio, roda no Chrome), iPhone cria o atalho na tela de início pelo
//   Safari, computador mostra o QR para abrir no celular.
// • InstalarAppGlobal: mora na casca; abrirInstalarApp() abre a gaveta.
// • FaixaVersao: pílula fixa "Nova versão do Vertces" → Atualizar (e a do APK).
// Laboratório: #/lab/instalar (LaboratorioInstalar.tsx).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Gaveta } from "./ui";
import { gerarQr, retangulosQr } from "../../supabase/functions/_shared/qr.ts";
import {
  atualizarApp, atualizarSistema, criarAtalho, lerVersaoServidor, navegadorIosDe, noApp, plataformaAtual,
  URL_APK, URL_BAIXAR, useAtalhoDisponivel, useVersao, versaoDoApp,
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

// ─── passos ───────────────────────────────────────────────────────────────────

function Passos({ itens }: { itens: ReactNode[] }) {
  return (
    <ol className="ia-passos">
      {itens.map((t, i) => <li key={i}><span className="ia-num" aria-hidden="true">{i + 1}</span><div>{t}</div></li>)}
    </ol>
  );
}

/** Botão do iOS desenhado no texto ("toque em [ícone] Compartilhar"). */
const Tecla = ({ d, children }: { d: string; children: ReactNode }) => (
  <span className="ia-tecla"><Ico d={d} />{children}</span>
);

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

  if (plataforma === "android") {
    const href = android?.url ?? URL_APK;
    return (
      <div className="ia">
        <div className="ia-topo">
          <img src="/icones/icone-192.png" alt="" width={56} height={56} />
          <div>
            <b>App Vertces para Android</b>
            <p>Abre o sistema em tela cheia, direto do ícone. Usa o Chrome do celular.</p>
          </div>
        </div>
        <a className="ia-baixar" href={href} download="vertces.apk">
          <Ico d={P.baixar} />Baixar o app
          {android && <small>versão {android.versionName}</small>}
        </a>
        <div className="ia-cartao">
          <b>Como instalar</b>
          <p className="ia-sub">O app ainda não está na Play Store. Por isso o Android pede uma permissão a mais.</p>
          <Passos itens={[
            <>Toque em <b>Baixar o app</b>. O Chrome baixa o arquivo <code>vertces.apk</code>.</>,
            <>Toque em <b>Abrir</b> no aviso do download (ou abra o arquivo na pasta <b>Downloads</b>).</>,
            <>Se aparecer <i>“Por segurança, o celular não permite instalar apps desta fonte”</i>: toque em <b>Configurações</b>, ligue <b>Permitir desta fonte</b> e volte.</>,
            <>Toque em <b>Instalar</b>. Se o Play Protect avisar, toque em <b>Mais detalhes</b> → <b>Instalar mesmo assim</b>.</>,
            <>Pronto: o ícone <b>Vertces</b> aparece na tela de início.</>,
          ]} />
          <p className="ia-nota">Precisa do <b>Google Chrome</b> atualizado no celular.</p>
        </div>
        {atalho && (
          <div className="ia-cartao ia-alt">
            <b>Prefere só um atalho?</b>
            <p>Cria o ícone na tela de início sem baixar nada.</p>
            <button onClick={() => void criarAtalho()}><Ico d={P.adicionar} className="ia-bico" />Criar atalho</button>
          </div>
        )}
      </div>
    );
  }

  if (plataforma === "ios") {
    return (
      <div className="ia">
        <div className="ia-topo">
          <img src="/icones/icone-192.png" alt="" width={56} height={56} />
          <div>
            <b>Ainda não temos app para iPhone.</b>
            <p>Dá para criar um atalho na tela de início que abre o Vertces como um app:</p>
          </div>
        </div>
        <div className="ia-cartao">
          <b>No Safari</b>
          <Passos itens={[
            <>Abra <b>vertces.com.br/app</b> no <b>Safari</b>.</>,
            <>Toque no botão <Tecla d={P.compartilhar}>Compartilhar</Tecla> (na barra de baixo; no iPad, no alto).</>,
            <>Role a lista e toque em <Tecla d={P.adicionar}>Adicionar à Tela de Início</Tecla>.</>,
            <>Toque em <b>Adicionar</b>, no canto de cima.</>,
          ]} />
          <MiniSafari />
        </div>
        <div className={navIos === "safari" ? "ia-cartao ia-alt" : "ia-cartao ia-alerta"}>
          {navIos === "safari"
            ? <><b>Está no Chrome do iPhone?</b><p>Nas versões novas (iOS 16.4 ou mais) também dá: toque em <Tecla d={P.compartilhar}>Compartilhar</Tecla> na barra de endereço (ou no menu <span className="ia-tecla">⋯</span>) e em <b>Adicionar à Tela de Início</b>. Se não aparecer, use o Safari.</p></>
            : <><b>Você está {navIos === "chrome" ? "no Chrome" : "em outro navegador"}.</b><p>{navIos === "chrome"
              ? <>Nas versões novas dá por aqui: toque em <Tecla d={P.compartilhar}>Compartilhar</Tecla> na barra de endereço (ou no menu <span className="ia-tecla">⋯</span>) e em <b>Adicionar à Tela de Início</b>. Se não aparecer, abra no Safari.</>
              : <>Abra <b>vertces.com.br/app</b> no <b>Safari</b> e siga os passos acima.</>}</p></>}
        </div>
      </div>
    );
  }

  return (
    <div className="ia">
      <div className="ia-topo">
        <span className="ia-topo-ico"><Ico d={P.celular} /></span>
        <div>
          <b>O app é para o celular.</b>
          <p>No computador, use o Vertces pelo navegador, como agora.</p>
        </div>
      </div>
      <div className="ia-cartao ia-qr-cartao">
        <QrCode texto={URL_BAIXAR} />
        <div>
          <b>Abra no celular</b>
          <p>Aponte a câmera do celular para o código. Ou digite <b>vertces.com.br/baixar</b> no navegador do celular.</p>
          <ul className="ia-lista">
            <li><b>Android:</b> baixa o app Vertces.</li>
            <li><b>iPhone:</b> mostra como criar o atalho.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Desenho da barra de baixo do Safari, com o Compartilhar em destaque. */
function MiniSafari() {
  return (
    <div className="ia-safari" aria-hidden="true">
      <div className="ia-safari-url">vertces.com.br</div>
      <div className="ia-safari-barra">
        <span>‹</span><span>›</span>
        <span className="ia-safari-alvo"><Ico d={P.compartilhar} /></span>
        <span><Ico d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /></span>
        <span><Ico d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></span>
      </div>
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
