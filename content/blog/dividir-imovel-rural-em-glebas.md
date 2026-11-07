---
{
  "titulo": "Como dividir imóvel rural em glebas no georreferenciamento",
  "seoTitulo": "Dividir imóvel rural em glebas no georreferenciamento | Vertces",
  "descricao": "Dividir imóvel rural em glebas: quando o imóvel tem várias partes (estrada, rio, matrículas), o confrontante interno e os documentos de cada gleba.",
  "slug": "dividir-imovel-rural-em-glebas",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "dividir imóvel rural em glebas",
  "palavrasRelacionadas": ["o que é gleba imóvel rural", "imóvel cortado por estrada georreferenciamento", "confrontante interno gleba", "georreferenciamento com várias glebas", "planta com glebas sigef", "gleba x desmembramento"],
  "resumo": "Dividir imóvel rural em glebas é separar o perímetro em partes contínuas, cada uma com contorno, área e documentos próprios, quando o imóvel é cortado por estrada ou rio, reúne matrículas diferentes ou tem partes com destinos distintos. No Vertces, o serviço com glebas divide o imóvel na tela, preenche o confrontante da divisa interna e gera a planta A1 com todas as glebas, a A3 de cada uma e uma aba da planilha SIGEF por gleba.",
  "faq": [
    { "p": "Dividir em glebas muda a matrícula do imóvel?", "r": "Não por si só. A divisão em glebas organiza o levantamento e os documentos. Abrir matrículas novas, unir ou desmembrar depende de ato no cartório, com os requisitos de cada caso." },
    { "p": "Uma estrada municipal que corta a fazenda obriga a separar em glebas?", "r": "Na prática, quase sempre. A faixa da estrada não pertence ao imóvel, então os dois lados ficam como contornos separados, cada um confrontando com a estrada." },
    { "p": "O vértice da divisa interna conta para as duas glebas?", "r": "Conta. O vértice que fica na divisa entre duas glebas pertence às duas, e o lado comum aparece na descrição de cada uma, confrontando com a gleba vizinha." },
    { "p": "Posso trocar o texto automático do confrontante interno?", "r": "Pode. Na tabela das glebas, o campo Confrontante da divisa interna aceita o texto que você quiser. Em branco, sai o automático com matrícula, imóvel, gleba vizinha, proprietário e CPF." },
    { "p": "Um ponto do levantamento que ficou fora das glebas vai para os documentos?", "r": "Não. O ponto que não entra em nenhuma gleba fica fora dos documentos, e o sistema avisa quais são, pelo número do TXT, para você incluir ou descartar." }
  ],
  "fontes": [
    { "titulo": "INCRA: Certificação de imóveis rurais", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" },
    { "titulo": "Decreto nº 4.449/2002, arts. 9º e 10 (identificação e desmembramento)", "url": "https://www.planalto.gov.br/ccivil_03/decreto/2002/d4449.htm" },
    { "titulo": "Lei nº 5.868/1972, art. 8º (fração mínima de parcelamento)", "url": "https://www.planalto.gov.br/ccivil_03/leis/l5868.htm" }
  ]
}
---

Para dividir imóvel rural em glebas, você separa o perímetro em partes contínuas, cada uma com contorno, área e documentos próprios, e descreve a divisa entre elas como confrontação interna. Isso é necessário quando o imóvel é cortado por estrada ou rio, quando reúne matrículas diferentes ou quando partes dele têm destinos distintos. A divisão em glebas não cria imóvel novo: ela organiza o mesmo imóvel em partes mensuráveis.

Gleba é uma porção contínua de terra, com perímetro fechado, dentro de um imóvel ou de um conjunto de imóveis do mesmo dono. No georreferenciamento, cada gleba tem vértices, lados, confrontantes e área; o imóvel é a soma delas.

## Quando um imóvel rural tem mais de uma gleba?

Um imóvel tem mais de uma gleba sempre que o terreno não forma um polígono único ou quando partes dele precisam ser descritas separadamente. Os casos mais comuns:

1. **Estrada que corta o imóvel.** A faixa da estrada não é do proprietário. Sobram dois ou mais contornos, cada um confrontando com a via. Para as larguras de faixa, veja [faixa de domínio de rodovia e recuo](/blog/faixa-de-dominio-rodovia-recuo/).
2. **Rio ou córrego como divisa interna.** Quando o curso d'água separa duas partes, cada lado tem seu contorno.
3. **Matrículas diferentes.** O proprietário tem duas ou três matrículas encostadas e quer cada uma descrita com sua área.
4. **Matrícula e posse.** Parte do terreno tem título e parte é posse; as duas não se misturam na descrição.
5. **Partes com destino diferente.** Uma área vai ser arrendada, outra vendida, outra reservada. A divisão prepara o passo seguinte.

Em todos esses casos, o levantamento é um só, mas o resultado precisa mostrar cada parte com a área dela e o imóvel inteiro com a área total.

## Gleba, desmembramento e divisão entre herdeiros são a mesma coisa?

Não. Os três separam terra, mas com efeitos diferentes. A tabela resume:

| | Glebas | Desmembramento | Divisão entre herdeiros |
|---|---|---|---|
| Objetivo | Descrever as partes de um imóvel | Tirar uma área do imóvel para outro dono | Repartir o imóvel entre herdeiros ou condôminos |
| Dono depois | O mesmo | Sai uma área para o adquirente; fica a remanescente | Cada parte no nome de quem recebe |
| Divisas | Em geral já existem (estrada, rio, cerca, matrícula) | Desenhadas para a área desmembrada | Desenhadas para partes de área definida |
| Limite legal | Não cria imóvel novo | Fração mínima de parcelamento | Fração mínima de parcelamento |

O desmembramento e a partilha criam imóveis novos e esbarram na fração mínima de parcelamento do art. 8º da Lei 5.868/72, que impede desmembrar ou dividir abaixo do módulo ou da FMP do município. Também exigem o georreferenciamento, conforme o art. 10 do Decreto 4.449/2002. Os detalhes estão em [desmembramento de imóvel rural](/blog/desmembramento-imovel-rural/) e em [divisão de terra entre herdeiros](/blog/divisao-de-terra-entre-herdeiros/).

## O que é o confrontante interno?

Confrontante interno é a descrição do lado que fecha uma gleba por dentro do imóvel, onde o vizinho é a outra gleba. No memorial, o lado que acompanha o perímetro externo confronta com o vizinho de fora, como sempre. O lado da divisa interna confronta com a gleba ao lado.

Um exemplo. A Fazenda Santa Luzia é cortada por uma estrada vicinal e por um córrego, e fica com três glebas. Na Gleba 1, os lados de fora confrontam com os vizinhos e com a estrada. O lado que segue o córrego confronta com a Gleba 2, descrita com a matrícula, o nome do imóvel, a gleba vizinha, o proprietário e o CPF. Na Gleba 2, o mesmo lado aparece no sentido inverso, confrontando com a Gleba 1.

O vértice que fica nessa divisa pertence às duas glebas. Ele tem um código só e aparece nas duas descrições. Para saber que tipo de vértice usar em divisa nova, veja [vértices M, P e V no SIGEF](/blog/tipos-de-vertice-m-p-v-sigef/).

## Que documentos saem de um imóvel com glebas?

Saem os documentos do imóvel inteiro e os de cada gleba. O conjunto típico:

- **Planta geral em A1**, com todas as glebas, a área de cada uma e a área total do imóvel.
- **Planta em A3 de cada gleba**, com o contorno, os confrontantes e a imagem de satélite daquela gleba.
- **Planilha SIGEF (ODS)** com uma aba de perímetro para cada gleba.
- **Peças técnicas**, depois do SIGEF, em dois jogos: o do imóvel, com um bloco por gleba no memorial descritivo, e o de cada gleba, com área e perímetro dela.

A área total é a soma das glebas. O perímetro não se soma: cada gleba tem o seu, e a planta lista um por um. Sobre o conteúdo de cada peça, veja [documentos do georreferenciamento para o cartório](/blog/pecas-tecnicas-georreferenciamento-cartorio/).

## Como fazer no Vertces

O serviço com glebas é o serviço completo com uma etapa a mais, chamada Glebas, entre Dados e Confrontantes e vértices. A divisão vem antes de confrontar porque os confrontantes dependem de qual gleba é de quem.

1. **Em Início, escolha Serviço com gleba** e envie o TXT do levantamento. Se o arquivo traz cada parte numerada em bloco próprio (por exemplo, 1 a 75, 100 a 123 e 200 a 228), o sistema já cria as partes separadas.
2. **Preencha os Dados** do imóvel e do detentor.
3. **Na etapa Glebas, escolha o caminho:**
   - **Pontos e ligações**, quando a divisa já foi levantada. Clique num ponto, use Ligar a outro ponto (L) e clique no ponto do outro lado do imóvel: essa linha é a divisa entre duas glebas. As áreas fechadas pelas ligações viram as glebas.
   - **Dividir na prancheta**, quando a divisa ainda não existe. Escolha em quantas glebas e a direção das divisas; o motor corta o contorno e você ajusta arrastando quinas e divisas, cortando, unindo ou dividindo. Os pontos novos das divisas viram marcos M do perímetro.
4. **Confira a tabela das glebas:** nome (PARTE 1, PARTE 2… ou o que você digitar), área em hectares, número de pontos e Confrontante da divisa interna. Em branco, o confrontante sai automático com a gleba vizinha.
5. **Clique em Salvar glebas.** O sistema não deixa salvar se houver ligações que se cruzam e avisa os pontos que ficaram sem gleba.
6. **Confira os confrontantes e vértices** de cada gleba e **gere os documentos.**

A partir daí, mapa, prévia e planta saem pelos contornos das glebas, e não pela sequência bruta do TXT. Isso importa no levantamento feito gleba por gleba, em que a sequência do arquivo cruza o imóvel de um lado ao outro.

## O que conferir antes de gerar?

Confira se as glebas cobrem o imóvel inteiro e se as áreas fecham. Três verificações rápidas:

- **Soma das áreas.** A soma das glebas deve bater com a área do perímetro externo. Diferença indica ponto solto ou ligação errada.
- **Pontos fora de gleba.** O aviso lista pelo número do TXT os pontos que não entraram em nenhuma gleba. Eles ficam fora dos documentos.
- **Confrontantes internos.** Leia o texto de cada divisa interna como vai sair no memorial. Matrícula e CNS errados aqui viram exigência no cartório.

O Vertces calcula, desenha e avisa, mas quem assina é o responsável técnico, quem certifica é o INCRA e quem registra é o cartório. Se o imóvel tiver área já certificada em volta, a divisa do vizinho pode entrar pelos vértices certificados, como em [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).
