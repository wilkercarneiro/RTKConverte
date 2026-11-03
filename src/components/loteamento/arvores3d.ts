// Árvores fotorrealistas da maquete: modelos da Poly Haven (CC0) assados em
// "impostores" (scripts/maquete-arvores/assar.mjs). Cada espécie é um atlas
// de 8×8 vistas (hemisfério octaédrico) com a cor e outro com a normal e a
// profundidade. Na cena cada árvore é UM quadrado virado para a câmera que
// mostra a vista mais próxima da direção do olhar; a normal recebe o sol da
// cena (luz, sombra, céu) e a profundidade escrita deixa a árvore entrar
// atrás das casas e do chão como um objeto de verdade.
import * as THREE from "three";

export interface MetaArvore { N: number; S: number; H: number; cy: number; raioCopa: number }
export interface Especie { id: string; meta: MetaArvore; cor: THREE.Texture; normal: THREE.Texture; flor: THREE.Color | null; tinta?: THREE.Color }

export const ESPECIES = ["rua", "copa", "jacaranda", "conifera", "ipe-amarelo", "ipe-rosa", "arbusto", "arbusto2", "arbusto3"] as const;
export type IdEspecie = (typeof ESPECIES)[number];
/** Atlas assados (o ipê é a árvore de rua com a copa pintada na placa de vídeo). */
const ATLAS = ["rua", "copa", "jacaranda", "conifera", "arbusto", "arbusto2", "arbusto3"] as const;
const IPE: Partial<Record<IdEspecie, [number, number, number]>> = { "ipe-amarelo": [0.98, 0.74, 0.08], "ipe-rosa": [0.86, 0.36, 0.62] };

/**
 * Celular, tablet ou máquina com pouca memória: atlas pela metade (cada um de
 * 3072² com mipmaps ocupa ~50 MB de vídeo; pela metade, ~12 MB).
 */
export function aparelhoModesto(): boolean {
  const toque = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return toque || mem < 8;
}

let promessa: Promise<Map<IdEspecie, Especie> | null> | null = null;

/** Carrega os atlas uma vez por página (a maquete pode abrir e fechar várias vezes). */
export function carregarEspecies(maxAniso: number): Promise<Map<IdEspecie, Especie> | null> {
  promessa ??= (async () => {
    try {
      const metas = (await (await fetch("/maquete/arvores/arvores.json")).json()) as Record<string, MetaArvore>;
      const ld = new THREE.TextureLoader();
      const metade = aparelhoModesto();
      const tex = (url: string, cor: boolean) => ld.loadAsync(url).then((t0) => {
        let t: THREE.Texture = t0;
        const img = t0.image as HTMLImageElement;
        if (metade && cor) {
          const c = Object.assign(document.createElement("canvas"), { width: img.width / 2, height: img.height / 2 });
          c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
          t0.dispose();
          t = new THREE.CanvasTexture(c);
        }
        t.colorSpace = cor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = Math.min(4, maxAniso);
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        return t;
      });
      const atlas = new Map(await Promise.all(ATLAS.map(async (id) => {
        const [cor, normal] = await Promise.all([tex(`/maquete/arvores/${id}-cor.webp`, true), tex(`/maquete/arvores/${id}-normal.webp`, false)]);
        return [id as IdEspecie, { cor, normal }] as const;
      })));
      return new Map(ESPECIES.map((id) => {
        const flor = IPE[id];
        const base: IdEspecie = flor ? "rua" : id;
        const a = atlas.get(base)!;
        // arbusto de jardim: o modelo é verde-oliva seco; o jardim regado é mais verde
        const tinta = id.startsWith("arbusto") ? new THREE.Color(0.82, 1.0, 0.7) : undefined;
        return [id, { id, meta: metas[base], cor: a.cor, normal: a.normal, flor: flor ? new THREE.Color(...flor) : null, tinta }] as const;
      }));
    } catch (e) {
      console.warn("árvores da Poly Haven indisponíveis", e);
      promessa = null;
      return null;
    }
  })();
  return promessa;
}

/**
 * Vértice do impostor (substitui project_vertex e worldpos_vertex). Usa os
 * atributos de instância da maquete (aBase, aAtraso, crescer) e as uniforms
 * de elevação (uExag, uRef). O quadrado (PlaneGeometry 2×2) vira para a
 * câmera; em projeção ortográfica (sombra do sol) vira para a luz.
 */
