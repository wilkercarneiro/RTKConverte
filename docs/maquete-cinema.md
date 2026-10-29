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
