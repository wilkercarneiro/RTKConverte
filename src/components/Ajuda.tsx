// Ajuda: canal de suporte e guia de primeiros passos (docs/guia-primeiros-passos.md).
import guia from "../../docs/guia-primeiros-passos.md?raw";
import { SUPORTE_EMAIL, SUPORTE_PRAZO, SUPORTE_WHATSAPP, TERMOS_PUBLICADOS } from "../lib/config";
import { Markdown } from "./Documento";
import { CabecalhoPagina } from "./ui";

export function Ajuda() {
  const temCanal = Boolean(SUPORTE_EMAIL || SUPORTE_WHATSAPP);
  return (
    <div className="pagina fade">
      <CabecalhoPagina olho="Suporte" titulo="Ajuda" descricao="Fale com o suporte ou siga o guia de primeiros passos" />

      <section className="bloco">
        <header><h3>Suporte</h3><span className="desc">dúvida, erro ou pedido</span></header>
        {temCanal ? (
          <div className="canais-suporte">
            {SUPORTE_WHATSAPP && (
              <a className="botao-download" href={`https://wa.me/${SUPORTE_WHATSAPP}`} target="_blank" rel="noreferrer">
                WhatsApp<span className="sr-only"> (abre em nova aba)</span>
              </a>
            )}
            {SUPORTE_EMAIL && <a className="botao-download" href={`mailto:${SUPORTE_EMAIL}`}>{SUPORTE_EMAIL}</a>}
            {SUPORTE_PRAZO && <p className="sub">{SUPORTE_PRAZO}</p>}
          </div>
        ) : (
          <p className="sub sem-margem">Fale com quem implantou o Vértice no seu escritório.</p>
        )}
        <p className="sub ajuda-dica">
          Ao relatar um erro, diga o nome do serviço e o que estava fazendo — e, se puder, mande um print da tela.
        </p>
      </section>

      <section className="bloco guia" aria-label="Guia de primeiros passos">
        <Markdown texto={guia} />
      </section>

      {TERMOS_PUBLICADOS && <p className="sub"><a href="#/termos">Termos de Uso</a> · <a href="#/privacidade">Política de Privacidade</a></p>}
    </div>
  );
}
