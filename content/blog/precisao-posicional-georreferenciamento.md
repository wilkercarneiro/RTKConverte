---
{
  "titulo": "Precisão posicional no georreferenciamento: 0,50 m, 3,00 m e 7,50 m explicados",
  "seoTitulo": "Precisão posicional no georreferenciamento: 0,50 m | Vertces",
  "descricao": "Precisão posicional no georreferenciamento: como o INCRA calcula, os limites de 0,50 m, 3,00 m e 7,50 m, a tolerância de 3 vezes e os métodos aceitos.",
  "slug": "precisao-posicional-georreferenciamento",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "guias-tecnicos",
  "palavraChave": "precisão posicional georreferenciamento 0,50 m",
  "palavrasRelacionadas": ["precisão posicional incra", "precisão limite artificial 0,50", "precisão limite natural 3 metros", "limite inacessível 7,50 m", "sigma latitude longitude sigef", "tolerância vértice certificado", "métodos de posicionamento incra"],
  "resumo": "Precisão posicional, no georreferenciamento de imóveis rurais, é a resultante horizontal dos desvios padrão da latitude e da longitude de cada vértice, em metros. O INCRA exige precisão melhor ou igual a 0,50 m em limites artificiais, 3,00 m em limites naturais e 7,50 m em limites inacessíveis. Entre um vértice certificado e a medição de outro credenciado, a tolerância é de até três vezes esse valor.",
  "faq": [
    { "p": "A altitude entra no cálculo da precisão posicional?", "r": "Não. O Manual Técnico do INCRA manda desconsiderar o desvio padrão da altitude. A precisão posicional é só a resultante planimétrica, raiz da soma dos quadrados dos desvios padrão da latitude e da longitude." },
    { "p": "Posso medir uma cerca com RTK em solução flutuante?", "r": "Para limite artificial, o Manual condiciona o RTK convencional à solução fixa das ambiguidades. Solução flutuante não serve para vértices de cerca, muro ou estrada." },
    { "p": "Qual precisão vale para um vértice que fica no encontro de cerca com rio?", "r": "O padrão é definido pelo tipo de limite em que o vértice está. Um vértice que pertence a um trecho de cerca segue o limite artificial, e o mais seguro é atender ao padrão mais exigente entre os trechos que se encontram nele." },
    { "p": "Dá para usar GPS de navegação em limite natural?", "r": "O Manual aceita métodos de menor precisão, como o posicionamento relativo a partir de códigos e o DGPS, apenas em limites naturais, e sempre desde que o valor de 3,00 m seja atingido. GPS de navegação sem posicionamento relativo não está entre os métodos listados." },
    { "p": "Que sigma declaro para vértice obtido por drone?", "r": "Para aerofotogrametria e sensores orbitais, o Manual manda usar como precisão o RMS obtido na avaliação da acurácia posicional ou na ortorretificação. Esses vértices são do tipo V." },
    { "p": "Se a precisão sair acima do limite, o SIGEF recusa?", "r": "O padrão de precisão é uma exigência do Manual Técnico e a planilha é validada no envio. O caminho seguro é não enviar: refaça a medição ou revise o processamento até que cada vértice atenda ao padrão do seu tipo de limite." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição (2022)", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "INCRA: Norma Técnica para Georreferenciamento de Imóveis Rurais, 3ª edição", "url": "https://sigef.incra.gov.br/static/documentos/norma_tecnica_georreferenciamento_imoveis_rurais_3ed.pdf" },
    { "titulo": "INCRA: Manual Técnico de Posicionamento, 1ª edição (2013)", "url": "https://sigef.incra.gov.br/static/documentos/manual_tecnico_posicionamento_1ed.pdf" },
    { "titulo": "Planalto: Decreto nº 4.449/2002", "url": "https://www.planalto.gov.br/ccivil_03/decreto/2002/D4449.htm" }
  ]
}
---

Precisão posicional é a resultante horizontal dos desvios padrão da latitude e da longitude de um vértice, expressa em metros. O INCRA exige que ela seja melhor ou igual a 0,50 m em vértices de limites artificiais, 3,00 m em limites naturais e 7,50 m em limites inacessíveis. Esses três números, mais a tolerância de três vezes entre credenciados, decidem que método de campo você pode usar em cada trecho da divisa.

A exigência tem base legal. O art. 176 da Lei 6.015/73 e o art. 9º do Decreto 4.449/2002 pedem coordenadas georreferenciadas ao Sistema Geodésico Brasileiro "com precisão posicional a ser estabelecida" pelo INCRA. Quem fixa os valores é a Norma Técnica para Georreferenciamento de Imóveis Rurais, 3ª edição (item 4.4), repetida no item 1.4.4 do Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição.

## Como o INCRA calcula a precisão posicional?

A precisão posicional é a raiz da soma dos quadrados dos desvios padrão da latitude e da longitude: σP = √(σφ² + σλ²). O desvio padrão da altitude (σh) fica fora da conta.

Os detalhes que o Manual fixa:

- **Precisão absoluta.** É a precisão ligada ao Sistema Geodésico Brasileiro, com a propagação das covariâncias a partir dos vértices do SGB. Não é a precisão relativa entre dois pontos do seu levantamento.
- **Em metros.** Os desvios padrão de latitude e longitude, que nascem em unidade angular, devem ser convertidos para valores lineares. Na planilha, σφ, σλ e σh vão em metros.
- **Exemplo.** Um vértice com σφ = 0,018 m e σλ = 0,024 m tem σP = √(0,000324 + 0,000576) = 0,030 m. Atende com folga a qualquer tipo de limite.

Um cuidado de escritório: receptores e programas de processamento exportam a precisão com nomes diferentes (sigma, RMS, HRMS) e, às vezes, com nível de confiança diferente de um desvio padrão. Antes de copiar o valor para a planilha, confirme no manual do equipamento o que aquele número representa.

## Quais são os padrões de precisão por tipo de limite?

O padrão depende do tipo de limite onde o vértice está, e não do tipo de vértice (M, P ou V). A tabela resume o item 1.4.4 do Manual e a classificação de limites do item 2.4.1.

| Tipo de limite | Exemplos (códigos do Manual) | Precisão exigida | Tolerância entre credenciados (3×) |
|---|---|---|---|
| Artificial | Cerca (LA1), muro (LA2), estrada (LA3), vala (LA4), canal (LA5), linha ideal (LA6), limite artificial não tipificado (LA7) | ≤ 0,50 m | até 1,50 m |
| Natural | Corpo ou curso d'água (LN1), linha de cumeada (LN2), grota (LN3), crista de encosta (LN4), pé de encosta (LN5), limite natural não tipificado (LN6) | ≤ 3,00 m | até 9,00 m |
| Inacessível | Vértice em local que não se pode ocupar | ≤ 7,50 m | até 22,50 m |

Repare que a linha ideal, mesmo sem elemento físico, é classificada como limite artificial. Uma divisa reta entre dois marcos de desmembramento cobra os mesmos 0,50 m de uma cerca.

## O que é a tolerância de três vezes a precisão?

A tolerância é a diferença máxima admitida entre as coordenadas de um vértice certificado e o valor apurado por outro credenciado: no máximo três vezes a precisão do tipo de limite. A regra entrou no texto do item 1.4.4 do Manual Técnico de 2022.

Ela muda o trabalho na divisa com vizinho certificado:

1. **Dentro da tolerância:** você adota as coordenadas e os códigos dos vértices do vizinho e assume a responsabilidade técnica por eles de forma solidária.
2. **Acima da tolerância:** o Manual determina que a certificação deve ser cancelada e proíbe usar vértices novos para o mesmo limite.

Não confunda com a tolerância para incluir vértices novos em parcelas certificadas (desmembramento ou atualização), que é outra tabela do Manual: até 0,5 m entre o vértice e o alinhamento existente, a inclusão é automática; de 0,5 m a 9,0 m, depende de análise; acima de 9,0 m, não é permitida.

## Quais métodos de posicionamento atendem cada tipo de limite?

A Tabela 6 do Manual Técnico diz em que tipo de limite cada método pode ser usado. Resumo:

| Grupo de métodos | Códigos | Onde pode ser usado |
|---|---|---|
| GNSS relativo com fase (estático, estático-rápido, semicinemático, cinemático) | PG1 a PG4 | Limite artificial ou natural |
| GNSS relativo a partir de códigos | PG5 | Só limite natural |
| RTK convencional / RTPPP e RTK em rede | PG6, PG7 | Limite artificial ou natural |
| DGPS | PG8 | Só limite natural |
| Posicionamento por Ponto Preciso | PG9 | Limite artificial ou natural |
| Topografia clássica (poligonação a estação livre) | PT1 a PT9 | Limite artificial ou natural |
| Geometria analítica (paralela, interseção de retas, projeção técnica) | PA1 a PA3 | Limite artificial ou natural |
| Sensoriamento remoto (aerofotogrametria, radar, laser, orbital) | PS1 a PS4 | Artificial, natural ou inacessível, com exceções |
| Base cartográfica com e sem precisão conhecida | PB1, PB2 | Artificial, natural ou inacessível, com exceções |

As exceções e condições que o texto do Manual acrescenta:

- **Fase da onda portadora** é a única observável aceita para vértices de apoio e vértices em limites artificiais. Pseudodistância (código) só em limite natural.
- **RTK convencional em limite artificial** exige solução fixa das ambiguidades.
- **Semicinemático e cinemático** pedem cuidado em locais com obstrução, comuns em divisas rurais, porque a precisão pode sair do padrão.
- **Sensoriamento remoto** não se aplica a vértices tipo M, a limites por cerca nem a mudanças de confrontação. A base cartográfica não pode determinar vértice tipo M.
- **Projeção técnica** só em local inacessível, quando nenhum outro método for possível. Nesse caso, o Manual manda fixar σφ, σλ e σh em 0,00 m.
- **Aerofotogrametria e sensores orbitais** usam como precisão o RMS da avaliação da acurácia posicional ou da ortorretificação.

Para saber que letra cada um desses métodos permite no código do vértice, veja o guia de [tipos de vértice M, P e V](/blog/tipos-de-vertice-m-p-v-sigef/).

## Como conferir as precisões antes de enviar ao SIGEF?

O jeito mais seguro é conferir vértice a vértice, cruzando três colunas: tipo de limite do trecho, método e sigma. Uma rotina simples:

1. **Classifique cada trecho** com o código de limite (LA1 a LA7, LN1 a LN6) antes de olhar os números.
2. **Calcule σP** de cada vértice com a fórmula do Manual, em metros, sem a altitude.
3. **Compare com o padrão do limite.** Vértice que pertence a trecho de cerca e de rio ao mesmo tempo deve atender ao mais exigente.
4. **Cheque o método.** PG5 e PG8 em cerca, ou PS em mudança de confrontação, não passam, mesmo com sigma bom.
5. **Olhe a divisa com o vizinho certificado.** Compare suas coordenadas com as dele e veja se a diferença cabe em três vezes a precisão.
6. **Guarde o material.** O Manual manda arquivar dados brutos GNSS (RINEX e nativo), arquivos do RTK, relatórios de processamento e cadernetas, e o INCRA pode pedir.

Esses mesmos campos alimentam a [planilha ODS do SIGEF](/blog/planilha-ods-sigef-como-preencher/), e um sigma mal transcrito do [TXT do receptor GNSS](/blog/txt-receptor-gnss-para-sigef/) é uma das causas mais comuns de retrabalho.

## Onde um sistema ajuda?

A conferência de sigma é mecânica e cansativa quando o perímetro tem centenas de vértices, e é exatamente o tipo de coisa que um sistema faz melhor que o olho. No Vertces, a planilha SIGEF (ODS) tem prévia com avisos de consistência antes do download, seguindo as regras da Norma: um vértice em limite artificial com σ acima de 0,50 m aparece marcado antes de você baixar o arquivo. Na leitura do TXT, quando o mesmo ponto vem em duas versões (levantamento e pós-processado, por exemplo), o sistema separa e deixa você escolher qual entra.

O sistema confere e avisa; a decisão técnica e a responsabilidade continuam do credenciado, e quem certifica é o INCRA. Para ver a prévia com um levantamento seu, [agende uma demonstração](/#contato).