const VERT_DECL = /* glsl */ `
uniform float uIN; uniform float uIS; uniform float uICy;
varying vec2 vIRot; varying vec3 vIVista; varying vec3 vIMundo; varying float vIEsc; varying vec3 vICentro;
vec2 hemiOct(vec3 d) { d /= abs(d.x) + abs(d.y) + abs(d.z); return vec2(d.x + d.z, d.x - d.z); }
`;
const VERT_CORPO = /* glsl */ `
  float kI = length(instanceMatrix[0].xyz);
  vec2 rotI = vec2(instanceMatrix[0].x, -instanceMatrix[0].z) / kI; // cos, sen do giro
  float crI = crescer(aAtraso);
  float escI = kI * crI;
  vec3 peI = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  vec3 cI = vec3(peI.x, (aBase - uRef) * uExag + uICy * escI, peI.z);
  bool ortoI = projectionMatrix[3][3] > 0.5;
  vec3 vI = ortoI ? normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])) : normalize(cameraPosition - cI);
  vec3 dirI = abs(vI.y) > 0.995 ? vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]) : normalize(cross(vec3(0.0, 1.0, 0.0), vI));
  vec3 cimaI = cross(vI, dirI);
  vec3 pI = cI + (position.x * dirI + position.y * cimaI) * uIS * escI;
  if (crI < 0.01) pI.y -= 10000.0;
  // a vista no referencial da árvore (desfaz o giro da instância)
  vec3 oI = vec3(rotI.x * vI.x - rotI.y * vI.z, max(vI.y, 0.0), rotI.y * vI.x + rotI.x * vI.z);
  vec2 eI = hemiOct(normalize(oI));
  vec2 celI = clamp(floor((eI * 0.5 + 0.5) * uIN), 0.0, uIN - 1.0);
  vec2 uvI = vec2((celI.x + uv.x) / uIN, 1.0 - (celI.y + 1.0 - uv.y) / uIN);
  vIRot = rotI; vIVista = vI; vIMundo = pI; vIEsc = escI; vICentro = cI;
`;

function patchVertice(src: string, decl: string, comMapa: boolean): string {
  let s = decl + VERT_DECL + src;
  s = s.replace("#include <project_vertex>", `${VERT_CORPO}
    ${comMapa ? "vMapUv = uvI;" : ""}
    vec4 mvPosition = viewMatrix * vec4(pI, 1.0);
    gl_Position = projectionMatrix * mvPosition;`);
  s = s.replace("#include <worldpos_vertex>", `
    #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
      vec4 worldPosition = vec4(pI, 1.0);
    #endif`);
  return s;
}

/** Profundidade de verdade a partir do atlas (o quadrado é plano; a copa não). */
const FRAG_PROF = /* glsl */ `
  {
    float tI = (texture2D(tINormal, vMapUv).b - 0.5) * 2.0 * uIS * vIEsc;
    vec4 clipI = projectionMatrix * viewMatrix * vec4(vIMundo + vIVista * tI, 1.0);
    gl_FragDepth = clamp(clipI.z / clipI.w * 0.5 + 0.5, 0.0, 1.0);
  }
`;

/**
 * Cobertura da copa que não some de longe: o mipmap tira a média do alfa das
 * folhas com o fundo vazio e, no teste de alfa, a árvore distante virava
 * esqueleto. O alfa sobe com o nível de mip que a placa de vídeo vai usar.
 */
const ALFA = /* glsl */ `
float alfaCheio(float a, vec2 uv, sampler2D t) {
  vec2 px = uv * vec2(textureSize(t, 0));
  vec2 dx = dFdx(px), dy = dFdy(px);
  float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  return a * (1.0 + mip * 0.32);
}
`;

