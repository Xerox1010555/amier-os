/**
 * Theme registry — Aurora Glass mood variants.
 *
 * A theme only swaps CSS custom properties on <html data-theme="…">, so
 * switching is instant and safe: layout/motion rules stay untouched. Applied
 * pre-paint by an inline script in index.html (no first-paint flash) and
 * persisted in localStorage under `amier.theme`.
 */
export interface ThemeDef {
  id: string;
  label: { en: string; ar: string };
  /** swatch chips shown in the Settings picker (bg, accent, accent-2) */
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: "aurora", label: { en: "Aurora", ar: "أورورا" }, swatch: ["#04060c", "#6ea8ff", "#7ee3b0"] },
  { id: "emerald", label: { en: "Emerald", ar: "زمرد" }, swatch: ["#03100a", "#45e3a0", "#63d2ff"] },
  { id: "violet", label: { en: "Violet", ar: "بنفسج" }, swatch: ["#0b0513", "#b18cff", "#ff9ad5"] },
  { id: "crimson", label: { en: "Crimson", ar: "قرمز" }, swatch: ["#120408", "#ff8695", "#ffb054"] },
  { id: "mono", label: { en: "Mono", ar: "فولاذ" }, swatch: ["#060709", "#8fb0c9", "#c9d8e5"] },
];

const LS_KEY = "amier.theme";

export function getTheme(): string {
  try {
    return localStorage.getItem(LS_KEY) ?? "aurora";
  } catch {
    return "aurora";
  }
}

export function applyTheme(id: string): void {
  const known = THEMES.some((t) => t.id === id);
  const root = document.documentElement;
  if (id === "aurora" || !known) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* storage unavailable — theme stays for the session only */
  }
}
