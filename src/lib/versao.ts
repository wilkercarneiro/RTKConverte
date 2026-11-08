// Versão do sistema e do app Android: "tem coisa nova?" e "onde estou?".
//
// O build grava /app/versao.json (vite.config.ts) com o id do build e a versão
// do APK publicado. O sistema aberto compara:
//   • o id do build com o __VERSAO__ embutido no bundle → "Nova versão do Vertces"
//     com o botão Atualizar (recarrega a página);
//   • o versionCode do APK com o ?versaoApp=N que o app Android põe na URL de
//     abertura → "Há uma versão nova do app" com o botão que baixa o APK.
//
// Funções puras no começo (testadas em tests/versao.test.mjs); o hook no fim.
// Sem imports relativos: o teste importa este arquivo direto pelo Node.
import { useEffect, useState } from "react";

export interface InfoAndroid {
  versionCode: number;
  versionName: string;
  /** versionCode mínimo aceito (abaixo disso o aviso não deixa fechar) */
  minimo: number;
  url: string;
}
export interface InfoServidor {
  versao: string;
  gerado?: string;
  android?: InfoAndroid | null;
}

/** Id do build deste bundle ("dev" no `npm run dev`). */
export const VERSAO_ATUAL: string = typeof __VERSAO__ !== "undefined" ? __VERSAO__ : "dev";

export const URL_APK = "/baixar/vertces.apk";
export const URL_BAIXAR = "https://vertces.com.br/baixar/";

// ─── plataforma ───────────────────────────────────────────────────────────────

export type Plataforma = "android" | "ios" | "computador";

/** iPadOS se diz "Macintosh": o toque denuncia. */
export function plataformaDe(ua: string, toques = 0): Plataforma {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && toques > 1)) return "ios";
  return "computador";
}

/** No iPhone: Safari, Chrome (CriOS) ou outro (Firefox, Edge, app com navegador embutido). */
export function navegadorIosDe(ua: string): "safari" | "chrome" | "outro" {
  if (/CriOS/i.test(ua)) return "chrome";
  if (/FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//i.test(ua)) return "outro";
  return "safari";
}

/** O build do servidor é outro? (no dev nunca: lá a versão é "dev") */
export function haNovaVersao(atual: string, servidor: string | null | undefined): boolean {
  return !!servidor && atual !== "dev" && servidor !== atual;
}

/** O APK instalado é mais velho que o publicado? */
export function appDesatualizado(instalado: number | null | undefined, android: InfoAndroid | null | undefined): boolean {
  return !!android && typeof instalado === "number" && instalado > 0 && android.versionCode > instalado;
}

/** Lê ?origem=android&versaoApp=N de uma query string. */
export function lerOrigem(search: string): { android: boolean; versaoApp: number | null } {
  const q = new URLSearchParams(search);
  const n = Number(q.get("versaoApp"));
  return { android: q.get("origem") === "android", versaoApp: Number.isInteger(n) && n > 0 ? n : null };
}

// ─── onde o sistema está rodando ──────────────────────────────────────────────

const SESSAO_APP = "vertces.noApp";
const VERSAO_APP = "vertces.versaoApp";

function guardarSessao(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* modo privado */ } }
function lerSessao(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } }
function guardarLocal(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } }
function lerLocal(k: string) { try { return localStorage.getItem(k); } catch { return null; } }

/**
 * Chamado ao carregar: o app Android abre /app/?origem=android&versaoApp=N.
 * A rota por hash troca a URL depois, então a origem fica guardada — na sessão
 * (é esta aba que é o app) e a versão também no aparelho (o app reabre por
 * link sem a query).
 */
export function registrarOrigem(): void {
  if (typeof location === "undefined") return;
  const o = lerOrigem(location.search);
  const doApp = o.android || (typeof document !== "undefined" && document.referrer.startsWith("android-app://br.com.vertces.app"));
  if (doApp) guardarSessao(SESSAO_APP, "android");
  if (o.versaoApp) { guardarSessao(VERSAO_APP, String(o.versaoApp)); guardarLocal(VERSAO_APP, String(o.versaoApp)); }
}

