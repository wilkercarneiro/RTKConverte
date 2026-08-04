# Arquitetura: confrontação ancorada no vértice M

## O defeito que motivou a mudança

Planta FAZENDA LAGOA SECA (serviço `74238a85`): a ESTRADA VICINAL foi desenhada de
`DSBN-P-13806` a `DSBN-P-13810` em vez de `DSBN-M-3704` a `DSBN-M-3705`, pintando linha
dupla vermelha em dois trechos sem estrada.

Causa: `trechos_confrontantes.vertice_inicio_ordem` é um **inteiro posicional** dentro de
uma lista mutável de vértices. As seis âncoras estavam uniformemente 2 posições antes do M
correto:

| âncora gravada | vértice que pegou | M correto |
| --- | --- | --- |
| 0 | P-13806 | M-3704 |
| 7 | P-13810 | M-3705 |
| 12 | P-13814 | M-3706 |
| 15 | P-13816 | M-3707 |
| 16 | P-13817 | M-3708 |
| 18 | M-3708 | M-3709 |

Três fatores se somam:

1. O salvamento em `Conferencia.tsx` faz `delete` + `insert` da tabela inteira de vértices,
   descartando os `id` a cada gravação — não existe identidade estável para ancorar.
2. Qualquer renumeração de `ordem` (reimportação, escrita direta) desloca todas as âncoras
   silenciosamente. Os dois `DSBN-V` nas ordens 3 e 4 estão com `inserido_manual = false`,
   valor que a inserção pela tela nunca produz.
3. Nada valida o resultado. `montarServico` só rejeita âncora para ordem **inexistente**
   (`servico.ts:101`); âncora que caiu num P passa batido até virar PDF.

Levantamento no banco em 28/07/2026: dos 195 trechos `geo`, 178 estavam corretos, 14
ancorados fora de M e 3 órfãos — todos os 17 defeituosos no FAZENDA MONOINO.

## A invariante

> **Um vértice M é o início de uma confrontação. O trecho vai daquele M até o próximo M.**

Isso já era a intenção do sistema: `parse-txt` importa com
`tipo: iniciosTrecho.has(i) ? "M" : "P"` e cria um trecho por M. O que faltava era
**garantir** em vez de apenas pretender.

Consequência de modelagem: o trecho deixa de ser uma entidade que *aponta* para um vértice
e passa a ser um atributo *do próprio vértice M*. Não há índice para errar, não há join
para desencontrar, e o número de confrontantes é sempre igual ao número de M.

## Modelo

### Fluxo `geo` — confrontação fundida no vértice

```sql
alter table vertices
  add column descritivo  text,
  add column tipo_limite text,
  add column eh_via      boolean not null default false,
  add column cns         text,
  add column matricula   text,
  add column apelido_txt text;
```

Preenchidas apenas quando `tipo = 'M'`. O trecho de um M vai até o próximo M no anel,
derivado em tempo de cálculo — nunca armazenado.

### Fluxo `pecas` — permanece como está

Os 6 trechos `pecas` do banco têm todos `codigo_inicio` preenchido e **nenhum** vínculo com
a tabela `vertices` (o perímetro vem do PDF do SIGEF em tempo de geração, não do banco).
Esse fluxo já ancora por código do SIGEF, que é estável por construção. `trechos_confrontantes`
continua existindo para ele, ganhando apenas a coluna `eh_via`.

Dois fluxos, duas fontes de verdade — mas cada uma correta no seu domínio. Tentar unificar
forçaria o `pecas` a materializar vértices que ele não tem.

## A planta gerada com o PDF do SIGEF

O `gerar-planta` tem dois caminhos, e o segundo custou três rodadas de defeito porque
ninguém tinha reparado que ele **não passa pelos vértices**:

- sem PDF (fluxo `geo` puro): monta o serviço pelo `montarServico`, que deriva os trechos
  dos vértices M. Sempre esteve certo.
