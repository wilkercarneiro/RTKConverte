---
{
  "titulo": "Monografia de marco e QR de autenticidade na planta",
  "seoTitulo": "Monografia de marco e QR de autenticidade na planta | Vertces",
  "descricao": "Monografia de marco no georreferenciamento: o que vai na ficha de cada vértice M, como gerar todas num DOCX e como o QR da planta prova que o documento é seu.",
  "slug": "monografia-de-marco-e-qr-de-autenticidade",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "monografia de marco georreferenciamento",
  "palavrasRelacionadas": ["monografia de marco", "ficha de marco geodésico", "monografia de vértice tipo M", "qr code planta georreferenciamento", "autenticidade da planta", "assinatura do responsável técnico"],
  "resumo": "Monografia de marco é a ficha de identificação de cada marco implantado no imóvel, com código, coordenadas SIRGAS 2000, precisões, descrição do local, acesso, croqui e foto, para que o marco seja reencontrado no campo. No Vertces, as monografias saem num DOCX só, uma página por marco, apenas para os marcos do seu credenciado. A planta ganha um QR Code que abre uma página pública de verificação, sem dados do proprietário.",
  "faq": [
    { "p": "A monografia de marco é obrigatória para certificar no SIGEF?", "r": "O envio ao SIGEF é feito pela planilha ODS, e a monografia não faz parte desse envio. Ela pode ser pedida por contratantes, prefeituras e órgãos que querem poder reencontrar o marco, e serve de registro do seu trabalho." },
    { "p": "Posso fazer monografia do marco do vizinho?", "r": "No Vertces não. O sistema só gera a monografia dos marcos com o prefixo do credenciado do serviço. Marco de área certificada vizinha ou de outro credenciado fica de fora, porque não é você quem responde por ele." },
    { "p": "Quem lê o QR da planta vê o CPF do proprietário?", "r": "Não. A página de verificação mostra só dados públicos do documento, como denominação, município, área, perímetro, empresa e responsável técnico. Nenhum CPF aparece." },
    { "p": "O QR substitui a assinatura digital?", "r": "Não. O QR prova que o documento foi emitido pelo sistema e que o arquivo não foi alterado, mas não é assinatura digital ICP-Brasil. A assinatura formal continua sendo a que o cartório ou o órgão exigir." },
    { "p": "Dá para usar a minha assinatura escaneada nos documentos?", "r": "Sim. No cadastro do responsável técnico você envia a imagem da assinatura, e ela passa a sair nos documentos gerados com aquele RT." }
  ],
  "fontes": [
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" },
    { "titulo": "Lei 10.267/2001 (georreferenciamento no registro de imóveis)", "url": "https://www.planalto.gov.br/ccivil_03/leis/leis_2001/l10267.htm" },
    { "titulo": "Lei 13.709/2018 (LGPD)", "url": "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm" }
  ]
}
---

Monografia de marco é a ficha que identifica cada marco implantado no imóvel: código, coordenadas SIRGAS 2000, precisões, como foi medido, onde está, como chegar, croqui e foto. Ela existe para que qualquer profissional consiga reencontrar o marco no campo anos depois. No Vertces, as monografias de todos os marcos do serviço saem num DOCX só, uma página por marco, e a planta ganha um QR Code de autenticidade que qualquer pessoa pode conferir.

Este post mostra o que vai numa boa monografia, como o Vertces monta as fichas e para que servem a assinatura do RT e o QR na planta.

## Para que serve a monografia de marco?

A monografia serve para achar o marco de novo e para provar como ele foi implantado. O memorial descritivo diz por onde passa a divisa; a monografia diz onde está, fisicamente, cada marco que materializa essa divisa.

Ela é útil em quatro situações comuns:

- **Reencontrar o marco** numa retificação, num desmembramento ou numa disputa de divisa.
- **Entregar ao cliente** um registro claro do que foi implantado na propriedade dele.
- **Atender quem pede**: contratantes, prefeituras e órgãos públicos podem pedir a ficha dos marcos junto com as peças, conforme o contrato ou a exigência local.
- **Documentar o seu trabalho** de responsável técnico, com data, equipamento e método.

O marco documentado é o vértice tipo M, aquele materializado em campo. Os vértices tipo P e V não têm marco implantado. A diferença entre eles está no post sobre [vértices tipo M, P e V no SIGEF](/blog/tipos-de-vertice-m-p-v-sigef/).

## O que deve ter numa monografia de marco?

Uma monografia completa responde três perguntas: qual é o marco, onde ele está e quem responde por ele. A ficha que o Vertces gera traz:

| Bloco | Conteúdo |
|---|---|
| Identificação | Código do marco (ex.: VRTX-M-0001), tipo e material do marco |
| Coordenadas geodésicas | Latitude, longitude e altitude elipsoidal em SIRGAS 2000 |
| Coordenadas UTM | E, N, fuso e meridiano central |
| Qualidade | Precisões e método de posicionamento |
| Levantamento | Data e equipamento usado |
| Amarração | Vértices vizinhos do perímetro |
| Localização | Descrição do local e do acesso desde a sede do município |
| Croqui | Perímetro do imóvel com o marco em destaque |
| Foto | Imagem do marco no campo |
| Responsável | RT com conselho e código de credenciado no INCRA |

