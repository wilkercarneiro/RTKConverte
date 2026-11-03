// Elevação pela cota real no shader (comum a todas as peças da maquete): o
// exagero vertical, a transição "antes → depois" e o crescimento das casas,
// árvores e objetos são só uniforms. Ver maquete3d.ts.
import * as THREE from "three";

export interface Uniforms {
  uExag: { value: number };
  uRef: { value: number };
  uBase: { value: number };
  uMistura: { value: number };
  uMisturaCor: { value: number };
  uCresce: { value: number };
}

// ---------------------------------------------------------------------------
// Shaders: altura pela cota real
// ---------------------------------------------------------------------------


export type Tipo = "terreno" | "parede" | "objeto" | "instancia" | "entorno";

export const DECL = `
uniform float uExag; uniform float uRef; uniform float uBase; uniform float uMistura; uniform float uCresce;
attribute float aNat; attribute float aFin; attribute vec2 aGNat; attribute vec2 aGFin;
attribute float aBaixo; attribute float aBase; attribute float aAtraso;
float crescer(float atraso) { float c = clamp(uCresce * 1.7 - atraso * 0.7, 0.0, 1.0); return c * c * (3.0 - 2.0 * c); }
`;

function patchVertice(src: string, tipo: Tipo): string {
  let s = DECL + src;
  if (tipo === "terreno") {
    s = s.replace("#include <beginnormal_vertex>", `
      vec2 gr = mix(aGNat, aGFin, uMistura) * uExag;
      vec3 objectNormal = normalize(vec3(-gr.x, 1.0, gr.y));`);
    s = s.replace("#include <begin_vertex>", `
      vec3 transformed = vec3(position);
      transformed.y = (mix(aNat, aFin, uMistura) - uRef) * uExag;`);
  } else if (tipo === "parede") {
    s = s.replace("#include <begin_vertex>", `
      vec3 transformed = vec3(position);
      transformed.y = aBaixo > 0.5 ? uBase : (mix(aNat, aFin, uMistura) - uRef) * uExag;`);
  } else if (tipo === "entorno") {
    // entorno da paisagem: da borda do relevo (aBaixo = 0) ao plano distante (aBaixo = 1)
    s = s.replace("#include <begin_vertex>", `
      vec3 transformed = vec3(position);
      float yBorda = (mix(aNat, aFin, uMistura) - uRef) * uExag;
      transformed.y = mix(yBorda, (aBase - uRef) * uExag, aBaixo);`);
  } else if (tipo === "objeto") {
    // a fundação (y < 0) acompanha o exagero até o chão; o resto cresce
    s = s.replace("#include <begin_vertex>", `
      vec3 transformed = vec3(position);
      float cr = crescer(aAtraso);
      transformed.y = (position.y < 0.0 ? position.y * uExag : position.y * cr) + (aBase - uRef) * uExag;
      if (cr < 0.01) transformed.y -= 10000.0;`);
  } else {
    const inst = `
      vec4 POS = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        POS = instanceMatrix * POS;
        vec3 pe_POS = vec3(instanceMatrix[3].x, 0.0, instanceMatrix[3].z);
        float cr_POS = crescer(aAtraso);
        POS.xyz = pe_POS + (POS.xyz - pe_POS) * cr_POS;
        if (cr_POS < 0.01) POS.y -= 10000.0;
      #endif
      POS.y += (aBase - uRef) * uExag;`;
    s = s.replace("#include <project_vertex>", `${inst.replace(/POS/g, "mvPosition")}
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
    s = s.replace("#include <worldpos_vertex>", `
      #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
        ${inst.replace(/POS/g, "worldPosition")}
        worldPosition = modelMatrix * worldPosition;
      #endif`);
  }
  return s;
}

export function elevar<M extends THREE.Material>(mat: M, tipo: Tipo, U: Uniforms, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void): M {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = patchVertice(sh.vertexShader, tipo);
    extra?.(sh);
  };
  mat.customProgramCacheKey = () => `elevar-${tipo}`;
  return mat;
}

/** Material de sombra com a mesma elevação (senão a sombra fica no lugar errado). */
export function sombraDe(tipo: Tipo, U: Uniforms): THREE.MeshDepthMaterial {
  return elevar(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), tipo, U);
}
