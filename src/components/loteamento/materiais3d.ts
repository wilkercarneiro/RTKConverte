// Materiais das casas com texturas da Poly Haven (CC0), em public/maquete/tex:
// reboco (white_stucco: relevo pela normal), ripado de cedro
// (japanese_cedar_planks: cor, relevo e rugosidade) e concreto da laje
// (concrete_floor_01). As casas são uma malha só, com cor por vértice: o
// reboco e o concreto entram por projeção triplanar no mundo (sem uv), o
// ripado usa o uv em metros que a malha de madeira já tem.
import * as THREE from "three";

export interface TexCasa {
  reboco: THREE.Texture; rebocoN: THREE.Texture;
  cedro: THREE.Texture; cedroN: THREE.Texture; cedroR: THREE.Texture;
  concreto: THREE.Texture;
}

let promessa: Promise<TexCasa | null> | null = null;

export function carregarTexCasa(maxAniso: number): Promise<TexCasa | null> {
  promessa ??= (async () => {
    try {
      const ld = new THREE.TextureLoader();
      const t = (nome: string, cor: boolean) => ld.loadAsync(`/maquete/tex/${nome}.webp`).then((x) => {
        x.wrapS = x.wrapT = THREE.RepeatWrapping;
        x.colorSpace = cor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        x.anisotropy = Math.min(8, maxAniso);
        return x;
      });
      const [reboco, rebocoN, cedro, cedroN, cedroR, concreto] = await Promise.all([
        t("white_stucco_diffuse", false), t("white_stucco_nor_gl", false),
        t("japanese_cedar_planks_diffuse", true), t("japanese_cedar_planks_nor_gl", false), t("japanese_cedar_planks_rough", false),
        t("concrete_floor_01_diffuse", false),
      ]);
      return { reboco, rebocoN, cedro, cedroN, cedroR, concreto };
    } catch (e) {
      console.warn("texturas das casas indisponíveis", e);
      promessa = null;
      return null;
    }
  })();
  return promessa;
}

/** Uniforms das texturas triplanares (ligam quando as texturas chegam). */
export function uniformsCasa() {
  return {
    tReb: { value: null as THREE.Texture | null },
    tRebN: { value: null as THREE.Texture | null },
    tCon: { value: null as THREE.Texture | null },
    uTexCasa: { value: 0 },
  };
}
export type UniformsCasa = ReturnType<typeof uniformsCasa>;

/**
 * Acrescenta o triplanar a um material já "elevado" (o vértice da maquete).
 * `modo` 0 = parede (reboco com relevo), 1 = laje (concreto).
 */
export function triplanar(sh: THREE.WebGLProgramParametersWithUniforms, U: UniformsCasa, modo: 0 | 1): void {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = "varying vec3 vTpW; varying vec3 vTpN;\n" + sh.vertexShader.replace("#include <fog_vertex>", `#include <fog_vertex>
    vTpW = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vTpN = normalize(mat3(modelMatrix) * objectNormal);`);
  sh.fragmentShader = `varying vec3 vTpW; varying vec3 vTpN;
    uniform sampler2D tReb; uniform sampler2D tRebN; uniform sampler2D tCon; uniform float uTexCasa;
    vec2 tpUv(vec3 p, vec3 n) { vec3 a = abs(n); return a.y > max(a.x, a.z) ? p.xz : a.x > a.z ? p.zy : p.xy; }
    ` + sh.fragmentShader
    .replace("#include <map_fragment>", `#include <map_fragment>
      float tpPerto = 0.0;
      if (uTexCasa > 0.5) {
        tpPerto = 1.0 - smoothstep(60.0, 260.0, length(vViewPosition));
        ${modo === 0
          // reboco: quase branco; o que conta é a variação (manchas leves e textura do chapisco)
          ? `float l = texture2D(tReb, tpUv(vTpW, vTpN) / 1.6).r;
             float manchas = texture2D(tReb, tpUv(vTpW, vTpN) / 9.0 + 0.37).r;
             diffuseColor.rgb *= mix(1.0, (0.86 + 0.16 * l) * (0.94 + 0.08 * manchas), tpPerto);`
          : `float l = texture2D(tCon, vTpW.xz / 2.5).r;
             diffuseColor.rgb *= mix(1.0, 0.72 + 0.55 * l, tpPerto);`}
      }`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      ${modo === 0 ? `if (uTexCasa > 0.5 && tpPerto > 0.0) {
        vec3 nG = normalize(vTpN) * faceDirection;
        vec3 a = abs(nG);
        vec3 T = a.y > max(a.x, a.z) ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), nG));
        vec3 B = cross(nG, T);
        vec3 nt = texture2D(tRebN, tpUv(vTpW, vTpN) / 1.6).xyz * 2.0 - 1.0;
        nt.xy *= 1.6 * tpPerto;
        vec3 nW = normalize(T * nt.x + B * nt.y + nG * nt.z);
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }` : ""}`);
}
