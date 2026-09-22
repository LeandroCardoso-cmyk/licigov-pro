/**
 * CONTRATO MONETÁRIO CANÔNICO (BRL) do Processo Licitatório.
 *
 * Convenção ÚNICA (auditoria monetária P0):
 *   - PERSISTÊNCIA canônica (price_research_items.value, intelligent_items.average_price, …) é DECIMAL(14,2)
 *     em REAIS (ex.: 18.90). NUNCA centavos nessas colunas. Dividir esses valores por 100 é um bug.
 *   - CÁLCULO autoritativo (médias, total por item, total global) é feito em CENTAVOS INTEIROS — sem float
 *     imprevisível. A conversão reais↔centavos acontece só nas bordas (leitura/escrita/formatação).
 *   - Arredondamento: HALF-UP (meio centavo arredonda para cima, em valor absoluto), aplicado UMA vez no
 *     resultado de cada operação (média, quantidade × preço). Soma de centavos é exata.
 *   - Moeda: BRL. Nada aqui inventa moeda nem valor; entrada ambígua retorna `null` (exige revisão humana).
 *
 * Puro e determinístico (sem IO, sem Intl/locale do ambiente).
 */

/** Centavos inteiros (safe integer). DECIMAL(14,2) máximo = 99.999.999.999.999 centavos < 2^53. */
export type Cents = number;

/** Resultado de parse com motivo, para exibir ao revisor quando o valor não é confiável. */
export interface MoneyParse {
  readonly cents: Cents | null;
  readonly reason: "ok" | "empty" | "ambiguous" | "invalid";
}

/** Converte string decimal canônica ("1234.567", "-3.1") em centavos com arredondamento half-up. */
function decimalStringToCents(s: string): Cents | null {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const negative = m[1] === "-";
  const intPart = m[2];
  const frac = (m[3] ?? "").padEnd(3, "0");
  const cents2 = frac.slice(0, 2);
  const third = Number(frac[2]);
  let value = BigInt(intPart) * 100n + BigInt(cents2);
  if (third >= 5) value += 1n; // half-up (em valor absoluto)
  const n = Number(value);
  if (!Number.isSafeInteger(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse ESTRITO de valor monetário brasileiro. Aceita "R$ 1.234,56", "1234,56", "18,90", "18.90",
 * "1.234" (milhar pt-BR → 1234,00), "1234". Retorna `ambiguous` para formas que não podem ser decididas
 * sem contexto (ex.: "1,234" — milhar en-US ou decimal com 3 casas) e `invalid` para texto não numérico.
 */
export function parseBRLDetailed(input: string | number | null | undefined): MoneyParse {
  if (input === null || input === undefined) return { cents: null, reason: "empty" };
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { cents: null, reason: "invalid" };
    // Número já em REAIS. toFixed(3) + half-up em string evita o erro de float (1.005*100 = 100.4999…).
    const cents = decimalStringToCents(input.toFixed(3));
    return cents === null ? { cents: null, reason: "invalid" } : { cents, reason: "ok" };
  }
  let s = input.replace(/ /g, " ").trim();
  if (s === "") return { cents: null, reason: "empty" };
  s = s.replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  let negative = false;
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { cents: null, reason: "invalid" };

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let canonical: string;
  if (hasComma && hasDot) {
    // O ÚLTIMO separador é o decimal; o outro é milhar.
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    const decSep = lastComma > lastDot ? "," : ".";
    const thouSep = decSep === "," ? "." : ",";
    const [intRaw, fracRaw, ...rest] = s.split(decSep);
    if (rest.length > 0) return { cents: null, reason: "invalid" };
    const intDigits = intRaw.split(thouSep);
    // Milhar bem-formado: primeiro grupo 1-3 dígitos, demais exatamente 3.
    if (!intDigits.every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)))) {
      return { cents: null, reason: "invalid" };
    }
    canonical = `${intDigits.join("")}.${fracRaw}`;
  } else if (hasComma) {
    // Só vírgula: pt-BR decimal ("18,90"). "1,234"/"12,345,678" é ambíguo (milhar en-US?).
    if (/^\d{1,3}(,\d{3})+$/.test(s)) return { cents: null, reason: "ambiguous" };
    const parts = s.split(",");
    if (parts.length !== 2) return { cents: null, reason: "invalid" };
    canonical = `${parts[0] || "0"}.${parts[1]}`;
  } else if (hasDot) {
    // Só ponto: "1.234" / "12.500.000" = milhar pt-BR (inteiro); "18.90" = decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) canonical = s.replace(/\./g, "");
    else {
      const parts = s.split(".");
      if (parts.length !== 2) return { cents: null, reason: "invalid" };
      canonical = `${parts[0] || "0"}.${parts[1]}`;
    }
  } else {
    canonical = s;
  }
  const cents = decimalStringToCents(canonical);
  if (cents === null) return { cents: null, reason: "invalid" };
  return { cents: negative ? -cents : cents, reason: "ok" };
}

