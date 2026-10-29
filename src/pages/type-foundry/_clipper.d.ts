// clipper-lib ships no types; this declares only the union the casting step uses.
declare module 'clipper-lib' {
  interface IntPoint {
    X: number;
    Y: number;
  }
  type Paths = IntPoint[][];
  class Clipper {
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: Paths, subjFill: number, clipFill: number): boolean;
  }
  const ClipperLib: {
    Clipper: typeof Clipper;
    PolyType: { ptSubject: number; ptClip: number };
    ClipType: { ctUnion: number };
    PolyFillType: { pftNonZero: number };
  };
  export default ClipperLib;
}
