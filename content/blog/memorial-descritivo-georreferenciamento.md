---
{
  "titulo": "Memorial descritivo de georreferenciamento: o que precisa ter e como gerar sem erro",
  "seoTitulo": "Memorial descritivo de georreferenciamento sem erro | Vertces",
  "descricao": "Memorial descritivo de georreferenciamento: o que deve conter, como calcular azimute, distância e área no padrão do INCRA e como gerar o documento sem digitar.",
  "slug": "memorial-descritivo-georreferenciamento",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "memorial descritivo georreferenciamento",
  "palavrasRelacionadas": ["memorial descritivo imóvel rural", "como fazer memorial descritivo", "memorial descritivo sigef", "memorial tabular", "azimute e distância memorial", "modelo de memorial descritivo"],
  "resumo": "O memorial descritivo de georreferenciamento é o texto que descreve o perímetro do imóvel rural vértice a vértice, com código, coordenadas SIRGAS 2000, azimute, distância e confrontante de cada trecho. Ele é assinado por profissional habilitado com ART e precisa bater com a planta e a planilha do SIGEF. Gerado direto das coordenadas, sem digitação, ele deixa de ser a maior fonte de erro do processo.",
  "faq": [
    { "p": "O memorial descritivo pode ser feito em Word, digitado à mão?", "r": "Pode, desde que os números estejam certos e batam com a planilha e a planta. O risco está na digitação: um azimute ou um código de vértice trocado gera exigência no cartório. Gerar o texto direto das coordenadas elimina esse tipo de erro." },
    { "p": "Quem pode assinar o memorial descritivo de imóvel rural?", "r": "Profissional habilitado, com a Anotação de Responsabilidade Técnica, como pede o art. 9º do Decreto 4.449/2002. Para a certificação no SIGEF, o trabalho é feito por credenciado no INCRA." },
    { "p": "O memorial certificado pelo SIGEF substitui o memorial do escritório?", "r": "Depois da certificação, o SIGEF gera a planta e o memorial certificados a partir da planilha enviada. O que mais a serventia pede além das peças certificadas varia, então confira a exigência do cartório do imóvel antes de montar o pacote." },
    { "p": "Qual a diferença entre área em UTM e área no SIGEF?", "r": "O Manual Técnico do INCRA manda calcular a área no Sistema Geodésico Local, pela fórmula de Gauss. A área em UTM sofre a distorção da projeção e pode dar diferente, sobretudo em imóveis grandes." },
    { "p": "Dá para usar o mesmo memorial em matrícula e em posse?", "r": "A descrição do perímetro segue a mesma lógica, mas o conjunto de documentos muda. Na posse, o Vertces gera 4 peças e a planta em A3; na matrícula, as 7 peças técnicas." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "INCRA: Manual para Gestão da Certificação, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/manualgestaocertificacao2edicao2023.pdf/@@display-file/file" },
    { "titulo": "Decreto nº 4.449/2002 (identificação do imóvel rural)", "url": "https://www.planalto.gov.br/ccivil_03/decreto/2002/D4449.htm" },
    { "titulo": "Lei nº 6.015/1973, art. 176 (Registros Públicos)", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm" }
  ]
}
---

O memorial descritivo de georreferenciamento é o documento que descreve o perímetro do imóvel rural em texto corrido, vértice a vértice: código do vértice, coordenadas no SIRGAS 2000, azimute e distância até o próximo vértice e o confrontante de cada trecho. Ele é assinado por profissional habilitado, com ART, e precisa bater com a planta e com a planilha enviada ao SIGEF. Quando o texto sai direto das coordenadas, sem digitação, some a principal causa de exigência no cartório: o número copiado errado.

## O que entra num memorial descritivo de georreferenciamento?

Entra a identificação do imóvel e a descrição completa do perímetro, fechando no vértice inicial. O art. 176 da Lei 6.015/73 e o art. 9º do Decreto 4.449/2002 dizem que a identificação do imóvel rural vem de memorial descritivo assinado por profissional habilitado, com ART e com as coordenadas dos vértices georreferenciadas ao Sistema Geodésico Brasileiro.

Na prática, um memorial completo tem:

1. **Cabeçalho**: denominação do imóvel, proprietário, município e UF, matrícula ou transcrição, comarca, código de credenciamento, área em hectares e perímetro em metros.
2. **Vértice inicial**: código (por exemplo, VRTX-M-0001), datum SIRGAS 2000, meridiano central, latitude, longitude e altitude.
3. **Cada trecho**: confrontante, azimute, distância e o vértice seguinte com as coordenadas.
4. **Fechamento**: a volta ao vértice inicial e o perímetro total.
5. **Local, data e assinatura** do responsável técnico, com o número da ART.

O código do vértice segue a regra do Manual Técnico do INCRA (item 1.3.3): quatro caracteres do código do credenciado, uma letra do tipo (M, P ou V) e uma sequência numérica. O próprio manual avisa que AAAA-M-1 e AAAA-M-0001 são vértices diferentes. Um zero a mais no memorial já cria um vértice que não existe na planilha. Para entender cada tipo, veja o guia de [tipos de vértice M, P e V no SIGEF](/blog/tipos-de-vertice-m-p-v-sigef/).

## Por que o memorial feito à mão volta do cartório?

Volta porque o texto deixa de bater com a planilha ou com a planta. O caminho manual costuma ser assim: o técnico processa o levantamento, exporta as coordenadas, calcula azimutes numa planilha, copia tudo para um modelo em Word e ajusta frase por frase. Cada passo é uma chance de erro.

Os erros que mais aparecem:

- **Azimute trocado**: o valor de um lado colado no lado seguinte, ou o azimute de ré no lugar do de vante.
- **Código de vértice digitado errado**: M no lugar de P, um dígito a menos, sequência pulada.
- **Confrontante do trecho errado**: o nome do vizinho muda no marco, mas o texto continua com o anterior.
- **Área e perímetro de outra versão**: o cabeçalho ficou com o número da conferência e o corpo com o do levantamento final.
- **Coordenada do vértice de fechamento** diferente da do vértice inicial.

Nenhum desses erros é técnico de verdade. O levantamento está certo. O problema está na transcrição, e é ele que gera nota de exigência, viagem ao cartório e retrabalho com o cliente esperando.

## Como o azimute, a distância e a área devem ser calculados?

Devem seguir o Manual Técnico para Georreferenciamento de Imóveis Rurais (2ª edição, aprovada pela Portaria INCRA 2.502/2022), que é o mesmo padrão usado pelo SIGEF. O item 3.8 do manual define as fórmulas:

| Grandeza | Como o manual manda calcular | Unidade |
|---|---|---|
| Área | Coordenadas cartesianas locais no Sistema Geodésico Local (SGL), com origem na média das coordenadas da parcela, pela fórmula de Gauss | hectares |
| Distância horizontal | A partir das coordenadas cartesianas geocêntricas e da altitude elipsoidal | metros |
| Azimute | Problema Geodésico Inverso segundo Puissant | sistema sexagesimal (graus, minutos e segundos) |

O ponto que mais confunde é a área. O manual diz que a área no SGL expressa melhor a realidade física do que a área no sistema UTM, adotado antes, e que a distorção cresce com o tamanho da parcela. Se você calcula a área em UTM no CAD e o SIGEF calcula no SGL, os números não batem, e o memorial fica com uma área diferente da que vai sair na certificação.

## Memorial descritivo e memorial tabular: qual a diferença?

O memorial descritivo é o texto corrido; o memorial tabular traz os mesmos dados em tabela. Os dois descrevem o mesmo perímetro e precisam ter os mesmos números.

| | Memorial descritivo | Memorial tabular |
|---|---|---|
| Formato | Parágrafo corrido | Tabela, uma linha por vértice |
| Leitura | Pensado para a matrícula e o registrador | Pensado para conferência técnica |
| Conteúdo | Vértices, coordenadas, azimutes, distâncias e confrontantes em texto | Código, coordenadas, altitude, azimute, distância e confrontante em colunas |
| Uso | Peça principal para o cartório | Anexo de apoio, também usado na conferência de área |

Gerar os dois da mesma base de dados é o jeito simples de garantir que não vão divergir.

## Como fazer o memorial no Vertces

No Vertces, o memorial sai das coordenadas do levantamento, sem digitação. Os passos reais na tela:

1. **Envie o arquivo do levantamento.** O TXT ou CSV do receptor GNSS/RTK, do jeito que sai do campo. O sistema detecta o fuso UTM pelas coordenadas (quando a UF tem dois fusos, ele pergunta) e mostra a leitura do arquivo com o desenho do perímetro. Veja os detalhes em [como converter o TXT do receptor GNSS para o SIGEF](/blog/txt-receptor-gnss-para-sigef/).
2. **Confira no mapa.** Vértices, área e perímetro no padrão do SIGEF e a sequência dos pontos. Dá para ajustar pontos, renomear vértices em lote e inserir um ponto num lado.
3. **Preencha os dados.** Na etapa Dados, detentor, imóvel, matrícula, comarca e município. Os campos que faltam aparecem destacados.
4. **Confira os confrontantes.** Na etapa Confrontantes e vértices, cada trecho mostra o confrontante. Clientes, imóveis e confrontantes já cadastrados são reaproveitados de outros serviços.
5. **Gere os documentos.** Em Documentos, o memorial descritivo sai em DOCX junto com o memorial tabular, a planilha SIGEF e a planta, com os códigos oficiais dos vértices do credenciado.

O memorial sai com o logo e o modelo do escritório. Se você não enviou modelo próprio, o sistema aplica um timbre automático com o logo, marca d'água e rodapé com os dados da empresa. A imagem da assinatura do RT pode entrar no documento. Cada versão gerada fica no histórico do serviço, então dá para saber qual memorial foi para o cartório.

Se quiser ensaiar antes, use a **Conferência de área**: ela mostra área e perímetro e gera o memorial tabular sem consumir a numeração oficial dos vértices do credenciado.

## O que conferir antes de assinar o memorial?

Confira tudo o que um sistema não tem como saber por você. O Vertces calcula, mas quem assina é o responsável técnico. Antes de protocolar:

1. Nome do proprietário, CPF ou CNPJ, matrícula e comarca, iguais aos da certidão.
2. Confrontante de cada trecho, conferido com o que foi visto em campo e com as matrículas vizinhas.
3. Códigos dos vértices, comparados com o último código usado pelo credenciado no SIGEF.
4. Vértices na divisa com imóvel já certificado: devem ser os mesmos do vizinho. O manual do INCRA manda adotar as coordenadas e a codificação do lindeiro certificado quando há concordância. Veja [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).
5. Área e perímetro iguais no memorial, no tabular, na planta e na planilha.

## Onde o memorial entra no processo do cartório?

Ele é a base da descrição que vai para a matrícula. Com a certificação do INCRA, o proprietário requer o registro levando, conforme o art. 9º do Decreto 4.449/2002, a certificação, o CCIR, a prova de quitação do ITR dos últimos cinco anos quando exigível e a declaração dos confrontantes de que os limites foram respeitados. O memorial é a peça que amarra tudo isso.

A certificação, lembra o mesmo decreto, não reconhece domínio nem a exatidão dos limites indicados pelo proprietário. Ela atesta que a poligonal não se sobrepõe a outra do cadastro do INCRA e que o memorial atende às exigências técnicas. A lista completa de documentos está no guia de [peças técnicas do georreferenciamento para o cartório](/blog/pecas-tecnicas-georreferenciamento-cartorio/), e o desenho que acompanha o memorial, em [planta de georreferenciamento A1 e A3](/blog/planta-georreferenciamento-a1-a3/).

Se o seu escritório ainda monta memorial copiando coordenada para o Word, vale ver o fluxo funcionando com um levantamento seu. Dá para [agendar uma demonstração](/#contato).
