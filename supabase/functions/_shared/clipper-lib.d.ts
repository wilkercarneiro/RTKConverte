// clipper-lib (porta JS do Clipper 6.4.2) não publica tipos.
// Declaração mínima: o módulo é usado com tipos locais em sobreposicao.ts.
declare module "clipper-lib" {
  // deno-lint-ignore no-explicit-any
  const ClipperLib: any;
  export default ClipperLib;
}
