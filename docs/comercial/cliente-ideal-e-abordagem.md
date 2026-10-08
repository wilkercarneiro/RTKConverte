# Cliente ideal, abordagem e demonstração

> Material de venda do Vértice. Preços e nomes de clientes não entram aqui sem decisão/autorização do dono.

## Cliente ideal (um parágrafo)

Escritório pequeno de topografia e georreferenciamento rural (1 a 5 pessoas, um ou dois responsáveis técnicos credenciados no INCRA), no interior do Nordeste e Centro-Oeste, que certifica de 3 a 30 imóveis por mês no SIGEF, já levanta com receptor GNSS RTK e hoje monta memorial, planilha ODS, planta e peças (cartas de anuência, declarações, requerimento) à mão no Word/Excel/CAD — perdendo horas por imóvel e errando código de vértice, azimute ou confrontante. Quem decide é o próprio dono-técnico; a dor que faz comprar é o tempo por processo e o retrabalho quando o SIGEF ou o cartório devolvem.

**Não é o cliente agora:** grandes empresas de agrimensura com sistema próprio, quem só faz topografia urbana, quem não é credenciado (não envia ao SIGEF).

## Onde achar os 50 primeiros

- Lista pública de **credenciados do INCRA** por UF (SIGEF → credenciados) — filtrar BA/SE/AL/PE/GO/MT.
- Grupos de WhatsApp/Facebook e perfis de Instagram de topógrafos e agrimensores da região.
- Indicação do escritório que já usa (pedir 3 nomes, com autorização).
- Sindicatos/associações regionais de agrimensura, CFT/CREA regionais (eventos).

Planilha mínima de cada lead: nome, escritório, cidade/UF, canal (WhatsApp/Instagram/e-mail), origem, dono no funil, etapa.

## Mensagem de primeiro contato (WhatsApp/Instagram)

> Olá, [nome]! Aqui é o [seu nome], do Vértice. Fizemos um sistema para escritório de georreferenciamento: você envia o TXT do receptor e ele devolve memorial descritivo, planilha do SIGEF, planta e as peças técnicas prontas, com os códigos dos vértices já numerados. Já está em uso num escritório, com mais de 600 documentos gerados. Posso te mostrar em 15 minutos, com um levantamento de exemplo? Qual dia fica melhor?

Seguimento (3 dias depois, sem resposta):

> [nome], deixo um vídeo de 1 minuto mostrando do TXT ao memorial: [link]. Se fizer sentido, marco uma demonstração rápida.

## Perguntas de qualificação (antes ou no começo da demo)

1. Quantos imóveis vocês certificam por mês no SIGEF?
2. Quem monta hoje memorial, planilha e peças? Quanto tempo leva por imóvel?
3. Que receptor/software de campo usam? (o Vértice lê o TXT exportado: `ponto;E;N;h;σ`)
4. Já tiveram processo devolvido pelo SIGEF ou cartório por erro de documento? O que foi?
5. Trabalham mais com matrícula ou posse? Com glebas/imóveis cortados por estrada?
6. Quem decide a compra de ferramenta no escritório?

Bom sinal: ≥ 3 imóveis/mês, monta à mão, já teve devolução. Mau sinal: < 1 imóvel/mês ou já tem sistema integrado.

## Roteiro da demonstração (15 minutos)

Use a **conta de demonstração** (dados fictícios — `scripts/seed-demo.mjs`), nunca a de um cliente.

| Minuto | O que mostrar | Frase-chave |
|---|---|---|
| 0–2 | A dor dele (respostas da qualificação) | "Você disse que leva X horas por imóvel. Vamos ver isso com um TXT." |
| 2–5 | Início → Conferência de área → enviar o TXT; fuso detectado, área e perímetro na hora | "Isso é a prévia para o cliente, sem gastar a numeração do credenciado." |
| 5–9 | Serviço completo: dados, confrontantes no próprio vértice, mapa sobre satélite, verificação de sobreposição com o SIGEF | "O confrontante sai igual em todas as peças, porque é cadastrado uma vez." |
| 9–12 | Gerar documentos: memorial DOCX, planilha ODS do SIGEF, planta PDF com códigos oficiais | "A planilha já está no formato de importação do SIGEF." |
| 12–14 | PDF do SIGEF → planta final e as peças (cartas de anuência, declarações, requerimento) com o timbre do escritório | "As peças saem no seu modelo." |
| 14–15 | Próximo passo | "Quer testar com um levantamento seu esta semana? Eu acompanho o primeiro." |

Objeções comuns:
- **"E se o cálculo estiver errado?"** — O motor é testado contra memoriais reais certificados (área, azimute, distância, GMS). Mesmo assim, o RT confere e assina: o Vértice é ferramenta, a responsabilidade técnica é dele.
- **"Meus modelos são diferentes."** — Cada escritório envia os próprios modelos DOCX (Configurações → Modelos).
- **"Meus dados ficam onde?"** — Banco no Brasil (São Paulo), acesso isolado por escritório, política de privacidade publicada.

## Funil (etapas sugeridas para o CRM)

novo → conversa → demo marcada → demo feita → teste com levantamento próprio → proposta → fechado | perdido (com motivo).
