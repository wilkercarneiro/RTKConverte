// Barreira de erro: um erro de desenho numa parte da tela fica NELA.
//
// Sem barreira, o React desmonta a aplicação inteira quando um componente
// lança — o usuário fica olhando uma página em branco, sem menu e sem saber o
// que houve (o mapa sem WebGL fazia isso na conferência). Com ela, só a parte
// que falhou vira um aviso com "tentar de novo"; o resto da tela continua.
//
//   <BarreiraErro onde="o mapa">…</BarreiraErro>          parte de uma tela
//   <BarreiraErro onde="esta tela" chave={rota}>…</…>     a tela inteira (AppShell)
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { relatarErro } from "../lib/monitoramento";

interface Props {
  /** o que deixou de aparecer, para a mensagem: "o mapa", "esta tela"… */
  onde: string;
  children: ReactNode;
  /** muda → a barreira se reinicia (ex.: trocar de tela limpa o erro da anterior) */
  chave?: unknown;
  /** caixa menor, para uma parte da tela */
  compacta?: boolean;
  /** o que mostrar em vez do erro técnico, quando a causa é conhecida */
  explicar?: (erro: Error) => string | null;
}

interface Estado { erro: Error | null; chave: unknown; tentativas: number }

export class BarreiraErro extends Component<Props, Estado> {
  state: Estado = { erro: null, chave: this.props.chave, tentativas: 0 };

  static getDerivedStateFromError(erro: unknown): Partial<Estado> {
    return { erro: erro instanceof Error ? erro : new Error(String(erro)) };
  }

  static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
    // outra tela/serviço: o erro da anterior não vale para esta
    if (!Object.is(props.chave, estado.chave)) return { erro: null, chave: props.chave };
    return null;
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    console.error(`[BarreiraErro] ${this.props.onde}:`, erro, info.componentStack);
    relatarErro(erro, `barreira: ${this.props.onde}`);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return <Fragmento key={this.state.tentativas}>{this.props.children}</Fragmento>;
    const explicacao = this.props.explicar?.(erro) ?? null;
    return (
      <div className={`barreira-erro${this.props.compacta ? " compacta" : ""}`} role="alert">
        <b>Não deu para mostrar {this.props.onde}.</b>
        <p>{explicacao ?? "Aconteceu um erro inesperado nesta parte. O resto do sistema continua funcionando e nada do que você salvou foi perdido."}</p>
        {!explicacao && <p className="detalhe mono">{erro.message.slice(0, 300)}</p>}
        <div className="acoes">
          <button type="button" className="principal" onClick={() => this.setState((s) => ({ erro: null, tentativas: s.tentativas + 1 }))}>
            Tentar de novo
          </button>
          <button type="button" className="fantasma" onClick={() => location.reload()}>Recarregar a página</button>
        </div>
      </div>
    );
  }
}

/** Fragment com key: "tentar de novo" remonta os filhos do zero. */
function Fragmento({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
