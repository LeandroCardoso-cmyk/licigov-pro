/**
 * JSON CANÔNICO determinístico (hardening P0 — base dos digests de fontes).
 *
 * Chaves de objeto ordenadas recursivamente; arrays preservam a ordem (quem chama ordena os conjuntos de
 * forma determinística); `undefined` omitido; números finitos apenas. Mesma entrada lógica ⇒ mesmos bytes.
 */
import { createHash } from "crypto";

export type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [k: string]: CanonicalValue | undefined };

export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: número não finito");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as CanonicalValue)}`).join(",")}}`;
}

export function canonicalDigest(value: CanonicalValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Recorte de documento efetivamente CONSUMIDO pela autoria (cobertura explícita e auditável). */
export interface DocumentExcerpt {
  readonly text: string;
  readonly coverage: "full" | "partial";
  readonly totalChars: number;
  readonly usedChars: number;
  /** Títulos das seções representadas no recorte (todas, em ordem). */
  readonly sections: readonly string[];
}

/**
 * Seleção SECTION-AWARE e determinística do documento para o contexto da autoria:
 *  - cabe no orçamento → documento integral (`full`);
 *  - não cabe → TODAS as seções são representadas (título + início do corpo), com orçamento igual por
 *    seção; marcação explícita do que foi omitido (`partial`). Nunca afirma consumo integral quando não há.
 */
export function selectDocumentExcerpt(content: string, maxChars: number): DocumentExcerpt {
  const text = (content ?? "").trim();
  const headingRe = /^#{1,6}\s+(.+)$/;
  const lines = text.split("\n");
  const sectionTitles = lines.map((l) => headingRe.exec(l)?.[1]?.trim()).filter((t): t is string => !!t);
  if (text.length <= maxChars) {
    return { text, coverage: "full", totalChars: text.length, usedChars: text.length, sections: sectionTitles };
  }
  // Seções: [título?, corpo]. Conteúdo antes do 1º título vira seção sem título.
  const sections: Array<{ heading: string | null; body: string[] }> = [{ heading: null, body: [] }];
  for (const l of lines) {
    if (headingRe.test(l)) sections.push({ heading: l, body: [] });
    else sections[sections.length - 1].body.push(l);
  }
  const nonEmpty = sections.filter((s) => s.heading !== null || s.body.join("\n").trim() !== "");
  const headingChars = nonEmpty.reduce((a, s) => a + (s.heading ? s.heading.length + 1 : 0), 0);
  const perSection = Math.max(80, Math.floor(Math.max(0, maxChars - headingChars) / Math.max(1, nonEmpty.length)));
  const out: string[] = [];
  for (const s of nonEmpty) {
    if (s.heading) out.push(s.heading);
    const body = s.body.join("\n").trim();
    if (!body) continue;
    out.push(body.length <= perSection ? body : `${body.slice(0, perSection).trimEnd()} …[seção resumida: ${body.length - perSection} caractere(s) omitido(s)]`);
  }
  const excerpt = out.join("\n");
  return { text: excerpt, coverage: "partial", totalChars: text.length, usedChars: excerpt.length, sections: sectionTitles };
}
