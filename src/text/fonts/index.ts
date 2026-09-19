/** The bundled faces (spec M10 §5). Imported through Vite so they are content-hashed into
 *  `dist/assets/` and inherit the immutable caching — never hand-placed in `public/`, which is
 *  what invariant 35 exists to prevent. Each is fetched on first use, not at load.
 *
 *  All four are SIL OFL 1.1; their licences ship beside them as `<face>-OFL.txt`, which the
 *  licence requires, and are credited in the README. */
import antonUrl from "./Anton-Regular.ttf?url";
import archivoUrl from "./ArchivoBlack-Regular.ttf?url";
import bebasUrl from "./BebasNeue-Regular.ttf?url";
import righteousUrl from "./Righteous-Regular.ttf?url";

export type BundledFont = { id: string; label: string; url: string };

export const BUNDLED: readonly BundledFont[] = [
  { id: "anton", label: "Anton", url: antonUrl },
  { id: "bebas-neue", label: "Bebas Neue", url: bebasUrl },
  { id: "archivo-black", label: "Archivo Black", url: archivoUrl },
  { id: "righteous", label: "Righteous", url: righteousUrl },
];