function emTelaCheia(): boolean {
  try {
    return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

/** "android" = app Android; "atalho" = atalho da tela de início (PWA); null = navegador. */
export function noApp(): "android" | "atalho" | null {
  if (lerSessao(SESSAO_APP) === "android") return "android";
  if (!emTelaCheia()) return null;
  // o app Android também roda "standalone"; reaberto por link, a sessão é nova
  if (plataformaAtual() === "android" && lerLocal(VERSAO_APP)) return "android";
  return "atalho";
}

/** versionCode do APK que abriu o sistema (null fora do app). */
export function versaoDoApp(): number | null {
  if (noApp() !== "android") return null;
  const n = Number(lerSessao(VERSAO_APP) ?? lerLocal(VERSAO_APP));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function plataformaAtual(): Plataforma {
  if (typeof navigator === "undefined") return "computador";
  return plataformaDe(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

// ─── atalho pelo Chrome (beforeinstallprompt) ─────────────────────────────────

interface PedidoInstalacao extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let pedido: PedidoInstalacao | null = null;
const EVENTO_PEDIDO = "vertces:pedido-instalacao";
if (typeof addEventListener !== "undefined") {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pedido = e as PedidoInstalacao;
    dispatchEvent(new Event(EVENTO_PEDIDO));
  });
  addEventListener("appinstalled", () => { pedido = null; dispatchEvent(new Event(EVENTO_PEDIDO)); });
}

/** O Chrome ofereceu "instalar" (criar atalho)? */
export function useAtalhoDisponivel(): boolean {
  const [ok, setOk] = useState(!!pedido);
  useEffect(() => {
    const f = () => setOk(!!pedido);
    addEventListener(EVENTO_PEDIDO, f);
    return () => removeEventListener(EVENTO_PEDIDO, f);
  }, []);
  return ok;
}

/** Abre o pedido do Chrome; true se a pessoa aceitou. */
export async function criarAtalho(): Promise<boolean> {
  if (!pedido) return false;
  const p = pedido;
  pedido = null;
  await p.prompt();
  const r = await p.userChoice.catch(() => ({ outcome: "dismissed" }));
  dispatchEvent(new Event(EVENTO_PEDIDO));
  return r.outcome === "accepted";
}

// ─── conferência periódica ────────────────────────────────────────────────────

const INTERVALO = 10 * 60_000;

export async function lerVersaoServidor(): Promise<InfoServidor | null> {
  try {
    const r = await fetch(`/app/versao.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as InfoServidor;
    return j && typeof j.versao === "string" ? j : null;
  } catch { return null; }
}

/** Liga a conferência fora do build? (?versao=forcar ou localStorage vertces.versao.forcar=1) */
function conferirNoDev(): boolean {
  return /[?&]versao=forcar\b/.test(location.search) || lerLocal("vertces.versao.forcar") === "1";
}

export interface EstadoVersao {
  /** o servidor tem um build novo do sistema */
  site: boolean;
  /** o servidor tem um APK mais novo que o instalado (só dentro do app) */
  app: InfoAndroid | null;
  /** APK abaixo do mínimo */
  appObrigatorio: boolean;
  /** versão lida do servidor (null = ainda não leu / sem arquivo) */
  servidor: InfoServidor | null;
}

/** Confere ao abrir, a cada 10 min e quando a aba volta a ficar visível. */
export function useVersao(): EstadoVersao {
  const [servidor, setServidor] = useState<InfoServidor | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV && !conferirNoDev()) return;
    let vivo = true;
    const ler = () => { void lerVersaoServidor().then((s) => { if (vivo && s) setServidor(s); }); };
    ler();
    const t = window.setInterval(ler, INTERVALO);
    const vis = () => { if (document.visibilityState === "visible") ler(); };
    document.addEventListener("visibilitychange", vis);
    return () => { vivo = false; window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  const instalado = versaoDoApp();
  const android = servidor?.android ?? null;
  const app = appDesatualizado(instalado, android) ? android : null;
  return {
    site: haNovaVersao(VERSAO_ATUAL, servidor?.versao),
    app,
    appObrigatorio: !!app && instalado !== null && instalado < app.minimo,
    servidor,
  };
}

/** Recarrega o sistema de verdade (os arquivos do build têm hash: o index novo traz tudo novo). */
export function atualizarSistema(): void {
  location.reload();
}

/** Baixa o APK novo (o Android mostra o "Instalar" ao abrir o arquivo). */
export function atualizarApp(info: InfoAndroid | null): void {
  location.href = info?.url ?? URL_APK;
}
