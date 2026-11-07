---
{
  "titulo": "Como conferir a área do imóvel rural antes do georreferenciamento completo",
  "seoTitulo": "Conferir área do imóvel rural antes do GEO | Vertces",
  "descricao": "Conferir área do imóvel rural antes do serviço completo: prévia de área e perímetro, diferença entre matrícula e levantamento e por que poupar os códigos.",
  "slug": "conferencia-de-area-imovel-rural",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "conferir área do imóvel rural",
  "palavrasRelacionadas": ["área da matrícula diferente do levantamento", "prévia de área georreferenciamento", "medir área de fazenda", "diferença de área escritura", "retificação de área imóvel rural", "conferência de área topografia"],
  "resumo": "Conferir a área do imóvel rural é calcular área e perímetro a partir do levantamento e comparar com o que diz a matrícula antes de partir para o georreferenciamento completo. No Vertces, a conferência de área gera essa prévia com planta e memorial, numerando os pontos como P-1, P-2…, sem consumir a numeração oficial dos vértices do credenciado.",
  "faq": [
    { "p": "Quanto de diferença entre a matrícula e o levantamento é aceitável?", "r": "Não há um percentual único que valha para todo caso. O Decreto 4.449/2002 diz que discrepâncias de área da matrícula não serão opostas ao memorial georreferenciado, desde que respeitados os direitos dos confrontantes. Diferença grande pede conversa com o cartório antes de seguir." },
    { "p": "A conferência de área serve para protocolar no SIGEF?", "r": "Não. Ela é uma prévia, com pontos numerados P-1, P-2…, sem os códigos oficiais do credenciado. Para o SIGEF, o caminho é o serviço completo, com o mesmo arquivo do levantamento." },
    { "p": "Preciso levantar o imóvel de novo para fazer o serviço completo?", "r": "Não, se o levantamento já tem a precisão exigida. O mesmo TXT da conferência é usado no serviço completo, que aí atribui os códigos oficiais aos vértices." },
    { "p": "O proprietário pode usar a planta da conferência para negociar a venda?", "r": "Pode usar como informação, deixando claro que é uma prévia e não um trabalho certificado. Para escritura e registro valem o georreferenciamento certificado e a matrícula." },
    { "p": "Dá para conferir a área com o imóvel confrontando com área já certificada?", "r": "Dá. No começo da conferência, o sistema pergunta se o imóvel confronta com área certificada. Se sim, você anexa o CSV do vizinho exportado do SIGEF e marca os vértices da divisa." }
  ],
  "fontes": [
    { "titulo": "Decreto nº 4.449/2002, art. 9º, §4º (discrepâncias de área da matrícula)", "url": "https://www.planalto.gov.br/ccivil_03/decreto/2002/d4449.htm" },
    { "titulo": "Lei nº 6.015/1973, arts. 212 e 213 (retificação do registro)", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm" },
    { "titulo": "INCRA: Certificação de imóveis rurais", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

Para conferir a área do imóvel rural, calcule área e perímetro a partir do levantamento GNSS e compare com o que está na matrícula, antes de começar o georreferenciamento para o SIGEF. A prévia mostra se a diferença é pequena ou se há um problema de divisa, de confrontante ou de documento. No Vertces, a conferência de área faz isso sem consumir a numeração oficial dos vértices do credenciado.

Conferência de área é o levantamento processado como prévia: área, perímetro, sequência de pontos e confrontantes, com planta e memorial de conferência, mas sem códigos oficiais de vértice e sem planilha para o SIGEF. Ela responde à pergunta do proprietário ("quanto eu tenho de verdade?") e à do profissional ("posso seguir com este perímetro?").

## Por que conferir a área antes do serviço completo?

Porque a surpresa custa menos antes. Uma diferença grande entre a matrícula e o campo muda o orçamento, o prazo e às vezes o próprio caminho no cartório. Saber disso no primeiro dia permite conversar com o cliente antes de assumir o serviço inteiro.

A conferência também resolve situações em que o georreferenciamento completo ainda não é a necessidade:

1. **Compra e venda.** O comprador quer saber se a área anunciada existe antes de fechar.
2. **Partilha e acordo de divisa.** A família quer ver a área real antes de dividir; veja [divisão de terra entre herdeiros](/blog/divisao-de-terra-entre-herdeiros/).
3. **Planejamento.** O produtor quer a área útil para calcular plantio, cerca ou reserva.
4. **Ensaio do escritório.** O primeiro serviço num sistema novo, para testar o fluxo sem risco.

Para uma estimativa rápida, sem levantamento GNSS, há também o caminho de [medir a área do terreno pelo celular](/blog/medir-area-de-terreno-pelo-celular/). Ela serve para ordem de grandeza, não para comparar com a matrícula.

## Por que a área da matrícula é diferente do levantamento?

Na maioria dos imóveis rurais antigos, a área da matrícula veio de uma medição sem coordenadas, e o levantamento GNSS mede outra coisa com outra precisão. As causas mais comuns:

| Causa | O que acontece |
|---|---|
| Descrição antiga | Área em alqueires ou tarefas, divisas por "córrego tal" e "cerca do vizinho", sem coordenadas |
| Medição a trena ou bússola | Erro acumulado em perímetros longos e rumos magnéticos que mudaram com o tempo |
| Divisa que andou | Cerca refeita, estrada alargada, curso d'água que mudou de leito |
| Áreas excluídas ou somadas | Faixa de estrada desmembrada, área vendida sem averbação, posse incorporada |
| Erro de cálculo ou de transcrição | Área copiada errada de escritura em escritura |

A lei reconhece essa realidade. O Decreto 4.449/2002, art. 9º, §4º, diz que as discrepâncias de área constantes da matrícula não serão opostas ao memorial georreferenciado, desde que mantidos os direitos de terceiros confrontantes. O ponto central é esse: a diferença de área é aceita quando não avança sobre o vizinho.

## O que fazer quando a diferença é grande?

Quando a diferença é grande, investigue a divisa antes de investigar o número. Diferença de área quase sempre tem um lugar físico: um lado que não fecha, um canto que ficou de fora, uma estrada medida por dentro ou por fora.

Um roteiro de investigação:

1. **Compare o desenho, não só a área.** Sobreponha a planta da conferência à descrição da matrícula. O lado que não bate costuma aparecer logo.
2. **Confira os confrontantes.** Se o vizinho já é certificado, a divisa dele é referência. Veja [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).
3. **Ouça o proprietário.** Venda sem averbação, acordo de cerca e posse antiga explicam boa parte das diferenças.
4. **Leve ao cartório antes.** O registrador diz se o caso cabe no georreferenciamento com a área nova ou se pede retificação.

A retificação está nos arts. 212 e 213 da Lei 6.015/73. Quando a medida do perímetro muda, o art. 213, II, pede requerimento com planta e memorial descritivo assinados por profissional habilitado e pelos confrontantes. É mais um motivo para descobrir a diferença cedo: as assinaturas dos vizinhos levam tempo, e a [carta de anuência dos confrontantes](/blog/carta-de-anuencia-confrontantes/) é parte do trabalho.

## Por que não gastar a numeração oficial dos vértices?

Porque cada código de vértice do credenciado é usado uma vez no SIGEF, e numerar um imóvel que talvez nunca seja certificado deixa buracos na sequência. O credenciado tem um prefixo e contadores de vértices M, P e V. Se um trabalho de prévia consome códigos e depois não segue, os contadores ficam adiantados em relação ao que foi de fato certificado, e o controle do escritório perde a referência.

Na conferência de área do Vertces, os pontos saem numerados P-1, P-2, P-3…, sem tocar nos contadores do credenciado. Quando o cliente decide seguir, o serviço completo usa o mesmo arquivo e aí atribui os códigos oficiais. A diferença entre os tipos de vértice está em [vértices M, P e V no SIGEF](/blog/tipos-de-vertice-m-p-v-sigef/).

## Como fazer no Vertces

A conferência de área é um tipo de serviço próprio, no Início.

1. **Em Início, clique em Conferência de área.**
2. **Diga se o imóvel confronta com área já certificada.** Se sim, anexe o CSV de exportação do SIGEF do vizinho e marque os vértices da divisa.
3. **Envie o TXT do levantamento.** O sistema lê o arquivo do receptor do jeito que sai do campo, detecta o fuso (e pergunta quando a UF tem dois), converte as coordenadas e mostra a área e o perímetro.
4. **Na etapa Dados**, preencha o detentor, o imóvel e o município. Os campos que faltam aparecem destacados no rodapé.
5. **Na etapa Confrontantes e vértices**, confira a sequência dos pontos e o nome de cada confrontante.
6. **Em Documentos**, gere a planta da conferência (A3 ou A4), o memorial descritivo timbrado e, se quiser, o memorial tabular.

A planta e os documentos saem com o logo e os dados do escritório. Tudo fica no Histórico de documentos do serviço, com versão. Quando a conferência estiver certa, crie um serviço completo com o mesmo TXT: saem o memorial, a planilha SIGEF (ODS) e a planta, já com os códigos oficiais. Se o imóvel tiver divisões internas, use o [serviço com glebas](/blog/dividir-imovel-rural-em-glebas/).

## Como apresentar o resultado ao cliente?

Apresente o resultado como prévia, com a diferença explicada. Três informações bastam:

- **a área e o perímetro medidos**, com a planta da conferência;
- **a área da matrícula** e a diferença, em hectares e em percentual;
- **o próximo passo**: seguir com o georreferenciamento, investigar uma divisa ou consultar o cartório.

Evite prometer o resultado do cartório ou do INCRA. A certificação do SIGEF confirma que o perímetro não se sobrepõe a outro cadastrado e que o trabalho atende à norma técnica; o registro da área nova depende do registrador. A conferência dá a informação para decidir. Para testar com um levantamento seu, [agende uma demonstração](/#contato).
