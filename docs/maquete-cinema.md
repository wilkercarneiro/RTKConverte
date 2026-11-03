# Maquete 3D com aspecto de cinema

Plano aprovado pelo Wilker em 2026-10-29. O objetivo é apresentar o loteamento ao
cliente com cara de filme de lançamento, sem perder o que a maquete já faz (relevo
real, transição hoje → projeto, casas, voo, vídeo).

## Decisões de biblioteca

| Pedaço | Escolha | Por quê |
|---|---|---|
| Sombra de contato | `n8ao` (ISC) no `EffectComposer` do three | Reconstrói a normal pela profundidade: funciona com a altura calculada no shader (`elevar`), que quebraria passes com material trocado |
| Bloom, tilt-shift, vinheta | passes do three + um `ShaderPass` próprio | Sem `postprocessing` (pmndrs): ele só aceita three < 0.187 e trocaria o pipeline inteiro |
| Céu e luz ambiente | HDRI "pure sky" da Poly Haven (CC0), série Qwantani: meio-dia, fim de tarde, anoitecer | O mesmo lugar nas três horas: a mistura entre eles acompanha o sol sem trocar de paisagem |
| Texturas de detalhe | Poly Haven (asfalto, calçada) e ambientCG (grama), CC0 | Hospedadas em `public/maquete/` (nada de link direto para o site deles) |
| Entorno | satélite Esri já usado na maquete, num quadro maior | O loteamento deixa de flutuar: a câmera baixa vê a vizinhança até o horizonte |

Descartados: Megascans/Fab (licença em app web pago incerta), `realism-effects`
(parado desde 2023), modelos 3D da Poly Haven (centenas de milhares de triângulos
por árvore), kits Kenney/Quaternius para casas (estilo de jogo).

## Fases

1. **Acabamento** — N8AO (meia resolução, MSAA no alvo), bloom sempre ligado
   (forte só à noite), tilt-shift e vinheta no modo cinema, céu HDRI como luz
   ambiente e reflexo (o vidro das casas passa a refletir o céu).
2. **Cenário** — no voo e na apresentação, a maquete sai do "estúdio": céu HDRI
   no fundo, entorno com satélite até ~9× o raio da gleba, emendado na borda do
   relevo, e névoa de distância na cor do horizonte. Botão Estúdio/Paisagem no
   painel para usar fora do voo.
3. **Materiais** — máscara de materiais pintada junto com o projeto (pista,
   calçada, grama) e textura de detalhe que aparece de perto (some com a
   distância, de longe fica o desenho do projeto).
4. **Voo e apresentação** — tomadas novas (casa modelo em rasante, vista
   zenital girando sobre o miolo, subida final), tilt-shift por tomada, lente
   (FOV) por tomada, legendas em capítulos, cartelas refeitas.
5. **Próximo** (fora desta entrega) — árvores com `@dgreenheck/ez-tree`,
   céu/nuvens volumétricos Takram no voo, botão "Foto de apresentação" com
   `three-gpu-pathtracer`, Google Photorealistic 3D Tiles (precisa de chave paga).

## Desempenho

- Tudo carrega só quando a maquete abre (three já é lazy); HDRI de 1k (~1,1 MB cada).
- A resolução adaptativa existente continua; se o quadro passa de ~40 ms na
  resolução mínima, a N8AO desliga sozinha.
- Gravação de vídeo: mesma pipeline (o vídeo sai igual à tela).

## Biblioteca Poly Haven (2026-11-02)

Pedido do Wilker: usar a Poly Haven para a maquete ficar mais cinematográfica na
apresentação. Tudo CC0, hospedado em `public/maquete/` (nada de link para o site deles).

| Pedaço | Ativo da Poly Haven | Como entra |
|---|---|---|
| Árvores | `tree_small_02` (rua e ipê), `island_tree_01` (copa larga), `jacaranda_tree` (sombra grande), `fir_sapling_medium` nó a (conífera) | **Impostores**: cada modelo (300 mil a 4,7 milhões de triângulos) é assado em 64 vistas (hemisfério octaédrico 8×8). Cor 3072² (webp com alfa) + normal/profundidade 1024² (RG = normal em octaedro, B = profundidade). Na cena, cada árvore é um quadrado que vira para a câmera (para o sol na sombra), escolhe a vista, escreve a profundidade real (entra atrás das casas) e é iluminada como volume (normal da esfera da copa misturada à do atlas). |
| Ipê amarelo e rosa | o mesmo `tree_small_02` | a placa de vídeo pinta a folha (o que é mais verde que vermelho) com a cor da flor; sem atlas próprio |
| Céu do dia | `kloofendal_48d_partly_cloudy_puresky` (cúmulos) | HDR 1k para luz e reflexo; o JPG tonemapeado da Poly Haven, só a metade de cima, em 8192×2048 (4096 no celular) para o fundo — com 1k as nuvens borravam |
| Céu da tarde e anoitecer | `qwantani_late_afternoon_puresky`, `qwantani_dusk_2_puresky` | como antes |
| Reboco das paredes | `white_stucco` (cor + normal) | triplanar no mundo (as casas não têm uv de verdade), relevo pela normal, só de perto |
| Laje | `concrete_floor_01` | triplanar de cima, só de perto |
| Ripado | `japanese_cedar_planks` (cor, normal, rugosidade) | uv em metros da malha de madeira, a textura cobre 1,6 m |

Outros acertos da mesma entrega: vidro semimetálico refletindo o céu (de cima o
reflexo "certo" é o chão escuro do HDRI; o reflexo sobe para o céu), gramado com
manchas grandes e verde menos "de maquete", gradação de filme no passe da lente
(curva S, sombra fria, luz quente; `uGrade`), e a borda da caixa da rua
suavizada no greide (`cena3d.ts`: a máscara por célula deixava a calçada em
escadinha de perto).

**Assar de novo:** `node scripts/maquete-arvores/assar.mjs [id]` baixa os modelos
para `scripts/maquete-arvores/.modelos/` (fora do Git, ~440 MB) e grava
`public/maquete/arvores/`. Usa o Chrome pelo playwright-core (`PLAYWRIGHT_CORE`).
A convenção das vistas (linha 0 no topo, decodificação do octaedro, eixo da câmera
de assar) tem de bater com `arvores3d.ts`.

**Memória de vídeo:** cada atlas de cor de 3072² com mipmaps ocupa ~50 MB; são 4.
Celular/tablet (`pointer: coarse`) ou `deviceMemory < 8` carrega pela metade
(`aparelhoModesto`) e o céu de 4K. O GLB exportado continua com as árvores de
geometria simples (`arvoresGLB`), porque o quadrado com atlas não serve fora daqui.

**Armadilhas:** (1) `projectionMatrix` não existe no fragment shader do three:
declarar; (2) mipmap tira a média do alfa das folhas com o vazio e a árvore
distante vira esqueleto — o alfa sobe com o nível de mip (`alfaCheio`) e a
assadura fecha os furinhos da copa; (3) normal de 128 px por vista mostrava blocos
de perto — a normal da esfera da copa manda; (4) canvas 2D guarda alfa
pré-multiplicado: por isso a normal/profundidade vai em RGB opaco, não no alfa;
(5) `#include` do three só é resolvido depois do `onBeforeCompile`: para mexer no
reflexo, troque o `#include <envmap_physical_pars_fragment>` pelo chunk editado;
(6) material com shader extra precisa de `customProgramCacheKey` próprio (senão
reaproveita o programa de outro material "elevar-objeto").
