// Tipos mínimos da N8AO (o pacote não traz .d.ts): só o que a maquete usa.
declare module "n8ao" {
  import type { Camera, Color, Scene, WebGLRenderTarget } from "three";
  import { Pass } from "three/examples/jsm/postprocessing/Pass.js";

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoSamples: number;
      aoRadius: number;
      denoiseSamples: number;
      denoiseRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      gammaCorrection: boolean;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      screenSpaceRadius: boolean;
    };
    beautyRenderTarget: WebGLRenderTarget;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
}
