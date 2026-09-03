// Guia da marca Vértice: nome, símbolo, cores e tipografia — a página do
// protótipo, dentro do sistema, para quem for produzir material ou conferir
// tokens sem abrir o arquivo de design.
import { Logo } from "./Logo";

const CORES = [
  ["#0E3B2B", "Floresta"], ["#178552", "Ação"], ["#7BD3A6", "Destaque"], ["#E4F3EB", "Tinta"],
  ["#12201A", "Texto"], ["#F4F6F5", "Fundo"], ["#B7791F", "Atenção"], ["#B93A3A", "Erro"],
];

export function Marca() {
  return (
    <div className="pagina marca-guia fade">
      <div>
        <div className="sobretitulo">Identidade</div>
        <h1 className="grande">Vértice</h1>
        <p className="lead">
          Vértice é o ponto onde o perímetro muda de direção: o dado que o operador confere,
          numera e certifica. É palavra do ofício, curta, sem tecnicismo de fornecedor e sem
          descrever a ferramenta.
        </p>
      </div>

      <div className="grade-3">
        <div className="bloco nome-cartao">
          <div className="rotulo-secao">Escolhido</div>
          <div className="nome-grande">Vértice</div>
          <div className="sub">Ponto do perímetro. Sugere precisão e a unidade mínima do trabalho.</div>
        </div>
        <div className="bloco nome-cartao alternativa">
          <div className="rotulo-secao">Alternativa</div>
          <div className="nome-grande">Marco</div>
          <div className="sub">Marco de divisa. Forte, mas genérico e concorrido como marca.</div>
        </div>
        <div className="bloco nome-cartao alternativa">
          <div className="rotulo-secao">Alternativa</div>
          <div className="nome-grande">Demarca</div>
          <div className="sub">Verbo de ação. Explica o serviço, mas soa institucional.</div>
        </div>
      </div>

      <div className="grade-2">
        <div className="marca-simbolo">
          <div className="marca-lockup">
            <Logo size={44} />
            <span>Vértice</span>
          </div>
          <p>Símbolo: um vértice e seus dois vizinhos, o traço mínimo de uma poligonal. O ponto de destaque em verde-claro é o vértice ativo.</p>
          <p className="frase">Do levantamento à certificação.</p>
        </div>
        <div className="bloco tokens">
          <div className="rotulo-secao">Cores</div>
          <div className="paleta">
            {CORES.map(([hex, nome]) => (
              <div key={hex}>
                <div className="amostra" style={{ background: hex, border: hex === "#F4F6F5" ? "1px solid var(--borda)" : undefined }} />
                <div className="mono">{hex}</div>
                <div className="sub">{nome}</div>
              </div>
            ))}
          </div>
          <div className="rotulo-secao" style={{ marginTop: 6 }}>Tipografia</div>
          <div className="tipos">
            <div><span className="tipo-titulo">Bricolage Grotesque</span><span className="sub">títulos</span></div>
            <div><span className="tipo-ui">Figtree</span><span className="sub">interface e formulários</span></div>
            <div><span className="tipo-mono">Fira Code 12°17'44,520" S</span><span className="sub">coordenadas, códigos, medidas</span></div>
          </div>
        </div>
      </div>

      <div className="bloco">
        <div className="rotulo-secao">O que mudou no sistema</div>
        <div className="grade-3 mudancas">
          <div><b>Navegação lateral</b>Libera a largura toda para o formulário e mantém o serviço aberto sempre à vista.</div>
          <div><b>Uma etapa por vez</b>A conferência deixou de ser uma rolagem única: Dados, Confrontantes, Vértices e Documentos são páginas dentro do serviço.</div>
          <div><b>Formulários mais curtos</b>Só os campos obrigatórios ficam à vista; o resto abre por seção, com o resumo do que já está preenchido.</div>
        </div>
      </div>
    </div>
  );
}