As coordenadas, as precisões e a amarração o sistema já tem, porque vieram do levantamento. O que ele não sabe é o que só quem foi a campo conhece: a referência física (“a 3 m da cerca, ao lado da porteira”), o caminho de acesso, o tipo de marco e a data. Esses campos você digita uma vez na tela.

## Por que só os marcos do próprio credenciado?

A monografia é uma declaração de quem implantou o marco, então o Vertces só gera ficha para os marcos com o prefixo do credenciado do serviço. Se a sua divisa usa vértices de uma área certificada vizinha, ou marcos de outro credenciado, esses ficam de fora da lista, com o aviso do motivo.

Isso evita um erro comum: entregar ficha de um marco que você não implantou e cujas precisões não são suas. Quando o vizinho já é certificado, os vértices dele entram na sua divisa pelo modo vértices certificados, mas a monografia continua sendo responsabilidade de quem o certificou. Mais sobre isso em [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).

## Como fazer a monografia no Vertces

As monografias ficam na área de documentos do serviço, depois que os vértices já têm os códigos oficiais. O passo a passo:

1. Abra o serviço e vá até **Monografia dos marcos**.
2. Confira a lista: aparecem os marcos tipo M com o prefixo do seu credenciado. Desmarque algum, se não quiser a ficha dele.
3. Preencha os campos gerais: data do levantamento, equipamento e tipo de marco.
4. Abra cada marco e escreva a localização e o acesso.
5. Clique em **Gerar monografia de todos os marcos** (ou da seleção).
6. Baixe o DOCX. Cada marco ocupa uma página.

O arquivo sai sobre o modelo do seu escritório: cabeçalho, rodapé e margens são os do seu memorial descritivo. Se o escritório ainda não enviou modelo, o sistema aplica o timbre automático, com logo, marca d’água e rodapé com os dados da empresa. Como é DOCX, dá para ajustar alguma ficha no Word antes de entregar.

## Como colocar a assinatura do RT nos documentos?

A assinatura do responsável técnico entra pelo cadastro do RT. Em **Configurações**, no cadastro de responsáveis técnicos, você envia a imagem da assinatura. A partir daí, os documentos gerados com aquele RT saem com a assinatura no lugar.

Isso poupa o passo de imprimir, assinar e escanear cada peça. Duas observações honestas:

- A imagem da assinatura não é assinatura digital ICP-Brasil. Quando o cartório ou o órgão pede assinatura com certificado digital, ela continua sendo feita à parte.
- Se o RT sair do escritório, apague o cadastro dele. A imagem vai junto, porque sem o RT ela não serve para nada.

As peças que costumam sair assinadas estão no post sobre [documentos do georreferenciamento para o cartório](/blog/pecas-tecnicas-georreferenciamento-cartorio/).

## O que é o QR Code de autenticidade na planta?

O QR de autenticidade é um código impresso na planta que abre uma página pública de verificação do documento. Quem recebe a planta (cartório, banco, comprador, prefeitura) aponta o celular e confirma que aquela planta foi emitida pelo seu escritório.

A página mostra só os campos públicos do documento:

- código de verificação e tipo do documento;
- denominação do imóvel, município e UF;
- área e perímetro;
- folha da planta;
- empresa e responsável técnico com registro;
- data de emissão.

**Nenhum CPF aparece**, nem do proprietário nem de ninguém. A planta circula entre muita gente, e a LGPD pede cuidado com dado pessoal; a página foi feita para confirmar o documento sem expor o dono.

### Como conferir se o PDF não foi alterado?

A página de verificação também compara o arquivo. Quem tem o PDF em mãos pode soltá-lo na página: o navegador calcula a impressão digital do arquivo (SHA-256) e compara com a registrada na emissão. Se bater, o arquivo é o mesmo que saiu do sistema. Se alguém mexeu em uma vírgula, não bate.

O arquivo não é enviado para lugar nenhum nessa conferência. O cálculo acontece no próprio navegador de quem confere.

Se existir uma versão mais nova do documento, a página avisa. Isso resolve um problema real: o cliente leva ao cartório a planta da versão 1, e a versão 2, corrigida, já existe. Quem confere fica sabendo.

A planta de conferência (a prévia, antes dos códigos oficiais) aparece marcada como prévia, para ninguém confundir com o documento final. Os detalhes da planta estão em [planta de georreferenciamento A1 e A3](/blog/planta-georreferenciamento-a1-a3/).

### O que o QR não faz

O QR prova a origem e a integridade do arquivo. Ele não certifica o imóvel, não substitui a certificação do INCRA e não vale como registro. Quem certifica é o INCRA, pelo SIGEF; quem registra é o cartório. O QR só garante que o papel na mão de alguém é o mesmo que você emitiu.

## Resumo para o dia a dia

1. Cadastre o RT com a imagem da assinatura uma vez.
2. Gere os documentos do serviço com os códigos oficiais.
3. Preencha localização e acesso de cada marco e gere a monografia em DOCX.
4. Entregue a planta com o QR; quem receber confere sozinho.

Se quiser ver a monografia e a página de verificação com um serviço seu, [agende uma demonstração](/#contato).
