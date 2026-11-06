---
{
  "titulo": "Tipos de vértice M, P e V no SIGEF: o que significa cada um e como codificar",
  "seoTitulo": "Tipos de vértice M, P e V no SIGEF: guia completo | Vertces",
  "descricao": "Vértice tipo M, P e V no SIGEF: definição do INCRA, código do credenciado, numeração, métodos aceitos para cada tipo e os erros que mais travam a planilha.",
  "slug": "tipos-de-vertice-m-p-v-sigef",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "guias-tecnicos",
  "palavraChave": "vértice tipo M P V sigef",
  "palavrasRelacionadas": ["vértice tipo m marco", "vértice tipo p ponto", "vértice tipo v virtual", "código do vértice sigef", "código do credenciado incra", "codificação de vértice georreferenciamento", "vértice tipo O"],
  "resumo": "No SIGEF, o vértice tipo M é medido diretamente e materializado por marco; o tipo P é medido diretamente sem marco; o tipo V é obtido de forma indireta, sem ocupar o ponto. O código de cada vértice junta os quatro caracteres do credenciado, a letra do tipo e um número sequencial que nunca se repete para o mesmo tipo e credenciado, como VRTX-M-0001.",
  "faq": [
    { "p": "Mourão de cerca pode ser vértice tipo M?", "r": "Não. O Manual Técnico do INCRA diz que mourões, estacas e palanques de cerca não são vértices tipo M e não devem receber plaqueta. Um canto de cerca medido diretamente é vértice tipo P." },
    { "p": "Posso reaproveitar o código de um marco que eu mesmo apaguei de um serviço?", "r": "A regra do INCRA é que não pode haver repetição de número em vértices do mesmo tipo e do mesmo credenciado. Se o código já foi usado em alguma certificação, ele não volta para a fila. Por isso o controle dos contadores M, P e V do credenciado tem de ser rigoroso." },
    { "p": "VRTX-M-1 e VRTX-M-0001 são o mesmo vértice?", "r": "Não. O Manual Técnico deixa claro que a quantidade de dígitos diferencia um vértice do outro: AAAA-M-1 não é igual a AAAA-M-0001. Escolha um padrão de dígitos e mantenha." },
    { "p": "Vértice levantado por drone pode ser tipo M?", "r": "Não. Posicionamento por sensoriamento remoto, incluindo aerofotogrametria com drone, só gera vértice tipo V e não se aplica a vértices tipo M, a limites por cerca nem a mudanças de confrontação." },
    { "p": "O que faço com um vértice tipo O de um vizinho certificado antigo?", "r": "Mantenha o código como está. O tipo O e a numeração de quatro dígitos com letras vêm de edições anteriores da Norma Técnica. Não se cria vértice novo com essa codificação, mas os existentes continuam valendo quando você confronta com o imóvel certificado ou desmembra essa parcela." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição (2022)", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "INCRA: Norma Técnica para Georreferenciamento de Imóveis Rurais, 3ª edição", "url": "https://sigef.incra.gov.br/static/documentos/norma_tecnica_georreferenciamento_imoveis_rurais_3ed.pdf" },
    { "titulo": "INCRA: Manual Técnico de Limites e Confrontações, 1ª edição (2013)", "url": "https://sigef.incra.gov.br/static/documentos/manual_tecnico_limites_confrontacoes_1ed.pdf" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

O vértice tipo M é o ponto medido diretamente e materializado por marco; o tipo P é medido diretamente, mas não tem marco; o tipo V é determinado de forma indireta, sem que um instrumento ocupe o ponto. Essa letra entra no código de cada vértice, junto com os quatro caracteres do credenciado e um número sequencial, e é o que o SIGEF usa para saber como aquele ponto foi obtido e como ele existe em campo.

Vértice de limite, na definição do INCRA, é o ponto onde a linha limítrofe do imóvel muda de direção ou onde ela cruza a linha limítrofe de um imóvel vizinho. Todo vértice do perímetro tem um tipo e um código, e os dois precisam bater com o método de posicionamento declarado na planilha.

## O que é cada tipo de vértice segundo o INCRA?

O tipo depende de duas perguntas: o ponto foi ocupado pelo instrumento (posicionamento direto) e existe um marco nele? A tabela resume o que está no item 2.4.2 do Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição.

| Código | Tipo | Posicionamento | Em campo | Situações típicas |
|---|---|---|---|---|
| M | Marco | Direto | Materializado por marco com plaqueta | Divisa sem elemento físico, linha ideal, ponto que o proprietário quer marcar |
| P | Ponto | Direto | Sem marco | Canto de cerca, vala, margem de curso d'água, divisa em lavoura onde o marco atrapalharia |
| V | Virtual | Indireto | Não ocupado | Ponto inacessível, ponto calculado por geometria analítica, sensoriamento remoto ou base cartográfica |

Três detalhes do Manual evitam boa parte das dúvidas:

- **Mourão não é marco.** Mourões, estacas e palanques de cerca não são vértices tipo M e não recebem plaqueta.
- **Marco em limite consolidado é opcional.** Onde a divisa já é definida por elemento físico (cerca, muro), implantar marco fica a critério do credenciado e dos proprietários, mediante anuência formal. Onde não há elemento físico, o marco é necessário, salvo quando ele seria um empecilho à atividade agropecuária.
- **Não se implanta marco onde já existe um.** A identificação e as coordenadas de um vértice devem ser únicas.

## Como é formado o código do vértice no SIGEF?

O código do vértice tem três partes: código do credenciado, letra do tipo e número sequencial. A regra está no item 3.3 da Norma Técnica, 3ª edição, e no item 1.3.3 do Manual Técnico.

1. **Quatro primeiros caracteres:** o código do credenciado responsável pelo posicionamento do vértice, recebido no ato do credenciamento no SIGEF.
2. **Quinto caractere:** o tipo do vértice (M, P ou V).
3. **Caracteres seguintes:** uma sequência de números inteiros, incrementada a cada vértice novo que o profissional define.

Na prática, o código aparece com hífens, como VRTX-M-0001, VRTX-P-0152 ou VRTX-V-0007 (exemplos fictícios). As regras que pegam muita gente:

- **Sem repetição.** Não pode haver repetição de número em vértices do mesmo tipo e do mesmo credenciado. Cada tipo tem o seu contador: o M-0001 e o P-0001 do mesmo credenciado são vértices diferentes e convivem sem problema.
- **Dígitos contam.** A quantidade de dígitos diferencia um vértice do outro. O Manual dá o exemplo: AAAA-M-1 não é igual a AAAA-M-0001.
- **Credenciados antigos têm três caracteres.** Quem se credenciou na época da 1ª e da 2ª edição da Norma Técnica, antes do SIGEF, recebeu código de três caracteres e continua com ele. Ao encontrar um marco desses em campo, confira letra por letra: o Manual alerta para a troca de "I" por "1" e de "O" por "0".

## Qual tipo de vértice cada método de posicionamento permite?

O método declarado na planilha limita o tipo de vértice. A Tabela 7 do Manual Técnico relaciona os 27 métodos aos tipos compatíveis:

| Código | Método | Tipos aceitos |
|---|---|---|
| PG1 | Relativo estático | M, P |
| PG2 | Relativo estático-rápido | M, P |
| PG3 | Relativo semicinemático | M, P |
| PG4 | Relativo cinemático | P |
| PG5 | Relativo a partir de códigos | P |
| PG6 | RTK convencional / RTPPP | M, P |
| PG7 | RTK em rede | M, P |
| PG8 | DGPS | P |
| PG9 | Posicionamento por Ponto Preciso | M, P |
| PT1 a PT5 | Poligonação, triangulação, trilateração, triangulateração, irradiação | M, P |
| PT6 | Interseção linear | M, P, V |
| PT7 | Interseção angular | M, P, V |
| PT8 | Alinhamento | M, P |
| PT9 | Estação livre | M, P |
| PA1 a PA3 | Paralela, interseção de retas, projeção técnica | V |
| PS1 a PS4 | Aerofotogrametria, radar, laser scanner aerotransportado, sensores orbitais | V |
| PB1 e PB2 | Base cartográfica com e sem precisão conhecida | V |

Leituras rápidas dessa tabela:

- **Cinemático, código e DGPS só geram P.** O receptor em movimento ou a observável de código não servem para marco.
- **Geometria analítica, sensoriamento remoto e base cartográfica só geram V.** Por definição, são posicionamentos indiretos.
- **Sensoriamento remoto tem mais uma trava.** O Manual proíbe esse método em vértices tipo M, em limites por cerca e em vértices de mudança de confrontação.

O tipo de vértice não decide sozinho a precisão exigida. Quem decide é o tipo de limite (artificial, natural ou inacessível). Os números estão no guia de [precisão posicional no georreferenciamento](/blog/precisao-posicional-georreferenciamento/).

## O que mudou nos tipos de vértice desde 2013?

A letra continua a mesma, mas o enquadramento de alguns casos mudou. Vale conhecer porque ainda circulam planilhas e modelos montados com as regras antigas.

- **Tipo O (edições anteriores).** Antes da 3ª edição, havia vértices tipo O, obtidos por paralelas, com numeração de quatro dígitos (0000 a 9999) e letras quando a numeração estourava (A001 a ZZZ9). Hoje não se cria vértice novo assim, mas o Manual manda manter essa codificação quando o imóvel confronta com parcelas certificadas naquela época e no desmembramento delas.
- **Divisa em lavoura passou de V para P.** No Manual Técnico de Limites e Confrontações de 2013, o vértice de limite sem elemento físico, em área agropecuária onde o marco seria um empecilho, era exemplo de tipo V. No Manual de 2022, essa mesma situação aparece como exemplo de tipo P, já que o ponto é ocupado pelo receptor.
- **Anuência formal para o marco.** O texto de 2022 acrescentou que, em limites consolidados, a implantação do marco depende de anuência formal dos envolvidos.

As demais diferenças entre as versões da norma estão no post sobre a [NTGIR 3ª edição e o que mudou](/blog/ntgir-3-edicao-o-que-mudou/).

## Como tratar vértices do vizinho já certificado?

Se a divisa é comum com parcela certificada e o seu levantamento concorda com ela, você adota as mesmas coordenadas e os mesmos códigos do vizinho. O Manual diz que, nesse caso, o credenciado assume a responsabilidade técnica por essas informações de forma solidária.

Se a divergência passar da tolerância (três vezes a precisão do tipo de limite), o caminho é o cancelamento da certificação do vizinho, e o Manual proíbe expressamente usar vértices novos para o mesmo limite. Com imóvel apenas georreferenciado, sem certificação, há mais liberdade: se o código encontrado em campo já consta de outra certificação ou há divergência, você pode usar nova monumentalização, codificação e coordenadas.

Uma consequência prática: a divisa com o vizinho certificado vai ter vértices com o código de outro credenciado. Isso é esperado. O que não pode é renumerar esses pontos com o seu prefixo. O passo a passo para não criar sobreposição está em [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).

## Quais erros de codificação mais travam a planilha?

Quase todos os problemas de código saem de controle manual de numeração. Os mais comuns:

1. **Número repetido** porque o contador ficou numa planilha de Excel desatualizada ou porque dois técnicos do escritório numeraram em paralelo.
2. **Tipo incompatível com o método**, como vértice M declarado com PG4 (cinemático) ou vértice P com PA1 (paralela).
3. **Prefixo do vizinho trocado** pelo do escritório em divisa com parcela certificada.
4. **Dígitos inconsistentes**, misturando VRTX-P-45 e VRTX-P-0045 no mesmo trabalho.
5. **Mourão com plaqueta** lançado como M.
6. **Marco de três caracteres digitado errado**, com "O" no lugar de "0".

Antes de montar a [planilha ODS do SIGEF](/blog/planilha-ods-sigef-como-preencher/), confira esses seis pontos vértice a vértice.

## Onde um sistema ajuda na codificação?

O ganho está em tirar a numeração da cabeça e da planilha solta. No Vertces, cada credenciado é cadastrado com o seu prefixo e com os contadores atuais de M, P e V, e os códigos oficiais saem desses contadores quando o serviço completo gera os documentos. A conferência de área, usada para orçamento e ensaio, não consome a numeração oficial. Também dá para renomear vértices em lote e inserir um ponto num lado sem refazer o perímetro, e os vértices certificados do vizinho entram na sua divisa com o código original.

O cuidado do primeiro uso continua sendo seu: confira os contadores com o último código usado no SIGEF antes do primeiro serviço. Se quiser ver esse fluxo com os seus dados, [fale com a gente](/#contato).
