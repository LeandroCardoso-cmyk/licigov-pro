/**
 * Sprint 2.8 — Canonical Unit Registry.
 *
 * Normalização oficial de unidades de medida para CATMAT/ItemTR.
 * Suporta aliases PT-BR, plural, abreviações, typos comuns.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type UnitCategory =
  | "count"       // UN, UND, ITEM
  | "package"     // CX, PCT, EMB, FARDO
  | "weight"      // KG, G, T
  | "volume"      // L, ML, M³
  | "length"      // M, CM, MM
  | "area"        // M², HA
  | "time"        // H, DIA, MES, ANO
  | "service"     // SVC, SERV (intangível)
  | "other";

export interface UnitEntry {
  canonical:   string;       // forma canônica oficial (e.g. "UN")
  aliases:     string[];     // todas as formas reconhecidas (uppercase)
  category:    UnitCategory;
  description: string;
}

export interface UnitNormalizationResult {
  canonical:   string | null;
  confidence:  number;        // 0–1
  matched:     boolean;
  source:      "exact" | "alias" | "fuzzy" | "none";
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY: UnitEntry[] = [
  {
    canonical:   "UN",
    aliases:     ["UN", "UND", "UNID", "UNIDADE", "UNIDADES", "UNID.", "UN.", "UNI",
                  "ITEM", "ITENS", "PEÇA", "PEÇAS", "PCA", "PCE", "EXEMPLAR", "EXEMPLARES"],
    category:    "count",
    description: "Unidade",
  },
  {
    canonical:   "CX",
    aliases:     ["CX", "CXA", "CAIXA", "CAIXAS", "BOX", "BX"],
    category:    "package",
    description: "Caixa",
  },
  {
    canonical:   "PCT",
    aliases:     ["PCT", "PACOTE", "PACOTES", "PAC", "PACK"],
    category:    "package",
    description: "Pacote",
  },
  {
    canonical:   "EMB",
    aliases:     ["EMB", "EMBALAGEM", "EMBALAGENS", "EMB.", "EMBAL"],
    category:    "package",
    description: "Embalagem",
  },
  {
    canonical:   "FD",
    aliases:     ["FD", "FARDO", "FARDOS"],
    category:    "package",
    description: "Fardo",
  },
  {
    canonical:   "KG",
    aliases:     ["KG", "QUILO", "QUILOS", "QUILOGRAMA", "QUILOGRAMAS", "KILO", "KILOGRAMA"],
    category:    "weight",
    description: "Quilograma",
  },
  {
    canonical:   "G",
    aliases:     ["G", "GR", "GRAMA", "GRAMAS"],
    category:    "weight",
    description: "Grama",
  },
  {
    canonical:   "T",
    aliases:     ["T", "TON", "TONELADA", "TONELADAS"],
    category:    "weight",
    description: "Tonelada",
  },
  {
    canonical:   "L",
    aliases:     ["L", "LT", "LIT", "LITRO", "LITROS", "LITRO(S)"],
    category:    "volume",
    description: "Litro",
  },
  {
    canonical:   "ML",
    aliases:     ["ML", "MILILITRO", "MILILITROS"],
    category:    "volume",
    description: "Mililitro",
  },
  {
    canonical:   "M3",
    aliases:     ["M3", "M³", "METRO CÚBICO", "METROS CÚBICOS"],
    category:    "volume",
    description: "Metro cúbico",
  },
  {
    canonical:   "M",
    aliases:     ["M", "MT", "METRO", "METROS", "ML"],   // ML também pode ser metro linear
    category:    "length",
    description: "Metro",
  },
  {
    canonical:   "CM",
    aliases:     ["CM", "CENTIMETRO", "CENTÍMETRO", "CENTIMETROS", "CENTÍMETROS"],
    category:    "length",
    description: "Centímetro",
  },
  {
    canonical:   "M2",
    aliases:     ["M2", "M²", "M2.", "METRO QUADRADO", "METROS QUADRADOS", "M.Q."],
    category:    "area",
    description: "Metro quadrado",
  },
  {
    canonical:   "HA",
    aliases:     ["HA", "HECTARE", "HECTARES"],
    category:    "area",
    description: "Hectare",
  },
  {
    canonical:   "H",
    aliases:     ["H", "HR", "HORA", "HORAS", "H.", "HRS"],
    category:    "time",
    description: "Hora",
  },
  {
    canonical:   "DIA",
    aliases:     ["DIA", "DIAS", "D", "DAY"],
    category:    "time",
    description: "Dia",
  },
  {
    canonical:   "MES",
    aliases:     ["MES", "MÊS", "MESES", "MO", "MONTH"],
    category:    "time",
    description: "Mês",
  },
  {
    canonical:   "ANO",
    aliases:     ["ANO", "ANOS", "ANO(S)", "YEAR"],
    category:    "time",
    description: "Ano",
  },
  {
    canonical:   "SV",
    aliases:     ["SV", "SVC", "SERV", "SERVIÇO", "SERVIÇOS", "SERVICO", "SERVICOS"],
    category:    "service",
    description: "Serviço",
  },
  {
    canonical:   "VB",
    aliases:     ["VB", "VBA", "VERBA", "VERBAS", "GLOBAL"],
    category:    "other",
    description: "Verba / Global",
  },
  {
    canonical:   "CONJ",
    aliases:     ["CONJ", "CONJUNTO", "CONJUNTOS", "KIT", "KITS"],
    category:    "package",
    description: "Conjunto / Kit",
  },
  {
    canonical:   "PAR",
    aliases:     ["PAR", "PARES"],
    category:    "count",
    description: "Par",
  },
  {
    canonical:   "ROL",
    aliases:     ["ROL", "ROLO", "ROLOS"],
    category:    "package",
    description: "Rolo",
  },
  {
    canonical:   "RESMA",
    aliases:     ["RESMA", "RESMAS"],
    category:    "package",
    description: "Resma",
  },
];

// ─── Lookup maps (built once) ─────────────────────────────────────────────────

const ALIAS_MAP = new Map<string, UnitEntry>();
for (const entry of REGISTRY) {
  for (const alias of entry.aliases) {
    ALIAS_MAP.set(alias.toUpperCase(), entry);
  }
}

// ─── Normalize ────────────────────────────────────────────────────────────────

export function normalizeUnit(raw: string | null | undefined): UnitNormalizationResult {
  if (!raw || raw.trim() === "") {
    return { canonical: null, confidence: 0, matched: false, source: "none" };
  }

  const cleaned = raw.trim().toUpperCase().replace(/[.\s]+$/, "");

  // Exact match
  const exact = ALIAS_MAP.get(cleaned);
  if (exact) {
    const isCanonical = exact.canonical === cleaned;
    return {
      canonical:  exact.canonical,
      confidence: isCanonical ? 1.0 : 0.95,
      matched:    true,
      source:     isCanonical ? "exact" : "alias",
    };
  }

  // Fuzzy: strip trailing dots, numbers, parens
  const fuzzy = cleaned.replace(/[\d().]+/g, "").trim();
  if (fuzzy && fuzzy !== cleaned) {
    const fuzzyMatch = ALIAS_MAP.get(fuzzy);
    if (fuzzyMatch) {
      return { canonical: fuzzyMatch.canonical, confidence: 0.75, matched: true, source: "fuzzy" };
    }
  }

  // Partial match: if cleaned starts with a known alias prefix
  for (const [alias, entry] of ALIAS_MAP) {
    if (alias.length >= 2 && cleaned.startsWith(alias)) {
      return { canonical: entry.canonical, confidence: 0.60, matched: true, source: "fuzzy" };
    }
  }

  return { canonical: null, confidence: 0, matched: false, source: "none" };
}

export function getUnitEntry(canonical: string): UnitEntry | undefined {
  return REGISTRY.find(e => e.canonical === canonical);
}

export function listCanonicalUnits(): UnitEntry[] {
  return [...REGISTRY];
}

export function listUnitsByCategory(category: UnitCategory): UnitEntry[] {
  return REGISTRY.filter(e => e.category === category);
}