- com PDF (`servico.tipo === 'pecas'` **ou** qualquer serviço em que se envia o PDF):
  reconcilia os vértices com a prévia do SIGEF e montava os trechos lendo
  `trechos_confrontantes` — tabela que ficou vazia para serviços `geo` quando a
  confrontação passou para o vértice. Sem linhas ali, caía no texto do PDF, que não
  distingue faixa de domínio, e nada saía marcado como estrada.

Sintoma característico: **a tela mostra a estrada e o PDF não.** São fontes diferentes.

Dois agravantes no mesmo caminho, ambos corrigidos:

1. `reconciliarVerticesBancoComSigef` devolvia linhas sem as colunas de confrontação, e o
   `gerar-planta` apaga e reinsere a tabela de vértices com esse resultado — ou seja, gerar
   a planta **apagava a marcação** antes de desenhar.
2. O `tipo` era reescrito a partir da letra do código do SIGEF. Um vértice com confrontação
   cujo código dissesse `-P-` virava P e o trecho sumia do desenho — não só a cor.

A escolha da origem dos trechos virou `montarTrechosDoSigef`, com precedência explícita
(trechos por `codigo_inicio` → confrontação nos vértices M → texto do SIGEF) e testes em
`tests/reconciliacao_confrontacao.test.mjs`. Estava solta dentro da edge function, onde
nenhum teste alcançava.

**Regra que fica:** ao mudar onde a confrontação mora, varra TODOS os caminhos que a leem.
Foram três: o desenho, a reconciliação e a montagem dos trechos a partir do PDF.

## Sentido horário e o deslocamento da confrontação

O SIGEF exige o perímetro descrito **no sentido horário**, começando pelo vértice mais ao
norte. O início já era normalizado (`ordemMaisAoNorte`); o sentido não era — saía o do TXT
do levantamento, que vem dos dois jeitos. `montarServico` agora normaliza os dois, antes de
alocar códigos, para que a numeração acompanhe a sequência publicada.

Inverter o anel **não é só dar `reverse()`**, e é aqui que a invariante deste documento
morde. Se o trecho de um M vai até o próximo M, então ao andar o perímetro ao contrário o
mesmo pedaço de divisa passa a ser percorrido a partir do outro extremo: o que ia de `M_a`
a `M_b` agora vai de `M_b` a `M_a`. Sem deslocar, `M_b` continuaria abrindo o trecho dele e
cada confrontante sairia descrito na divisa do vizinho — exatamente o defeito da LAGOA SECA,
por outro caminho.

Regra: na sequência invertida, cada M assume a confrontação do M **seguinte**, dando a volta
no anel (`inverterSentido`, em `servico.ts`). Quais vértices são M não muda — os cantos onde
o confrontante troca são os mesmos pontos, ande-se para um lado ou para o outro; muda só
quem abre cada trecho.

Consequência importante para a tela: **a divisa física coberta por cada confrontante é
preservada**. O preview desenha na ordem gravada, a planta sai na ordem horária, e a linha
dupla vermelha cai nos mesmos segmentos nas duas — não reabre o sintoma "a tela mostra a
estrada e o PDF não".

Os testes em `tests/sentido_horario.test.mjs` não conferem a aritmética do deslocamento, que
seria circular: comparam a cobertura **declarada na entrada** (cada M até o próximo M, na
ordem digitada) com a **cobertura efetiva na saída**, divisa a divisa. Há também uma guarda
contra teste que passaria à toa — as duas entradas têm de produzir confrontação diferente,
senão a inversão não está deslocando nada. `LARISSA.txt` já é horário, então o arquivo
histórico passa intacto; é o que trava a convenção de sinal (`areaAssinadaM2 < 0` = horário)
contra uma inversão acidental.

## O marco de divisão: um por M, sem exceção

