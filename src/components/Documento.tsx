// Renderiza os textos em docs/legal/*.md (termos, privacidade) e o guia de
// primeiros passos. Markdown mínimo e conhecido — títulos, parágrafos, listas,
// citação, tabela, **negrito** e [links](url) — para não puxar uma biblioteca
// por três páginas de texto que nós mesmos escrevemos.
import type { ReactNode } from "react";

function inline(texto: string, chave: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  let ultimo = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(texto))) {
    if (m.index > ultimo) out.push(texto.slice(ultimo, m.index));
    if (m[1] !== undefined) out.push(<b key={`${chave}-${i++}`}>{m[1]}</b>);
    else out.push(<a key={`${chave}-${i++}`} href={m[3]}>{m[2]}</a>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

const celulas = (linha: string) => linha.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ texto }: { texto: string }) {
  const linhas = texto.replace(/\r/g, "").split("\n");
  const blocos: ReactNode[] = [];
  let k = 0;
  for (let i = 0; i < linhas.length;) {
    const l = linhas[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) {
      const nivel = h[1].length;
      const conteudo = inline(h[2], `h${k}`);
      blocos.push(nivel === 1 ? <h1 key={k++}>{conteudo}</h1> : nivel === 2 ? <h2 key={k++}>{conteudo}</h2> : <h3 key={k++}>{conteudo}</h3>);
      i++; continue;
    }
    if (l.startsWith(">")) {
      const partes: string[] = [];
      while (i < linhas.length && linhas[i].startsWith(">")) partes.push(linhas[i++].replace(/^>\s?/, ""));
      blocos.push(<blockquote key={k++}>{inline(partes.join(" "), `q${k}`)}</blockquote>);
      continue;
    }
    if (l.startsWith("|")) {
      const rows: string[] = [];
      while (i < linhas.length && linhas[i].startsWith("|")) rows.push(linhas[i++]);
      const [cab, , ...corpo] = rows;
      blocos.push(
        <div className="tabela-wrap" key={k++}>
          <table className="tabela-vertices">
            <thead><tr>{celulas(cab).map((c, j) => <th key={j}>{inline(c, `th${k}-${j}`)}</th>)}</tr></thead>
            <tbody>{corpo.map((r, ri) => <tr key={ri}>{celulas(r).map((c, j) => <td key={j}>{inline(c, `td${k}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const lista = /^(\d+\.|-)\s+/;
    if (lista.test(l)) {
      const numerada = /^\d+\./.test(l);
      const itens: string[] = [];
      while (i < linhas.length && lista.test(linhas[i])) itens.push(linhas[i++].replace(lista, ""));
      const lis = itens.map((t, j) => <li key={j}>{inline(t, `li${k}-${j}`)}</li>);
      blocos.push(numerada ? <ol key={k++}>{lis}</ol> : <ul key={k++}>{lis}</ul>);
      continue;
    }
    const par: string[] = [];
    while (i < linhas.length && linhas[i].trim() && !/^(#|>|\||-\s|\d+\.\s)/.test(linhas[i])) par.push(linhas[i++]);
    blocos.push(<p key={k++}>{inline(par.join(" "), `p${k}`)}</p>);
  }
  return <div className="documento">{blocos}</div>;
}

/** Página pública (sem login) com um documento e o caminho de volta. */
export function PaginaDocumento({ texto, voltar }: { texto: string; voltar: { rotulo: string; href: string } }) {
  return (
    <div className="pagina-publica">
      <div className="pagina-publica-conteudo">
        <a className="voltar" href={voltar.href}>← {voltar.rotulo}</a>
        <Markdown texto={texto} />
      </div>
    </div>
  );
}
