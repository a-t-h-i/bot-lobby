/**
 * The diff library's themes, Pierre's own only: the library's full collection
 * also packs dozens of Shiki themes the viewer never uses. Vite points
 * "@pierre/theming/themes" here (see `vite.config.ts`).
 */
export { pierreThemes } from "../../../../node_modules/@pierre/theming/dist/collections/pierre.js"

/** No Shiki themes: a name the Pierre collection does not hold is refused as unknown. */
export const shikiThemes = { getTheme: (_name: string): undefined => undefined }
