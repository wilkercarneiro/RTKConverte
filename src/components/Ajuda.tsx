// Ajuda: canal de suporte e guia de primeiros passos (docs/guia-primeiros-passos.md).
import guia from "../../docs/guia-primeiros-passos.md?raw";
import { SUPORTE_EMAIL, SUPORTE_PRAZO, SUPORTE_WHATSAPP, TERMOS_PUBLICADOS } from "../lib/config";
import { Markdown } from "./Documento";

export function Ajuda() {
  const temCanal = Boolean(SUPORTE_EMAIL || SUPORTE_WHATSAPP);
  return (
    <div className="pagina fade">
      <div className="pagina-cabeca">
        <div>
          <h1>Ajuda</h1>
          <p className="sub">Suporte e primeiros passos</p>
        </div>
      </div>

      <section className="bloco">
        <header><h3>Suporte</h3><span className="desc">dúvida, erro ou pedido</span></header>
        {temCanal ? (
          <div className="canais-suporte">
            {SUPORTE_WHATSAPP && (
              <a className="botao-download" href={`https://wa.me/${SUPORTE_WHATSAPP}`} target="_blank" rel="noreferrer">WhatsApp</a>
            )}
            {SUPORTE_EMAIL && <a className="botao-download" href={`mailto:${SUPORTE_EMAIL}`}>{SUPORTE_EMAIL}</a>}
            {SUPORTE_PRAZO && <p className="sub" style={{ margin: 0 }}>{SUPORTE_PRAZO}</p>}
          </div>
        ) : (
          <p className="sub" style={{ margin: 0 }}>Fale com quem implantou o Vértice no seu escritório.</p>
        )}
        <p className="sub" style={{ margin: "14px 0 0" }}>
          Ao relatar um erro, diga o nome do serviço e o que estava fazendo — e, se puder, mande um print da tela.
        </p>
      </section>

      <section className="bloco">
        <Markdown texto={guia} />
      </section>

      {TERMOS_PUBLICADOS && <p className="sub"><a href="#/termos">Termos de Uso</a> · <a href="#/privacidade">Política de Privacidade</a></p>}
    </div>
  );
}