Planta FAZENDA LAGOA SECA (serviço `5da4d729`, v17): dos três vértices M só o
`DSBN-M-4501` saiu com traço verde. Os outros dois — `DSBN-M-4500` (LINHA FERREA) e
`DSBN-M-4502` (ESTRADA VICINAL) — são faixa de domínio, e o traço era desenhado
**dentro do laço de rótulos**, que faz `continue` nos trechos de via logo depois de
escrever o nome da estrada. Com um marco só, a planta não dizia onde a divisa de cada
confrontante começa e termina, e o leitor concluía que o vizinho tinha sido
identificado no ponto errado.

Dois agravantes no mesmo lugar: aquele laço também **funde** trechos vizinhos de mesmo
descritivo (o agrupamento que existe para não repetir o bloco de texto 5× em volta do
polígono), o que apagava o marco do M interno da fusão.

> **Todo M é a troca de um confrontante para o outro, então todo M ganha o seu traço
> verde** — via ou não, agrupado ou não.

O desenho saiu para um laço próprio sobre `d.trechos` cru, antes do agrupamento. O
diagnóstico `DiagPlanta` ganhou `marcos`, para o teste conferir a contagem sem abrir o
PDF.

### O que NÃO era o defeito

Vale registrar, porque a primeira leitura apontou para o lado errado: os códigos dos
vértices ficam **fora de sequência** em relação à `ordem` gravada depois que a planta é
gerada com o PDF do SIGEF (na LAGOA SECA a `ordem` corre `P-14000, P-14028, P-14027,
M-4502, …`). Isso é só consequência de `reconciliarVerticesBancoComSigef` renumerar
`ordem` pela sequência do PDF preservando os códigos alocados numa geração anterior —
não indica confrontação deslocada. O anel gravado é horário, `montarServico` não
inverte nada nesse serviço, e memorial e planta cobrem exatamente as mesmas divisas.

`tests/lagoa_seca_marcos.test.mjs` trava as duas coisas: a contagem de marcos e a
igualdade **divisa a divisa** entre `montarServico` (memorial/planilha) e
`montarTrechosDoSigef` + `gerar-planta` (planta oficial). Roda nos dois sentidos — o
anel real e o mesmo imóvel invertido *com a confrontação deslocada um M*, que é o único
jeito de descrever a mesma realidade ao contrário. São dois caminhos independentes lendo
a mesma confrontação; a comparação existe para que não voltem a divergir em silêncio.

## Que lado é "fora": o sentido do anel, nunca o centro da folha

A linha dupla vermelha é **da poligonal para fora**. Quem decide o lado era isto:

```ts
// normal apontando p/ FORA (lado oposto ao centroide)
if (dist(meio + n, dcx, dcy) < dist(meio - n, dcx, dcy)) n = -n;
```

`dcx, dcy` é o centro da **área de desenho** — nem o centroide do imóvel. Em polígono
convexo dá no mesmo; em côncavo, não. Na LAGOA SECA, que tem um braço estreito a
noroeste, o centro da folha cai **fora** do braço, e a linha era jogada para dentro da
poligonal em **12 das arestas** da LINHA FERREA (todo o trecho `M-4500 → P-14008`, mais
`P-14004 → P-14001`).

A regra correta não depende de posição nenhuma, só do **sentido do anel**: em coordenadas
de tela (Y para cima), área assinada > 0 = anti-horário, e a normal externa da aresta
`a→b` é `(dy, -dx)/len`. O sinal é calculado uma vez e vale para todas as arestas,
côncavas inclusive.

Duas funções, `normalAresta(i)` e `normalVertice(i)` (bissetriz das duas arestas que
tocam o vértice), substituíram o critério do centro em **tudo que é "para fora"**: linha
dupla de estrada, tique e código do vértice, traço verde do marco e a âncora do bloco do
confrontante — este último ia parar por cima da área do imóvel pelo mesmo motivo.

`tests/lagoa_seca_marcos.test.mjs` confere ponto a ponto que nenhuma linha de estrada cai
dentro do anel, usando `diag.vias` e `diag.poligono`.

