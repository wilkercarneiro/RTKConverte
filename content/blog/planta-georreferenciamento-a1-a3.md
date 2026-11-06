---
{
  "titulo": "Planta de georreferenciamento em A1 ou A3: o que precisa ter e como gerar",
  "seoTitulo": "Planta de georreferenciamento A1 ou A3 | Vertces",
  "descricao": "Planta de georreferenciamento: o que deve aparecer (malha UTM, vértices, confrontantes, quadro, carimbo), quando usar A1 ou A3 e como gerar o PDF sem CAD.",
  "slug": "planta-georreferenciamento-a1-a3",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "planta de georreferenciamento",
  "palavrasRelacionadas": ["planta topográfica imóvel rural", "planta a1 georreferenciamento", "planta a3 cartório", "quadro analítico planta", "malha utm planta", "planta de situação"],
  "resumo": "A planta de georreferenciamento é o desenho do perímetro do imóvel rural com os vértices codificados, as medidas dos lados, os confrontantes, a malha de coordenadas, o norte, o quadro analítico e o carimbo do responsável técnico. O tamanho da folha, A1 ou A3, depende do imóvel e da escala que deixa tudo legível. O mais seguro é gerar a planta das mesmas coordenadas do memorial e da planilha do SIGEF, para os três documentos nunca divergirem.",
  "faq": [
    { "p": "O INCRA exige um tamanho de folha para a planta?", "r": "O Manual Técnico do INCRA não fixa formato de folha. A planta certificada é gerada pelo próprio SIGEF; a planta que o escritório entrega segue o padrão do escritório e o que a serventia de registro aceita." },
    { "p": "Posso entregar a planta só em PDF?", "r": "Depende do cartório e do uso. O PDF é o formato de trabalho e de impressão; confira com a serventia se ela pede via impressa assinada, além do arquivo." },
    { "p": "A planta precisa mostrar a faixa de domínio da rodovia?", "r": "Quando o imóvel confronta com rodovia, mostrar a faixa ajuda a evitar divergência no registro. No Vertces, a faixa de domínio das rodovias federais e a faixa não edificável de 15 m da Lei 6.766 saem tracejadas na planta." },
    { "p": "Como o cartório confere se a planta é autêntica?", "r": "No Vertces, a planta pode levar um QR Code de autenticidade que abre uma página pública de verificação, sem dados do proprietário. A certificação em si se confere no SIGEF." },
    { "p": "Dá para alterar a planta depois de gerada sem refazer tudo?", "r": "Sim. O editor de planta do Vertces permite mover elementos, trocar texto e cor, apagar e acrescentar texto ou linha, com o traçado do terreno travado." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual para Gestão da Certificação, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/manualgestaocertificacao2edicao2023.pdf/@@display-file/file" },
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "Lei nº 6.015/1973 (Registros Públicos), arts. 176 e 213", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

A planta de georreferenciamento é o desenho do perímetro do imóvel rural com os vértices codificados, as medidas dos lados, os confrontantes de cada trecho, a malha de coordenadas, o norte, o quadro analítico e o carimbo do responsável técnico. A1 ou A3 é uma escolha de legibilidade: a folha precisa caber o imóvel numa escala em que todos os códigos e medidas sejam lidos. O que não pode acontecer é a planta divergir do memorial e da planilha do SIGEF, e o jeito de garantir isso é gerar os três das mesmas coordenadas.

## O que deve ter uma planta de georreferenciamento?

Deve ter tudo o que permite ler o perímetro sem o memorial ao lado. Uma planta completa traz:

1. **Moldura e malha de coordenadas** UTM, com os valores de E e N nas bordas.
2. **Norte** indicado.
3. **Poligonal do imóvel** com o código de cada vértice (por exemplo, VRTX-M-0001), no padrão do credenciado. Veja [tipos de vértice M, P e V](/blog/tipos-de-vertice-m-p-v-sigef/).
4. **Medidas dos lados** e o **confrontante** de cada trecho.
5. **Quadro analítico** com os vértices, as coordenadas, os azimutes e as distâncias.
6. **Área e perímetro**, iguais aos do memorial.
7. **Planta de situação**, que mostra onde o imóvel fica.
8. **Carimbo** com o imóvel, o proprietário, o município, o responsável técnico, o registro profissional e o logo do escritório.

O art. 213, inciso II, da Lei 6.015/73 é um bom lembrete do peso dessa peça: na retificação por inserção ou alteração de medida perimetral, o requerimento vai instruído com planta e memorial descritivo assinados por profissional habilitado, com a prova de responsabilidade técnica, e com a assinatura dos confrontantes.

## A1 ou A3: qual formato usar?

Use o menor formato em que a planta continue legível. O Manual Técnico do INCRA não fixa tamanho de folha, então a decisão é técnica e prática.

| | A1 (594 × 841 mm) | A3 (297 × 420 mm) |
|---|---|---|
| Quando usar | Imóvel grande ou com muitos vértices, divisas sinuosas, várias glebas | Imóvel pequeno ou de poucos vértices, posse, conferência |
| Vantagem | Escala maior, códigos e medidas sem sobrepor | Imprime em qualquer impressora de escritório, cabe no processo |
| Cuidado | Impressão em plotter, custo e transporte | Em imóvel grande, os rótulos se amontoam |

Antes de fechar o formato, pergunte na serventia do imóvel como ela recebe a planta. A exigência do cartório manda mais que a preferência do escritório.

## Planta certificada do SIGEF e planta do escritório: qual a diferença?

A planta certificada é gerada pelo SIGEF; a planta do escritório é a peça técnica que você monta e assina. O Manual para Gestão da Certificação diz que o SIGEF gera automaticamente as peças técnicas certificadas, planta e memorial descritivo, com base no arquivo digital enviado pelo credenciado. Ou seja: a planta certificada reflete exatamente a sua planilha ODS.

A planta do escritório vai além. Ela traz a planta de situação, o carimbo com o seu logo, o quadro analítico no seu padrão e o que mais o cliente e o cartório pedirem. Por isso a regra de ouro é a mesma do [memorial descritivo](/blog/memorial-descritivo-georreferenciamento/): os números da sua planta têm de ser os mesmos da planilha que gerou a certificação.

## Por que montar a planta no CAD toma tanto tempo?

Porque, no fluxo manual, cada elemento é desenhado ou digitado de novo. O técnico importa os pontos no CAD, liga a poligonal, escreve código por código, cota lado por lado, monta a malha UTM, copia o quadro analítico da planilha, recorta uma imagem de satélite para a situação e ajusta o carimbo.

Os erros que voltam:

- **Cota trocada** entre dois lados vizinhos.
- **Confrontante no trecho errado**, porque o texto foi arrastado junto com outro.
- **Quadro analítico desatualizado**, copiado antes do último ajuste de vértice.
- **Malha com o fuso errado**, desenhada à mão a partir de outro serviço.
- **Área da planta diferente da do memorial**, porque uma foi calculada em UTM e a outra não. O Manual Técnico manda calcular a área no Sistema Geodésico Local, pela fórmula de Gauss (item 3.8.3).

Uma planta dessas leva horas e ainda depende de uma revisão cuidadosa para não voltar do cartório.

## Como fazer no Vertces

No Vertces, a planta se monta sozinha a partir do levantamento. Você confere e ajusta o acabamento.

1. **Envie o levantamento e confira no mapa.** O TXT do receptor é lido como sai do campo, e o perímetro aparece com área e perímetro no padrão do SIGEF. Veja [como converter o TXT do GNSS para o SIGEF](/blog/txt-receptor-gnss-para-sigef/).
2. **Confira os confrontantes.** Na etapa Confrontantes e vértices, cada trecho mostra o vizinho. Se a divisa é com imóvel certificado, os vértices do vizinho entram no seu limite. Veja [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).
3. **Gere os documentos.** A planta sai em PDF, em A1 ou A3, com moldura e malha UTM, norte, poligonal com os códigos dos vértices, medidas dos lados, confrontantes, quadro analítico e carimbo com o logo do escritório.
4. **Veja a planta de situação.** A imagem de satélite é buscada automaticamente pelo sistema; não é preciso recortar nem enviar imagem.
5. **Revise no editor e baixe.** Cada versão fica no histórico de documentos do serviço.

Alguns elementos entram quando fazem sentido:

- **Faixa de domínio de rodovia** (federais pelo DNIT; estaduais da BA pela SEINFRA) e a **faixa não edificável de 15 m** da Lei 6.766, tracejadas. Mais em [faixa de domínio e recuo de rodovia](/blog/faixa-de-dominio-rodovia-recuo/).
- **QR Code de autenticidade**, com página pública de verificação sem dados do proprietário.
- **Imagem da assinatura do RT**, configurada uma vez no escritório.

Na posse, a planta sai em A3, junto com as 4 peças. Na matrícula, ela acompanha as 7 peças técnicas.

## Como editar a planta sem mexer no traçado?

Use o editor de planta: ele mexe no acabamento e trava a geometria. Você pode mover um rótulo que ficou em cima de outro, trocar texto e cor, apagar um elemento e acrescentar texto ou linha. O traçado do terreno, com os vértices e os lados, fica travado.

Isso resolve o problema mais comum de quem edita planta no CAD: arrastar sem querer um vértice junto com o texto e criar uma diferença entre a planta e o memorial que ninguém percebe até o cartório.

## O que conferir antes de imprimir a planta?

Antes de imprimir e assinar, confira:

1. Área e perímetro iguais aos do memorial e da planilha.
2. Códigos dos vértices iguais aos da planilha ODS, inclusive os do vizinho certificado.
3. Confrontante de cada trecho, especialmente onde a divisa muda de vizinho num marco.
4. Dados do carimbo: proprietário, matrícula, município, comarca, RT e registro profissional.
5. Legibilidade na escala escolhida. Se os rótulos se amontoam no A3, gere em A1.
6. Faixa de domínio e recuo, quando houver rodovia.

O sistema calcula e desenha, mas quem assina é o responsável técnico. Se quiser comparar com a planta que você monta hoje, dá para [agendar uma demonstração](/#contato).
