// Laboratório do "Instalar app" (só no `npm run dev`, #/lab/instalar):
// o painel nas variantes de aparelho e a pílula de versão nova forçada.
//   #/lab/instalar            todas as variantes lado a lado + a pílula fixa
//   #/lab/instalar/android · /ios · /ios-chrome · /computador · /app · /app-velho
//   ?faixa=app                a pílula fixa no modo "versão nova do app"
//   ?gaveta                   abre a gaveta de verdade (como pelo menu)
import { useEffect } from "react";
import type { InfoAndroid, InfoServidor } from "../lib/versao";
import { FaixaVersao, InstalarAppGlobal, abrirInstalarApp, PainelInstalar } from "./InstalarApp";
import type { ForcarInstalar } from "./InstalarApp";
import { Logo } from "./Logo";
import "./casca.css";

const ANDROID: InfoAndroid = { versionCode: 2, versionName: "1.1.0", minimo: 1, url: "/baixar/vertces.apk?v=2" };
const SERVIDOR: InfoServidor = { versao: "lab", android: ANDROID };

const VARIANTES: { id: string; titulo: string; forcar: ForcarInstalar }[] = [
  { id: "android", titulo: "Android", forcar: { plataforma: "android", noApp: null, atalho: true, servidor: SERVIDOR } },
  { id: "ios", titulo: "iPhone (Safari)", forcar: { plataforma: "ios", noApp: null, navegadorIos: "safari", servidor: SERVIDOR } },
  { id: "ios-chrome", titulo: "iPhone (Chrome)", forcar: { plataforma: "ios", noApp: null, navegadorIos: "chrome", servidor: SERVIDOR } },
  { id: "computador", titulo: "Computador", forcar: { plataforma: "computador", noApp: null, servidor: SERVIDOR } },
  { id: "app", titulo: "Já no app (em dia)", forcar: { plataforma: "android", noApp: "android", versaoApp: 2, servidor: SERVIDOR } },
  { id: "app-velho", titulo: "Já no app (desatualizado)", forcar: { plataforma: "android", noApp: "android", versaoApp: 1, servidor: SERVIDOR } },
];

export function LaboratorioInstalar() {
  const so = location.hash.replace(/^#\/lab\/instalar\/?/, "").split(/[/?]/)[0];
  const q = new URLSearchParams(location.hash.split("?")[1] ?? location.search);
  const lista = so ? VARIANTES.filter((v) => v.id === so) : VARIANTES;
  const faixaApp = q.get("faixa") === "app";
  useEffect(() => { if (q.has("gaveta")) abrirInstalarApp(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="lab-instalar">
      <style>{`
        .lab-instalar { min-height: 100vh; background: var(--bg); padding: 20px 16px 120px; }
        .lab-instalar > header { display: flex; align-items: center; gap: 10px; margin: 0 auto 18px; max-width: 1400px; }
        .lab-instalar > header h1 { font-size: 18px; margin: 0; }
        .lab-instalar > header .tr-logo { width: 28px; height: 28px; }
        .lab-grade { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr)); max-width: 1400px; margin: 0 auto; }
        .lab-caixa { background: #fff; border: 1px solid var(--borda); border-radius: 16px; padding: 18px 20px; box-shadow: var(--sombra); }
        .lab-caixa > h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--texto-3); margin: 0 0 14px; }
        .lab-faixas { max-width: 1400px; margin: 22px auto 0; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
      `}</style>
      <header><Logo className="tr-logo" sobreClaro /><h1>Laboratório — Instalar app</h1></header>
      <div className="lab-grade">
        {lista.map((v) => (
          <section className="lab-caixa" key={v.id}>
            <h2>{v.titulo}</h2>
            <PainelInstalar forcar={v.forcar} />
          </section>
        ))}
      </div>
      {!so && (
        <div className="lab-faixas">
          <FaixaVersao forcar={{ site: true, app: null }} fixa={false} />
          <FaixaVersao forcar={{ site: false, app: ANDROID }} fixa={false} />
        </div>
      )}
      <FaixaVersao forcar={faixaApp ? { site: false, app: ANDROID } : { site: true, app: null }} />
      <InstalarAppGlobal />
    </div>
  );
}