/** Material da cena (luz, sombra, céu e névoa do three). */
export function materialImpostor(e: Especie, decl: string, uniforms: Record<string, THREE.IUniform>): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: e.cor, alphaTest: 0.42, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, {
      uIN: { value: e.meta.N }, uIS: { value: e.meta.S }, uICy: { value: e.meta.cy }, tINormal: { value: e.normal },
      uIFlor: { value: e.flor ?? new THREE.Color(0, 0, 0) }, uITinta: { value: e.tinta ?? new THREE.Color(1, 1, 1) },
    });
    sh.vertexShader = patchVertice(sh.vertexShader, decl, true);
    sh.fragmentShader = `uniform float uIS; uniform sampler2D tINormal; uniform mat4 projectionMatrix; uniform vec3 uIFlor; uniform vec3 uITinta;
      varying vec2 vIRot; varying vec3 vIVista; varying vec3 vIMundo; varying float vIEsc; varying vec3 vICentro;
      ${ALFA}
      vec3 desOct(vec2 f) { f = f * 2.0 - 1.0; vec3 n = vec3(f.x, 1.0 - abs(f.x) - abs(f.y), f.y);
        float t = max(-n.y, 0.0); n.x += n.x >= 0.0 ? -t : t; n.z += n.z >= 0.0 ? -t : t; return normalize(n); }
      ` + sh.fragmentShader
      // a borda da copa (mipmap mistura com o preto do fundo): divide pelo alfa
      .replace("#include <map_fragment>", `
        vec4 corI = texture2D(map, vMapUv);
        vec3 cI = corI.rgb / max(corI.a, 0.02);
        // ipê: a folha (o que é mais verde que vermelho) vira flor; tronco e galho ficam
        if (uIFlor.r + uIFlor.g + uIFlor.b > 0.0 && cI.g > cI.r * 1.05 && cI.g >= cI.b) {
          cI = clamp(uIFlor * (0.35 + dot(cI, vec3(0.3, 0.55, 0.15)) * 2.6), 0.0, 1.0);
        }
        diffuseColor *= vec4(min(cI * 1.18 * uITinta, 1.0), alfaCheio(corI.a, vMapUv, map));`)
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
        {
          vec3 nO = desOct(texture2D(tINormal, vMapUv).rg);
          vec3 nW = vec3(vIRot.x * nO.x + vIRot.y * nO.z, nO.y, -vIRot.y * nO.x + vIRot.x * nO.z);
          // copa iluminada como um volume: a normal da esfera da copa (do centro ao ponto, pela
          // profundidade do atlas) manda; a do atlas dá o picado das folhas. Só a do atlas, de
          // perto, mostrava os blocos da resolução dela.
          vec4 nAt = texture2D(tINormal, vMapUv);
          vec3 pS = vIMundo + vIVista * (nAt.b - 0.5) * 2.0 * uIS * vIEsc;
          vec3 nS = normalize(pS - vICentro + vec3(0.0, uIS * vIEsc * 0.35, 0.0));
          nW = normalize(mix(nS, nW, 0.38) + vec3(0.0, 0.25, 0.0));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${FRAG_PROF}`);
  };
  m.customProgramCacheKey = () => `impostor-${e.meta.N}`;
  return m;
}

/** Sombra: o quadrado vira para o sol e recorta a copa pelo alfa da vista do sol. */
export function sombraImpostor(e: Especie, decl: string, uniforms: Record<string, THREE.IUniform>): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: e.cor, alphaTest: 0.42 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uIN: { value: e.meta.N }, uIS: { value: e.meta.S }, uICy: { value: e.meta.cy } });
    sh.vertexShader = patchVertice(sh.vertexShader, decl, true);
    sh.fragmentShader = ALFA + sh.fragmentShader.replace("#include <map_fragment>", `
      vec4 corI = texture2D(map, vMapUv);
      diffuseColor.a *= alfaCheio(corI.a, vMapUv, map);`);
  };
  m.customProgramCacheKey = () => `impostor-sombra-${e.meta.N}`;
  return m;
}

/** Espécie de cada árvore da cena (determinística pela posição na lista). */
export function especieDe(a: { tipo: 0 | 1 | 2 | 3; cor: number; altura: number }, i: number): IdEspecie {
  if (a.tipo === 3) { const h = (i * 0.6180339) % 1; return a.altura < 1.2 ? "arbusto2" : h < 0.55 ? "arbusto" : "arbusto3"; }
  if (a.tipo === 1) return "conifera";
  if (a.tipo === 2) return a.cor === 0xf2c230 ? "ipe-amarelo" : "ipe-rosa";
  const h = (i * 0.6180339) % 1;
  if (a.altura > 7.5) return h < 0.4 ? "jacaranda" : h < 0.75 ? "copa" : "rua";
  return h < 0.6 ? "rua" : "copa";
}