## O lugar do nome do vizinho é regra, não resultado de busca

> **O nome fica no meio do trecho do vizinho, para fora, a uma distância proporcional ao
> desenho, com a largura do bloco proporcional ao comprimento daquela divisa.**

Quem se ajusta para caber é o **texto** (quebra de linha e corpo, contínuo de 100% a 70%)
e, se ainda faltar espaço, os **códigos dos vértices**, que passaram a ser desenhados
depois dos rótulos e cedem lugar. Antes era o contrário: os códigos entravam primeiro na
lista de ocupados e o bloco do vizinho tinha de se virar em volta deles.

As medidas são proporcionais de propósito — `0,052 × diagonal do polígono` para o
afastamento, `0,8 × comprimento da divisa` para a largura do bloco. Em pontos fixos, a
mesma regra dava resultados diferentes num imóvel de 6 ha e num de 600, e cada nome de
uma planta parava a uma distância diferente. É o que estava por trás do "desorganizado".

O que existia antes era uma busca em que o **rótulo fugia** do obstáculo: afastava-se até
208 pt e deslizava até 1,05 × a própria largura ao longo da divisa. Duas consequências,
as duas relatadas: nomes boiando a distâncias desiguais, e o nome do trecho apertado
parando fora do vão do vizinho.

**Deslizar deixou de existir.** Não é questão de estética: um nome fora do meio do trecho
aponta para a divisa errada, que é o que o resto deste documento existe para evitar.
Afastar mais, sim — o nome continua no meio da divisa dele, só sai mais para fora do
desenho. `tests/lagoa_seca_marcos.test.mjs` cobra o desvio **lateral** de cada rótulo com
tolerância de meio corpo; o deslize que ele tem de pegar era de 125 pt.

Sem nenhuma posição livre, o recurso é `menosPior` — a que cruza menos coisa. Antes era
"a última da lista", que é o extremo da busca e não tinha razão para ser a melhor.

### A lista de obstáculos é a definição de "não invadir"

O rótulo desvia do que estiver na lista `obstaculos`, e só disso. Ela nasceu com a
poligonal e a linha dupla das vias; faltavam **o tique de cada vértice** e **o traço verde
de cada marco** — este com 50 pt, saindo exatamente do vão onde o nome cai. Entraram os
dois.

