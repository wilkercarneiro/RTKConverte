---
{
  "titulo": "Sobreposição no SIGEF: como evitar antes de protocolar",
  "seoTitulo": "Sobreposição no SIGEF: como evitar antes de protocolar | Vertces",
  "descricao": "Sobreposição no SIGEF: o que é, por que aparece depois do envio, como usar os vértices certificados do vizinho e onde consultar as parcelas do INCRA.",
  "slug": "sobreposicao-sigef-como-evitar",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "sobreposição sigef",
  "palavrasRelacionadas": ["sobreposição com imóvel certificado", "vértices do confrontante certificado", "parcelas certificadas incra", "geoportal incra", "acervo fundiário incra", "análise de sobreposição sigef"],
  "resumo": "Sobreposição no SIGEF é quando o perímetro enviado invade uma parcela que já está no cadastro georreferenciado do INCRA; nesse caso, a certificação não sai. Para evitar, consulte as parcelas certificadas em volta antes de enviar e, na divisa com vizinho certificado, adote as mesmas coordenadas e códigos dos vértices dele, como manda o Manual Técnico do INCRA.",
  "faq": [
    { "p": "Uma sobreposição de poucos centímetros já impede a certificação?", "r": "O SIGEF confere a sobreposição com o cadastro na validação da planilha. Em vez de contar com margem, o caminho seguro na divisa com imóvel certificado é usar os mesmos vértices do vizinho, que é o que o Manual Técnico do INCRA orienta." },
    { "p": "O vizinho certificou com erro. Sou obrigado a usar os vértices dele?", "r": "O manual manda adotar os vértices do lindeiro quando há concordância. Se a divergência passar da tolerância de três vezes a precisão do tipo de limite, a certificação do vizinho deve ser cancelada, e é proibido criar vértices novos para o mesmo limite." },
    { "p": "Consigo ver as parcelas certificadas de graça?", "r": "Sim. O Geoportal do INCRA, divulgado pelo Serpro em agosto de 2026, é gratuito e aberto e mostra, para cada parcela, a localização, a situação da certificação, a área e os dados de registro." },
    { "p": "Usar o vértice do vizinho me torna responsável por ele?", "r": "Sim. Pelo Manual Técnico, ao adotar as coordenadas e a codificação do imóvel lindeiro certificado, o credenciado assume a responsabilidade técnica por elas de forma solidária." },
    { "p": "O Vertces garante que o SIGEF não vai acusar sobreposição?", "r": "Não. O Vertces mostra as parcelas certificadas em volta, aponta a sobreposição e coloca os vértices certificados na sua divisa antes do envio, mas quem valida e certifica é o INCRA." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "INCRA: Manual para Gestão da Certificação, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/manualgestaocertificacao2edicao2023.pdf/@@display-file/file" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" },
    { "titulo": "gov.br: Obter coordenadas e baixar os arquivos dos imóveis rurais certificados", "url": "https://www.gov.br/pt-br/servicos/obter-coordenadas-e-baixar-os-arquivos-dos-imoveis-ruras-certificados" },
    { "titulo": "Serpro: Geoportal do Incra com dados do Sigef (24/08/2026)", "url": "https://www.serpro.gov.br/menu/noticias/noticias-2026/incra-serpro" }
  ]
}
---

Sobreposição no SIGEF é quando o perímetro que você envia invade uma parcela que já está no cadastro georreferenciado do INCRA. Com sobreposição, a certificação não sai: o sistema avisa e você corrige e reenvia. Para evitar, consulte as parcelas certificadas em volta antes de enviar e, na divisa com vizinho certificado, use as mesmas coordenadas e os mesmos códigos dos vértices dele.

## O que é sobreposição no SIGEF?

É a interseção entre dois polígonos de imóveis no cadastro do INCRA. A certificação existe justamente para impedir isso: o art. 176, §5º, da Lei 6.015/73 diz que cabe ao INCRA certificar que a poligonal do memorial descritivo não se sobrepõe a nenhuma outra do seu cadastro georreferenciado.

O Manual para Gestão da Certificação (2ª edição) descreve a certificação como o instrumento que garante a inexistência de mais de um título para a mesma área. A conferência é feita pelo SIGEF. A página de certificação do INCRA resume o fluxo: se houver inconsistências ou sobreposições, o sistema notifica o interessado, que pode corrigir os dados e reenviar; se não houver, a planta e o memorial são gerados automaticamente.

A base de comparação não é só o que entrou pelo SIGEF. O Manual Técnico (item 1.2.13) lembra que o banco do antigo SNCI, sistema usado antes do SIGEF, ainda é utilizado na análise de sobreposição dos polígonos enviados.

## Por que a sobreposição só aparece depois do envio?

Porque, no fluxo manual, ninguém olha os vizinhos certificados antes de montar a planilha. O levantamento é processado, o perímetro é desenhado no CAD, a planilha é preenchida e só no envio o SIGEF mostra que a divisa entrou um metro na parcela do vizinho.

As causas mais comuns:

- **Divisa medida de novo.** O vizinho já certificou o mesmo limite, e o seu levantamento chegou a coordenadas ligeiramente diferentes para os mesmos marcos.
- **Marco do vizinho não reconhecido.** O código gravado no marco foi lido errado em campo, por exemplo a letra O no lugar do zero. O manual alerta para essa troca nos códigos antigos de três caracteres.
- **Vértice a mais no limite comum.** Um ponto intermediário seu entre dois vértices certificados do vizinho, criando um bico para dentro.
- **Base do levantamento deslocada.** Um erro de coordenada da base empurra todo o imóvel alguns metros.

O custo é conhecido: refazer a planilha, às vezes voltar a campo, regerar memorial e planta e explicar ao cliente por que o prazo correu.

## O que o INCRA manda fazer na divisa com imóvel certificado?

Manda adotar os vértices do vizinho. O Manual Técnico para Georreferenciamento de Imóveis Rurais (2ª edição, capítulo 2) diz que, nos limites comuns a imóveis certificados via SIGEF ou SNCI, o credenciado deve levantar e confrontar as informações com as existentes, ou obter os arquivos do levantamento com o responsável técnico do vizinho. Havendo concordância, adota as mesmas coordenadas e a mesma codificação dos vértices do imóvel lindeiro e assume a responsabilidade técnica por elas de forma solidária.

Se a divergência passar da tolerância, a certificação do vizinho deve ser cancelada, e o manual proíbe expressamente usar vértices novos para o mesmo limite. A tolerância (item 1.4.4) é de no máximo três vezes a precisão do tipo de limite:

| Tipo de limite | Precisão exigida | Tolerância (3 vezes) |
|---|---|---|
| Artificial | até 0,50 m | até 1,50 m |
| Natural | até 3,00 m | até 9,00 m |
| Inacessível | até 7,50 m | até 22,50 m |

O mesmo manual inclui, entre as tarefas antes do levantamento, verificar se há parcelas já certificadas no SIGEF ou no SNCI, ou em processo de certificação, nas confrontações do imóvel. Ou seja: olhar os vizinhos antes é parte do procedimento, não um extra.

## Onde consultar as parcelas certificadas do INCRA?

Em bases públicas do próprio INCRA. As principais:

1. **Geoportal do INCRA.** Segundo o Serpro, em notícia de 24/08/2026, o Geoportal reúne dados públicos extraídos do SIGEF, é gratuito e aberto a qualquer pessoa e mostra, para cada parcela, a localização, a situação da certificação (inclusive problemas como sobreposição com outros imóveis), a área em hectares e os dados de registro.
2. **Download de shapefiles do Acervo Fundiário.** A página de serviço do gov.br orienta escolher a camada e o estado; sem informar o estado, a exportação traz todos os imóveis certificados do Brasil na camada escolhida.
3. **Disponibilizador de Coordenadas.** Pelo número da certificação feita na vigência da 2ª edição da Norma Técnica, mostra o contorno do imóvel e exporta os dados em planilha, CSV ou XML.
4. **Consulta da parcela no SIGEF**, de onde se exportam os vértices da parcela certificada do vizinho.

Os endereços dessas ferramentas mudam com o tempo. Confira o link atual nas páginas do INCRA e do gov.br antes de montar uma rotina em cima delas.

## Como fazer no Vertces

No Vertces, a sobreposição aparece antes de protocolar, e os vértices certificados do vizinho entram na sua divisa:

1. **Responda a pergunta inicial.** Antes de enviar o TXT, o sistema pergunta se o imóvel confronta com área já certificada.
2. **Traga o CSV do vizinho certificado.** Se confronta, anexe o CSV de exportação do SIGEF da parcela vizinha. O arquivo pode vir em coordenadas geográficas ou em UTM.
3. **Marque os vértices da divisa.** Na planta, escolha quais vértices certificados do vizinho formam o limite comum. O sistema une esses vértices ao seu levantamento, com as coordenadas e os códigos certificados, no modo vértices certificados.
4. **Confira no mapa interativo.** O mapa mostra as parcelas já certificadas em volta do imóvel, a partir da base pública do INCRA. Se o levantamento entra na parcela do vizinho, você vê onde.
5. **Confirme que a sobreposição sumiu** e que cada trecho do limite comum tem o confrontante certo. Daí saem o [memorial descritivo](/blog/memorial-descritivo-georreferenciamento/), a [planilha ODS do SIGEF](/blog/planilha-ods-sigef-como-preencher/) e a planta com os mesmos vértices.

O marco do vizinho que entra na sua divisa continua sendo do vizinho: o sistema não o renumera com o prefixo do seu credenciado. A conferência é sua, como manda o manual, já que você responde solidariamente por esses vértices.

## Como conferir a sobreposição antes de protocolar?

Use este checklist antes de gerar a planilha:

1. Consulte as parcelas certificadas e em certificação em todo o entorno, não só no lado que você acha que é certificado.
2. Para cada vizinho certificado, obtenha os vértices da parcela e compare com o que você levantou.
3. Diferença dentro da tolerância: adote os vértices do vizinho. Fora da tolerância: pare e trate o cancelamento ou a análise antes de enviar.
4. Confira os códigos lidos nos marcos com os códigos da certificação.
5. Veja o perímetro final sobre o mapa com as parcelas em volta. Nem fresta, nem invasão.
6. Confira a precisão dos vértices novos pelo tipo de limite. Veja [precisão posicional no georreferenciamento](/blog/precisao-posicional-georreferenciamento/).

## E se a sobreposição for com uma certificação antiga do SNCI?

Existe um caminho próprio. O capítulo 8 do Manual para Gestão da Certificação trata da sobreposição com polígono que está na base do INCRA mas não entrou pelo SIGEF. A opção de requerer análise de sobreposição só aparece na página de submissão depois do envio e da validação de uma planilha ODS, e quando não há nenhum outro erro na planilha. Se o requerimento for deferido, o polígono do SNCI é excluído do banco.

Em pedidos de cancelamento, a automação divulgada pelo INCRA em julho de 2026 indefere automaticamente quando a nova parcela sobrepõe área fora do pedido. Detalhes em [o que mudou no cancelamento automático do SIGEF](/blog/atualizacao-sigef-2026-cancelamento-automatico/).

Quer ver a divisa com o vizinho certificado no mapa antes do próximo envio? Dá para [agendar uma demonstração](/#contato) com um levantamento seu.
