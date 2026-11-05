// Os pontos em texto: o CSV para a planilha e o TXT para a coletora.
//
//  • CSV: Nome;E;N;Latitude;Longitude;Altitude — separador ";" e vírgula
//    decimal, como o Excel em português abre sem assistente (e com BOM, para
//    o acento do nome não virar lixo).
//  • TXT: P,E,N,Z,D sem cabeçalho, pelo mesmo gerador da locação do loteamento
//    (loteamento/saidas.ts) — o formato que toda coletora importa. Nome curto,
//    sem acento e sem repetir (a coletora recusa ponto com nome repetido).
import { arquivoLocacao } from "../loteamento/saidas.ts";
import type { PontoLocacao } from "../loteamento/saidas.ts";
import type { PontoArea } from "./coordenadas.ts";

const br = (v: number, casas: number) => v.toFixed(casas).replace(".", ",");
const campoCsv = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function gerarCsvPontos(pontos: PontoArea[]): string {
  const linhas = ["Nome;E;N;Latitude;Longitude;Altitude"];
  for (const p of pontos) {
    linhas.push([
      campoCsv(p.nome), br(p.utm[0], 3), br(p.utm[1], 3), br(p.geo[1], 9), br(p.geo[0], 9),
      typeof p.alt === "number" ? br(p.alt, 3) : "",
    ].join(";"));
  }
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Nome de ponto da coletora: até 16 letras/números/-_. (a mesma regra da locação). */
const nomeColetora = (s: string) => semAcento(s).replace(/[^A-Za-z0-9\-_.]/g, "").toUpperCase().slice(0, 16);
/** Descrição: sem vírgula (é o separador), sem acento, em maiúscula. */
const codigoColetora = (s: string) => semAcento(s).replace(/[,;"\t]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

export function gerarTxtColetora(pontos: PontoArea[]): string {
  const usados = new Set<string>();
  const lista: PontoLocacao[] = pontos.map((p, i) => {
    const base = nomeColetora(p.nome) || `P${i + 1}`;
    let nome = base;
    for (let k = 2; usados.has(nome); k++) nome = `${base.slice(0, 16 - String(k).length - 1)}-${k}`;
    usados.add(nome);
    // descrição: o tipo do marco (M/P/V do GEO), senão o código da locação (loteamento), senão a camada
    const desc = [p.props.tipo, p.props.codigo].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? p.camada;
    return {
      nome, e: p.utm[0], n: p.utm[1], h: p.alt ?? 0, codigo: codigoColetora(desc),
      p: [p.utm[0], p.utm[1]], tipo: "perimetro",
    };
  });
  return arquivoLocacao(lista, "penzd");
}
