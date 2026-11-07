---
{
  "titulo": "RTK, PPP ou estático no georreferenciamento: qual método usar",
  "seoTitulo": "RTK, PPP ou estático no georreferenciamento | Vertces",
  "descricao": "RTK ou PPP no georreferenciamento: os métodos PG1 a PG9 do Manual Técnico do INCRA, quando usar cada um, base por estático ou PPP e precisão de 0,50 m.",
  "slug": "rtk-ppp-ou-estatico-georreferenciamento",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "guias-tecnicos",
  "palavraChave": "rtk ou ppp georreferenciamento",
  "palavrasRelacionadas": ["método de posicionamento georreferenciamento", "rtk georreferenciamento incra", "ibge-ppp georreferenciamento", "relativo estático georreferenciamento", "pg6 rtk sigef", "base rtk georreferenciamento"],
  "resumo": "No georreferenciamento, PPP, relativo estático e RTK não competem: cada um tem um papel. O Manual Técnico do INCRA (2ª edição) aceita os métodos GNSS PG1 a PG9, e o fluxo mais usado é determinar a base (vértice de apoio) por relativo estático ou PPP e levantar os vértices de limite por RTK com solução fixa. Em limite artificial, a precisão exigida é de 0,50 m ou melhor.",
  "faq": [
    { "p": "O IBGE-PPP é aceito pelo INCRA?", "r": "Sim. O PPP é o método PG9 do Manual Técnico, aceito para vértices de apoio e de limite, e a página do IBGE-PPP informa que os relatórios são aceitos pelo INCRA na certificação de imóveis rurais." },
    { "p": "Posso usar RTK com a base em coordenada de navegação?", "r": "Não é o caminho. A precisão posicional é absoluta, vinculada ao Sistema Geodésico Brasileiro. Se a base não tiver coordenada determinada por método aceito, o erro dela passa para todos os pontos do RTK." },
    { "p": "RTK com solução flutuante serve para cerca?", "r": "Não. O Manual Técnico condiciona o uso do RTK convencional em limites artificiais à solução fixa das ambiguidades." },
    { "p": "GNSS de navegação ou DGPS serve para georreferenciamento?", "r": "DGPS (PG8) usa código e, pelo manual, fica restrito a vértices em limites naturais. GNSS de navegação sem correção não aparece entre os métodos aceitos." },
    { "p": "Quanto tempo devo rastrear a base no relativo estático?", "r": "Depende da linha de base. A Tabela 4 do Manual Técnico recomenda, por exemplo, 20 minutos para linha de base de até 10 km e 120 minutos entre 20 e 100 km com L1/L2." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição (Portaria 2.502/2022)", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "IBGE: Serviço online para pós-processamento de dados GNSS (IBGE-PPP)", "url": "https://www.ibge.gov.br/geociencias/informacoes-sobre-posicionamento-geodesico/servicos-para-posicionamento-geodesico/16334-servico-online-para-pos-processamento-de-dados-gnss-ibge-ppp.html" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

No georreferenciamento de imóvel rural, RTK, PPP e relativo estático não são concorrentes: cada um resolve uma parte do trabalho. O Manual Técnico do INCRA (2ª edição, que detalha os procedimentos da NTGIR 3ª edição) aceita os métodos GNSS de PG1 a PG9, e o fluxo mais usado é determinar a base por relativo estático ou PPP e levantar os vértices de limite por RTK com solução fixa. O que manda na escolha é a precisão exigida para cada tipo de limite, como 0,50 m ou melhor em limite artificial.

## O que é método de posicionamento no georreferenciamento?

Método de posicionamento é a forma como as coordenadas de um vértice são obtidas: com que equipamento, que observável, quanto tempo e em relação a quê. O Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição (Portaria INCRA 2.502/2022), dá um código a cada método, e esse código vai para a planilha ODS de cada vértice.

Os métodos GNSS aceitos são estes:

| Código | Método | Como funciona |
|---|---|---|
| PG1 | Relativo estático | Base e receptor parados por longo período, pós-processado |
| PG2 | Relativo estático-rápido | Igual ao estático, com sessão em geral inferior a 20 minutos |
| PG3 | Relativo semicinemático (stop and go) | Ocupação curta, coletando também no deslocamento |
| PG4 | Relativo cinemático | Receptor em movimento, uma coordenada por época |
| PG5 | Relativo a partir de códigos | Pseudodistância pós-processada |
| PG6 | RTK convencional / RTPPP | Correção em tempo real por rádio, ou PPP em tempo real |
| PG7 | RTK em rede | Correções de várias estações pela internet (NTRIP) |
| PG8 | DGPS | Correção em tempo real usando código |
| PG9 | Posicionamento por Ponto Preciso (PPP) | Coordenada absoluta com efemérides precisas, sem base própria |

Além dos GNSS, o manual tem métodos de topografia clássica (PT), geometria analítica (PA), sensoriamento remoto (PS) e base cartográfica (PB).

## Qual precisão cada tipo de limite exige?

A precisão define quais métodos servem. O item 1.4.4 do Manual Técnico fixa:

- **limites artificiais** (cerca, muro, estrada): melhor ou igual a 0,50 m;
- **limites naturais** (rio, córrego, crista): melhor ou igual a 3,00 m;
- **limites inacessíveis**: melhor ou igual a 7,50 m.

A precisão é a resultante planimétrica dos desvios padrão da latitude e da longitude, sem a altitude. E é **absoluta**: considera a propagação a partir dos vértices do Sistema Geodésico Brasileiro. Por isso a qualidade da base pesa em todos os pontos. Detalhes em [precisão posicional no georreferenciamento](/blog/precisao-posicional-georreferenciamento/).

## Quais métodos servem para limite artificial e quais só para natural?

Em limite artificial, só entram métodos com a fase da onda portadora. O manual é direto: a fase é a única observável aceita para vértices de apoio e para vértices em limites artificiais. O posicionamento relativo por código (PG5) e o DGPS (PG8) ficam restritos a limites naturais.

Outros cuidados do manual:

- **RTK convencional (PG6)** em limite artificial só com **solução fixa** das ambiguidades;
- **semicinemático (PG3) e cinemático (PG4)** precisam coletar sem perda de ciclo no deslocamento, então rendem mal em divisa com mata e obstrução;
- **cinemático (PG4)** é apropriado para limites muito sinuosos, como a margem de um córrego, em área aberta.

## Quando usar o relativo estático?

Use o relativo estático (PG1) para a base, para marcos importantes e para pontos longe de qualquer correção em tempo real. Base e receptor ficam parados durante toda a sessão, e o tempo mínimo cresce com a distância até a estação de referência.

A Tabela 4 do Manual Técnico recomenda, entre outros valores:

| Linha de base | Tempo mínimo | Observáveis | Solução |
|---|---|---|---|
| 0 a 10 km | 20 min | L1 ou L1/L2 | Fixa |
| 10 a 20 km | 30 min | L1/L2 | Fixa |
| 10 a 20 km | 60 min | L1 | Fixa |
| 20 a 100 km | 120 min | L1/L2 | Fixa ou flutuante |
| 100 a 500 km | 240 min | L1/L2 | Fixa ou flutuante |
| 500 a 1.000 km | 480 min | L1/L2 | Fixa ou flutuante |

Os vértices de apoio podem ser do SGB ou ter coordenadas determinadas a partir dele. No SGB, o manual só admite as estações SAT GPS, ativas ou passivas, como as da RBMC.

## Quando usar o PPP?

Use o PPP (PG9) quando não há estação de referência perto ou quando você quer a coordenada da base sem depender de outro receptor. No PPP, a coordenada é determinada de forma absoluta com efemérides precisas, sem receptor sobre vértice conhecido.

O IBGE oferece o **IBGE-PPP**, um serviço online gratuito de pós-processamento. Você envia o arquivo de observação em RINEX ou Hatanaka, informa o modo (estático ou cinemático), o modelo e a altura da antena e um e-mail. O resultado vem em relatório, com coordenadas em SIRGAS2000. A página do serviço informa que esses relatórios são aceitos pelo INCRA na certificação.

Dois cuidados práticos. O tempo de rastreio influencia a precisão final, então confira no relatório se o desvio padrão ficou dentro do que o vértice exige. E a própria página do IBGE avisa de instabilidades eventuais e orienta reenviar se o resultado não chegar em duas horas. Não deixe o processamento da base para a véspera do protocolo.

## Quando usar RTK convencional ou RTK em rede?

Use RTK para levantar os vértices de limite com produtividade, depois que a base estiver bem determinada. No RTK convencional (PG6), a base transmite correções por rádio ao receptor móvel, e o alcance depende da potência do rádio e dos obstáculos. No RTK em rede (PG7), várias estações enviam correções pela internet, o que permite ajustar mais de um vetor.

O IBGE também oferece RTK em rede gratuito, por NTRIP, a partir das estações da RBMC. O manual lembra duas limitações: depende de sinal de celular na área, que falta em muitas regiões rurais, e fica restrito a locais próximos às estações.

## Como combinar os métodos num levantamento real?

O fluxo mais comum junta os três:

1. **Implante a base** num ponto aberto e rastreie por relativo estático (amarrado à RBMC) ou para PPP.
2. **Processe a base** e obtenha a coordenada com precisão conhecida.
3. **Configure o RTK** com a coordenada processada da base, não com a coordenada de navegação.
4. **Levante os vértices de limite** em RTK, aceitando só solução fixa nos limites artificiais.
5. **Use estático-rápido** nos pontos sob copa ou com sinal ruim, onde o RTK não fixa.
6. **Registre o método de cada vértice** (PG1, PG6, PG9) na planilha ODS.

Exemplo: no levantamento da Fazenda Santa Luzia, a estação da RBMC mais próxima fica a mais de 100 km. O profissional rastreia a base VRTX-M-0001 por várias horas e processa no IBGE-PPP. Com a coordenada da base, levanta as cercas em RTK convencional. No trecho de mata ciliar, onde o RTK não fixa, faz estático-rápido; no córrego, que é limite natural, o RTK atende os 3,00 m com folga.

## Onde um sistema ajuda?

Depois do campo, o trabalho é transformar o arquivo do receptor em ODS, memorial e planta sem errar coordenada. Um sistema web como o [Vertces](/#sigef) lê o TXT ou CSV exportado do receptor GNSS/RTK do jeito que sai do campo, separa versões do mesmo ponto (levantamento e pós-processado) para você escolher qual vale e mostra avisos de consistência da planilha antes de baixar, como precisão acima de 0,50 m em limite artificial. O passo a passo está em [como converter o TXT do receptor GNSS para o SIGEF](/blog/txt-receptor-gnss-para-sigef/), e a montagem da planilha em [planilha ODS do SIGEF](/blog/planilha-ods-sigef-como-preencher/).

Quem valida a parcela é o SIGEF, e quem certifica é o INCRA. O método de campo continua sendo decisão sua.
