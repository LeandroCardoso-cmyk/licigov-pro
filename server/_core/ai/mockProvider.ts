/**
 * RC-3.5 — Mock AI Provider (determinístico).
 *
 * Implementação do contrato AIProvider sem chamadas externas. Usado em testes e
 * como último recurso do Provider Adapter quando nenhum provider real está
 * configurado. Saída determinística (replay-safe) via sha256.
 */

import { createHash } from "crypto";
import type { AIGenerateOptions, AIGenerateResult, AIProvider } from "./types";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateText(prompt: string): Promise<string> {
    return `mock:${sha256(prompt).slice(0, 24)}`;
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const joined = options.messages.map((m) => `${m.role}:${m.content}`).join("\n");
    const inputTokens = Math.ceil(joined.length / 4);
    // Structured output determinístico: quando um responseSchema com o formato de AUTORIA
    // (properties.sections.items.properties.key.enum) é solicitado, o mock preenche TODAS as keys
    // canônicas com prosa determinística — assim o caminho de cognição real (provider mock, sem chave)
    // exercita o structured authoring sem depender de rede.
    const structured = tryBuildStructuredFromSchema(options.responseSchema?.schema, joined);
    const text = structured ?? `mock:${sha256(joined).slice(0, 24)}`;
    return {
      text,
      finishReason: "stop",
      usage: { inputTokens, outputTokens: 8, totalTokens: inputTokens + 8 },
    };
  }
}

/** Deriva, de forma determinística, um output estruturado de autoria a partir do responseSchema. */
function tryBuildStructuredFromSchema(schema: Record<string, unknown> | undefined, seed: string): string | null {
  if (!schema) return null;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  // Contrato documental de parágrafos (ex.: justificativa do DFD — M8-AI-DFD-001): parágrafos de prosa, sem metadados.
  if (props?.paragrafos && props?.lacunas && props?.avisos) {
    const tag = sha256(seed).slice(0, 12).replace(/\d/g, (d) => "ghijklmnop"[Number(d)]);
    return JSON.stringify({
      paragrafos: [
        `A presente demanda decorre da necessidade descrita no objeto do processo, conforme os fatos registrados pela unidade demandante (rascunho determinístico de teste ${tag}).`,
        "A contratação visa assegurar a continuidade e a qualidade dos serviços prestados, cabendo ao servidor revisar e complementar este texto antes da aprovação.",
      ],
      lacunas: [],
      avisos: ["Rascunho gerado pelo provider de teste (mock) — não representa redação real."],
    });
  }
  const sections = props?.sections as { items?: { properties?: { key?: { enum?: unknown } } } } | undefined;
  const enumKeys = sections?.items?.properties?.key?.enum;
  if (!Array.isArray(enumKeys) || enumKeys.length === 0) return null;
  return JSON.stringify({
    sections: enumKeys.map((k) => ({
      key: String(k),
      contentMode: "provided",
      prose: `Conteúdo determinístico (mock) para a seção ${String(k)}: mock:${sha256(`${seed}:${String(k)}`).slice(0, 16)}.`,
      omissionJustification: "",
      legalReferences: [],
      limitations: [],
    })),
  });
}
