export type Lang = "en" | "fr";

const dict = {
  loading: { en: "Loading REM schedule...", fr: "Chargement des horaires REM..." },
  title: { en: "REM Montréal", fr: "REM Montréal" },
  trains: { en: "trains", fr: "trains" },
  moreInfo: { en: "More info →", fr: "Plus d'infos →" },
  fullMap: { en: "🗺", fr: "🗺" },
  zoomIn: { en: "🔍", fr: "🔍" },
  northbound: { en: "↑ Northbound", fr: "↑ Direction nord" },
  southbound: { en: "↓ Southbound", fr: "↓ Direction sud" },
  estimated: { en: "Estimated positions based on schedule", fr: "Positions estimées selon l'horaire" },
  nearest: { en: "📍 Nearest", fr: "📍 Proche" },
  southTerminal: { en: "A1 — South Terminal", fr: "A1 — Terminus sud" },
  northTerminal: { en: "A4 — North Terminal", fr: "A4 — Terminus nord" },
  noTrains: { en: "No upcoming trains", fr: "Aucun train à venir" },
  tapStation: { en: "Tap a station to see departures", fr: "Touchez une station pour voir les départs" },
  now: { en: "now", fr: "maint." },
  min: { en: "min", fr: "min" },
  m: { en: "m", fr: "m" },
} as const;

type Key = keyof typeof dict;

export function t(key: Key, lang: Lang): string {
  return dict[key][lang];
}

export function detectLang(): Lang {
  if (typeof navigator === "undefined") return "fr";
  const navLang = navigator.language || (navigator as any).userLanguage || "";
  return navLang.toLowerCase().startsWith("en") ? "en" : "fr";
}