Um caso à parte, porque não é linha: a **legenda** é desenhada no fim, com fundo branco
opaco, no canto inferior esquerdo da área de desenho — ou seja, apagava o rótulo que
tivesse caído ali. O comentário antigo dizia isso com todas as letras ("cobre a malha e os
rótulos que passam atrás"). O espaço dela agora é reservado em `legendaRet` **antes** de
posicionar rótulo nenhum, e o desenho no fim usa o mesmo retângulo, para os dois não
divergirem. A bússola já escolhia canto livre sozinha.

Regra que fica: **desenhou traço ou caixa opaca na área de desenho, registra**. O teste
confere a contagem e exige cada marco na lista, mas quem acrescentar um elemento novo tem
de acrescentar a asserção junto — nenhum teste adivinha o que ainda não existe.

### Colisão do texto girado

O nome da via é rotacionado ao longo da divisa, e a colisão dele era medida pela **caixa
envolvente**. Numa diagonal de ~50° essa caixa é quase um quadrado que a própria linha
atravessa por dentro — falso positivo garantido. Enquanto o rótulo fugia, isso só o
empurrava para longe; depois que a posição virou regra e o corpo passou a ser quem cede,
o mesmo falso positivo encolheu o nome da estrada até o piso (12,8 pt onde cabiam 22).

`segCruzaObb` leva o segmento para o referencial do texto e testa contra o retângulo de
verdade. O diagnóstico usa o mesmo critério — medir com a envolvente contava como
sobreposto um rótulo que não estava.

## Fim das heurísticas de texto

`eh_via` explícito (checkbox "faixa de domínio pública") substitui as duas inferências
frágeis que marcavam estrada onde não havia:

- `gerar-planta/index.ts:76-77` — `!descritivo.includes("\\")`, que transformava em estrada
  todo confrontante digitado sem CPF (foi o que marcou MANOEL MOTA e ADELSON BONIFACIO).
- `PecasServico.tsx:107` — `/\\/.test(...) ? "LA1" : "LA3"`, que gravava LA3 no banco e
  congelava o erro mesmo depois de corrigir o descritivo.

`tipo_limite` continua existindo como campo de domínio SIGEF, mas deixa de decidir traçado.

## Validação antes de gerar

Com mensagem citando o **código** do vértice, nunca a `ordem`.

**Bloqueia** apenas corrupção estrutural: dado de confrontação preso a um vértice que não é
M. Pela tela isso é impossível; sobra como defesa contra dados legados e escrita direta no
banco.

**Avisa** (não bloqueia): M sem descritivo nem apelido; descritivo sem CPF quando `eh_via`
é falso — o caso que costuma ser estrada não marcada.

Descritivo vazio deliberadamente **não** é erro. O levantamento no banco em 28/07/2026
mostrou 90 vértices M usando só o apelido e 25 sem nenhum dos dois, em 4 serviços: o
memorial cai no apelido e, sem os dois, segue sem a cláusula de confrontação — comportamento
suportado desde sempre. Bloquear seria uma regressão disfarçada de rigor.

## Tela

Cada confrontação é editada no seu vértice M, identificado por código (`DSBN-M-3704`, não
`ordem 2`), com checkbox "faixa de domínio pública". Adicionar uma transição converte P→M;
remover reverte M→P e limpa os dados — marcar o M e criar o trecho são o mesmo ato, então
os dois nunca divergem.

O campo "Inicia no ponto" **move** a confrontação: escolher outro vértice leva descritivo,
apelido, tipo de limite, faixa de domínio, CNS e matrícula junto, converte o destino em M e
devolve a origem ao tipo que ela tinha antes — V se foi inserida à mão, P caso contrário.
Existe porque o M vem do rótulo do TXT e erra com frequência; sem mover, corrigir o ponto
significava remover o trecho e redigitar tudo. A regra é `moverConfrontacao` em
`src/lib/trechos.ts`, testada em `tests/trechos.test.mjs`; destino que já é M é recusado na
tela, para não sobrescrever a confrontação do vizinho.

O preview SVG desenha a **linha dupla vermelha por fora do polígono** exatamente onde a
planta desenharia, com a mesma construção de `planta.ts` (normal apontando para o lado
oposto ao centroide). Se a linha vermelha aparecer onde não há estrada, o erro está na tela
antes de virar PDF — que é o ponto.

A regra "a que trecho pertence cada segmento" vive em `src/lib/trechos.ts`, isolada e
testada em `tests/trechos.test.mjs` contra o anel real da LAGOA SECA: a estrada tem de
começar no M-3704 e terminar no M-3705, e os segmentos P-13806→P-13807→M-3704 têm de ficar
de fora. São os dois defeitos relatados, agora travados por teste.

## Migração

`0002_confrontacao_no_vertice.sql`:

1. adiciona as colunas;
2. copia cada trecho `geo` para o vértice da sua âncora e força `tipo = 'M'` ali
   — preserva o comportamento atual, inclusive onde estava errado;
3. relatório dos vértices M sem descritivo e dos trechos órfãos, para conferência manual;
4. **não** apaga `trechos_confrontantes` — o fluxo `pecas` depende dela.

Correção pontual já aplicada em 28/07/2026 no serviço `74238a85` (LAGOA SECA):
`vertice_inicio_ordem + 2` nas seis âncoras, alinhando cada trecho ao seu M.
Os cinco serviços FAZENDA MONOINO seguem com âncoras inválidas e precisam de conferência
manual — o confrontante de cada trecho tem de ser reatribuído ao M correto, o que só quem
conhece o levantamento pode decidir.
