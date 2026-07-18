/**
 * Lista os modelos Gemini disponíveis para a GEMINI_API_KEY (que suportam generateContent).
 * Útil quando um modelo é descontinuado: mostra exatamente o que a sua conta suporta → você define
 * o escolhido em AI_MODEL (sem mudança de código).
 *
 * Uso: GEMINI_API_KEY="..." pnpm ai:models
 */

interface GeminiModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('❌ GEMINI_API_KEY não definido. Ex.: GEMINI_API_KEY="..." pnpm ai:models');
    process.exit(2);
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1000`);
  if (!res.ok) {
    console.error(`Falha ao consultar a API (${res.status}):`, await res.text());
    process.exit(2);
  }
  const data = (await res.json()) as { models?: GeminiModel[] };
  const models = (data.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"));

  console.info(`\n=== Modelos Gemini disponíveis para esta chave (${models.length}) — suportam generateContent ===\n`);
  for (const m of models) {
    const id = String(m.name ?? "").replace(/^models\//, "");
    console.info(`  ${id}${m.displayName ? `   (${m.displayName})` : ""}`);
  }
  const sample = models[0] ? String(models[0].name).replace(/^models\//, "") : "gemini-flash-latest";
  console.info(`\nDefina o escolhido na variável AI_MODEL (ex.: AI_MODEL=${sample}).`);
  console.info("Dica: aliases como 'gemini-flash-latest' / 'gemini-pro-latest' se auto-atualizam e evitam descontinuações.");
}

main().catch((e) => { console.error("Falha ao listar modelos:", e instanceof Error ? e.message : e); process.exit(2); });
