/**
 * Script para popular banco de dados com plataformas de pregão eletrônico
 * Execução: tsx server/scripts/seedPlatforms.ts
 */

import { getDb } from "../db";
import { platforms, platformTemplates, platformChecklists } from "../../drizzle/schema";

async function seedPlatforms() {
  console.log("🌱 Iniciando seed de plataformas...");

  const db = await getDb();
  if (!db) {
    console.error("❌ Erro: Banco de dados não disponível");
    process.exit(1);
  }

  try {
    // 1. Inserir plataformas
    console.log("\n📦 Inserindo plataformas...");
    
    const platformsData = [
      {
        name: "Compras.gov.br",
        slug: "compras-gov-br",
        description: "Portal Nacional de Contratações Públicas do Governo Federal. Plataforma oficial para pregões eletrônicos federais.",
        websiteUrl: "https://www.gov.br/compras/pt-br",
        config: JSON.stringify({
          requiresLogin: true,
          supportedModalities: ["pregao", "concorrencia", "dispensa", "inexigibilidade"],
          hasApi: true,
          apiDocUrl: "https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-dados-abertos"
        }),
        hasApiIntegration: false, // Será true no Nível 3
        apiBaseUrl: "https://compras.dados.gov.br/api/v1",
        apiAuthType: "api_key" as const,
        apiDocumentationUrl: "https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-dados-abertos/manual-api-compras.pdf",
        isActive: true,
        displayOrder: 1
      },
      {
        name: "BLL Compras",
        slug: "bll-compras",
        description: "Bolsa de Licitações e Leilões. Uma das maiores plataformas privadas de licitações eletrônicas do Brasil.",
        websiteUrl: "https://bllcompras.org.br",
        config: JSON.stringify({
          requiresLogin: true,
          supportedModalities: ["pregao", "concorrencia", "tomada_precos"],
          pncpIntegrated: true,
          requiresAnnexNaming: true,
          annexFormat: "ANEXO_I_TR.pdf"
        }),
        hasApiIntegration: false,
        isActive: true,
        displayOrder: 2
      },
      {
        name: "Licitanet",
        slug: "licitanet",
        description: "Plataforma de licitações eletrônicas com ampla cobertura nacional. Utilizada por diversos municípios e estados.",
        websiteUrl: "https://portal.licitanet.com.br",
        config: JSON.stringify({
          requiresLogin: true,
          supportedModalities: ["pregao", "concorrencia", "tomada_precos", "convite"],
          hasLiveChat: true
        }),
        hasApiIntegration: false,
        isActive: true,
        displayOrder: 3
      },
      {
        name: "BBMNet",
        slug: "bbmnet",
        description: "Plataforma moderna de licitações eletrônicas. Especializada em pregões eletrônicos e conformidade com a Nova Lei de Licitações.",
        websiteUrl: "https://bbmnet.com.br",
        config: JSON.stringify({
          requiresLogin: true,
          supportedModalities: ["pregao", "concorrencia"],
          lei14133Compliant: true,
          hasTraining: true
        }),
        hasApiIntegration: false,
        isActive: true,
        displayOrder: 4
      },
      {
        name: "Outra Plataforma",
        slug: "outra",
        description: "Opção genérica para outras plataformas não listadas. Gera documentos em formato padrão.",
        websiteUrl: null,
        config: JSON.stringify({
          isGeneric: true,
          supportedModalities: ["pregao", "concorrencia", "tomada_precos", "convite", "dispensa", "inexigibilidade"]
        }),
        hasApiIntegration: false,
        isActive: true,
        displayOrder: 5
      }
    ];

    for (const platform of platformsData) {
      await db.insert(platforms).values(platform);
      console.log(`  ✅ ${platform.name}`);
    }

    console.log("\n✅ Seed concluído com sucesso!");
    console.log("\n📊 Resumo:");
    console.log(`  - ${platformsData.length} plataformas inseridas`);
    console.log("\n💡 Próximos passos:");
    console.log("  1. Executar seedPlatformTemplates.ts para criar templates");
    console.log("  2. Executar seedPlatformChecklists.ts para criar checklists");

  } catch (error) {
    console.error("❌ Erro ao executar seed:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedPlatforms();