/** Parse monetário (centavos) ou `null` quando vazio/ambíguo/inválido. */
export function parseBRL(input: string | number | null | undefined): Cents | null {
  return parseBRLDetailed(input).cents;
}

/**
 * Lê um valor persistido em DECIMAL(14,2) (REAIS — string do driver ou número) para centavos.
 * NÃO divide por 100: a coluna já está em reais.
 */
export function reaisToCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === "") return 0;
  const c = decimalStringToCents(typeof value === "number" ? value.toFixed(3) : String(value).trim());
  return c ?? 0;
}

/** Centavos → string DECIMAL canônica em REAIS ("1234.56") para gravar em DECIMAL(14,2). */
export function centsToDecimalString(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${s}` : s;
}

/** Centavos → número em reais (2 casas) — apenas para superfícies que exigem `number` (ex.: JSON legado). */
export function centsToReais(cents: Cents): number {
  return Number(centsToDecimalString(cents));
}

/** Formatação pt-BR DETERMINÍSTICA ("R$ 1.234,56"), independente do locale do servidor. */
export function formatBRL(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const c = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${reais},${c}`;
}

/** Soma exata de centavos. */
export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((a, v) => a + v, 0);
}

/** Média com arredondamento HALF-UP em centavos (inteiro). Lista vazia → 0. */
export function averageCents(values: readonly Cents[]): Cents {
  if (values.length === 0) return 0;
  const sum = BigInt(sumCents(values));
  const n = BigInt(values.length);
  const negative = sum < 0n;
  const abs = negative ? -sum : sum;
  const rounded = (2n * abs + n) / (2n * n); // floor((abs + n/2) / n) → half-up
  return Number(negative ? -rounded : rounded);
}

/**
 * Quantidade (DECIMAL(14,3)) × preço unitário (centavos) → total em centavos, HALF-UP, sem float.
 * A quantidade é normalizada para milésimos exatos antes da multiplicação.
 */
export function multiplyQuantityCents(quantity: number | string, unitCents: Cents): Cents {
  let qStr = typeof quantity === "number" ? quantity.toFixed(3) : String(quantity).trim();
  // Quantidade textual pt-BR ("2,5") — só vírgula decimal, sem milhar (quantidades não usam separador).
  if (typeof quantity !== "number" && qStr.includes(",") && !qStr.includes(".")) qStr = qStr.replace(",", ".");
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(qStr);
  if (!m) return 0;
  const frac = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
  const qMilli = BigInt(m[2]) * 1000n + BigInt(frac);
  const product = qMilli * BigInt(Math.abs(unitCents));
  const rounded = (2n * product + 1000n) / 2000n; // /1000 half-up
  const negative = (m[1] === "-") !== (unitCents < 0);
  const n = Number(rounded);
  return negative && n !== 0 ? -n : n;
}
