// A quem pertence a divisa de ABERTURA de um anel.
//
// O primeiro vértice de um anel quase nunca inicia trecho: ele pertence ao
// confrontante que dá a volta, o do ÚLTIMO início daquele anel. O código pegava
// a última entrada do mapa `inicios` — que é do imóvel inteiro. Num serviço de
// glebas isso é o vizinho de OUTRA gleba: a carta de anuência dele saía com
// vértices que não são da divisa dele, e o vizinho certo perdia os seus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparTrechosPorConfrontante, cartasDe, montarTrechosPecas } from "../supabase/functions/_shared/pecas.ts";

const linha = (codigo) => ({
  codigo, lat: "-11°23'44,344\"", lon: "-39°04'47,198\"", alt: "300,00",
  azimute: "90°00'00\"", dist: "10,00", vante: "", confrontacao: "",
});

// duas glebas, cada uma com o seu vizinho; em nenhuma delas o 1º vértice inicia
// o trecho (o vizinho dá a volta pelo último)
const ringA = ["A-M-1", "A-M-2", "A-M-3"].map(linha);
const ringB = ["B-M-1", "B-M-2", "B-M-3"].map(linha);
const inicios = new Map([
  ["A-M-2", { descritivo: "ANA DE SOUZA\\ CPF:111.111.111-11", tipoLimite: "LA1" }],
  ["B-M-2", { descritivo: "BENTO DE LIMA\\ CPF:222.222.222-22", tipoLimite: "LA1" }],
]);

test("a abertura do anel é do vizinho daquele anel, não do último do mapa", () => {
  const a = montarTrechosPecas(ringA, inicios);
  const donoDe = (r, cod) => r.confrontacaoDe(cod);
  assert.match(donoDe(a, "A-M-1"), /ANA/, "A-M-1 fecha a divisa de ANA, que dá a volta no anel A");
  assert.match(donoDe(a, "A-M-2"), /ANA/);

  const b = montarTrechosPecas(ringB, inicios);
  assert.match(donoDe(b, "B-M-1"), /BENTO/, "B-M-1 é de BENTO — antes vinha de ANA ou do último do mapa");
});

test("com glebas, a carta de cada vizinho só leva os vértices da divisa dele", () => {
  // peças do IMÓVEL montadas como a função faz agora: soma dos trechos das
  // glebas, e não uma passada pela emenda dos dois anéis
  const trechos = [
    ...montarTrechosPecas(ringA, inicios).trechos,
    ...montarTrechosPecas(ringB, inicios).trechos,
  ];
  const cartas = cartasDe({ trechos });
  assert.equal(cartas.length, 2, "uma carta por confrontante-pessoa");

  const ana = cartas.find((c) => c.pessoa.nome.includes("ANA"));
  const bento = cartas.find((c) => c.pessoa.nome.includes("BENTO"));
  assert.deepEqual(ana.trecho.linhas.map((l) => l.codigo).sort(), ["A-M-1", "A-M-2", "A-M-3"]);
  assert.deepEqual(bento.trecho.linhas.map((l) => l.codigo).sort(), ["B-M-1", "B-M-2", "B-M-3"]);
  assert.equal(ana.pessoa.cpf, "111.111.111-11");
  assert.equal(bento.pessoa.cpf, "222.222.222-22");
});

test("percorrer a emenda das glebas é o que embaralhava as cartas", () => {
  // o caminho antigo: um único passe pelas linhas dos dois anéis emendados
  const emenda = montarTrechosPecas([...ringA, ...ringB], inicios);
  const deAna = agruparTrechosPorConfrontante(emenda.trechos.filter((t) => t.pessoas.length))
    .find((t) => t.pessoas.some((p) => p.nome.includes("ANA")));
  // B-M-1 não inicia trecho: emendado, ele caía na divisa de ANA
  assert.ok(
    deAna.linhas.some((l) => l.codigo === "B-M-1"),
    "se isto deixar de valer, a emenda parou de vazar — o teste acima é que garante o resultado certo",
  );
});
