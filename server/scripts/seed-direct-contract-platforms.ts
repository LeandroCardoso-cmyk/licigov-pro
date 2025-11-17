import { drizzle } from "drizzle-orm/mysql2";
import { platforms, platformChecklists } from "../../drizzle/schema";

/**
 * Script de seed para popular plataformas e checklists de contratações diretas
 * Execução: tsx server/scripts/seed-direct-contract-platforms.ts
 */

async function seedDirectContractPlatforms() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL não configurada");
    process.exit(1);
  }

  const db = drizzle(process.env.DATABASE_URL);

  console.log("🌱 Populando plataformas de contratações diretas...\n");

  // 1. Inserir plataformas
  const platformsData = [
    {
      name: "ComprasNet (Governo Federal)",
      slug: "comprasnet",
      description: "Portal de Compras do Governo Federal - Sistema oficial para contratações diretas federais",
      websiteUrl: "https://www.gov.br/compras/pt-br",
      config: JSON.stringify({
        requiresLogin: true,
        supportedTypes: ["dispensa", "inexigibilidade"],
        requiresCertificate: true,
      }),
      hasApiIntegration: false,
      isActive: true,
      displayOrder: 1,
    },
    {
      name: "BLL - Bolsa de Licitações e Leilões",
      slug: "bll",
      description: "Plataforma privada para publicação de licitações e contratações diretas",
      websiteUrl: "https://www.bll.org.br",
      config: JSON.stringify({
        requiresLogin: true,
        supportedTypes: ["dispensa", "inexigibilidade"],
        requiresCertificate: false,
      }),
      hasApiIntegration: false,
      isActive: true,
      displayOrder: 2,
    },
    {
      name: "PNCP - Portal Nacional de Contratações Públicas",
      slug: "pncp",
      description: "Portal oficial para publicação obrigatória de todas as contratações públicas (Lei 14.133/2021)",
      websiteUrl: "https://pncp.gov.br",
      config: JSON.stringify({
        requiresLogin: true,
        supportedTypes: ["dispensa", "inexigibilidade"],
        requiresCertificate: true,
        isMandatory: true, // Publicação obrigatória
      }),
      hasApiIntegration: true,
      apiBaseUrl: "https://pncp.gov.br/api",
      apiAuthType: "api_key" as const,
      apiDocumentationUrl: "https://pncp.gov.br/api/docs",
      isActive: true,
      displayOrder: 0, // Primeiro por ser obrigatório
    },
    {
      name: "Nenhuma (Modo Presencial)",
      slug: "none",
      description: "Contratação direta sem plataforma eletrônica - Apenas modo presencial",
      websiteUrl: null,
      config: JSON.stringify({
        requiresLogin: false,
        supportedTypes: ["dispensa", "inexigibilidade"],
        presentialOnly: true,
      }),
      hasApiIntegration: false,
      isActive: true,
      displayOrder: 99,
    },
  ];

  console.log("Inserindo plataformas...");
  const insertedPlatforms = await db.insert(platforms).values(platformsData).$returningId();
  console.log(`✅ ${insertedPlatforms.length} plataformas inseridas\n`);

  // Buscar IDs das plataformas inseridas
  const allPlatforms = await db.select().from(platforms);
  const comprasnet = allPlatforms.find((p) => p.slug === "comprasnet");
  const bll = allPlatforms.find((p) => p.slug === "bll");
  const pncp = allPlatforms.find((p) => p.slug === "pncp");
  const none = allPlatforms.find((p) => p.slug === "none");

  // 2. Inserir checklists por plataforma
  const checklistsData = [];

  // ComprasNet
  if (comprasnet) {
    checklistsData.push(
      {
        platformId: comprasnet.id,
        stepNumber: 1,
        title: "Cadastro no ComprasNet",
        description: "Realizar cadastro do órgão no Portal de Compras do Governo Federal com certificado digital",
        fields: JSON.stringify([
          { name: "cnpj", label: "CNPJ do Órgão", copyFrom: "organization.cnpj" },
          { name: "certificado", label: "Certificado Digital A1 ou A3", copyFrom: null },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Cadastro",
        isOptional: false,
      },
      {
        platformId: comprasnet.id,
        stepNumber: 2,
        title: "Criar Processo de Contratação Direta",
        description: "Acessar o menu 'Contratações Diretas' e criar novo processo",
        fields: JSON.stringify([
          { name: "numero", label: "Número do Processo", copyFrom: "contract.number" },
          { name: "tipo", label: "Tipo (Dispensa/Inexigibilidade)", copyFrom: "contract.type" },
          { name: "artigo", label: "Artigo Legal", copyFrom: "contract.legalArticle" },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Dados Básicos",
        isOptional: false,
      },
      {
        platformId: comprasnet.id,
        stepNumber: 3,
        title: "Anexar Documentos Obrigatórios",
        description: "Upload dos documentos exigidos pela plataforma",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([
          { type: "termo_dispensa", filename: "TERMO_DISPENSA.pdf" },
          { type: "justificativa", filename: "JUSTIFICATIVA.pdf" },
          { type: "cotacoes", filename: "COTACOES.pdf" },
        ]),
        category: "Upload de Documentos",
        isOptional: false,
      },
      {
        platformId: comprasnet.id,
        stepNumber: 4,
        title: "Publicar no PNCP",
        description: "Após aprovação interna, publicar obrigatoriamente no Portal Nacional de Contratações Públicas",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([]),
        category: "Publicação",
        isOptional: false,
      }
    );
  }

  // BLL
  if (bll) {
    checklistsData.push(
      {
        platformId: bll.id,
        stepNumber: 1,
        title: "Cadastro na BLL",
        description: "Criar conta do órgão na plataforma BLL",
        fields: JSON.stringify([
          { name: "cnpj", label: "CNPJ do Órgão", copyFrom: "organization.cnpj" },
          { name: "email", label: "E-mail do Responsável", copyFrom: "user.email" },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Cadastro",
        isOptional: false,
      },
      {
        platformId: bll.id,
        stepNumber: 2,
        title: "Criar Aviso de Contratação Direta",
        description: "Preencher formulário de contratação direta na plataforma",
        fields: JSON.stringify([
          { name: "objeto", label: "Objeto da Contratação", copyFrom: "contract.object" },
          { name: "valor", label: "Valor Estimado", copyFrom: "contract.value" },
          { name: "fundamentacao", label: "Fundamentação Legal", copyFrom: "contract.legalArticle" },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Dados Básicos",
        isOptional: false,
      },
      {
        platformId: bll.id,
        stepNumber: 3,
        title: "Anexar Documentos",
        description: "Upload dos documentos da contratação",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([
          { type: "termo", filename: "TERMO.pdf" },
          { type: "justificativa", filename: "JUSTIFICATIVA.pdf" },
        ]),
        category: "Upload de Documentos",
        isOptional: false,
      },
      {
        platformId: bll.id,
        stepNumber: 4,
        title: "Publicar no PNCP",
        description: "Publicação obrigatória no Portal Nacional de Contratações Públicas",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([]),
        category: "Publicação",
        isOptional: false,
      }
    );
  }

  // PNCP
  if (pncp) {
    checklistsData.push(
      {
        platformId: pncp.id,
        stepNumber: 1,
        title: "Credenciamento no PNCP",
        description: "Realizar credenciamento do órgão no Portal Nacional com certificado digital",
        fields: JSON.stringify([
          { name: "cnpj", label: "CNPJ do Órgão", copyFrom: "organization.cnpj" },
          { name: "certificado", label: "Certificado Digital", copyFrom: null },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Cadastro",
        isOptional: false,
      },
      {
        platformId: pncp.id,
        stepNumber: 2,
        title: "Incluir Contratação Direta",
        description: "Acessar 'Contratações Diretas' e incluir novo processo",
        fields: JSON.stringify([
          { name: "numero_controle", label: "Número de Controle Interno", copyFrom: "contract.number" },
          { name: "modalidade", label: "Modalidade (Dispensa/Inexigibilidade)", copyFrom: "contract.type" },
          { name: "amparo_legal", label: "Amparo Legal", copyFrom: "contract.legalArticle" },
          { name: "objeto", label: "Objeto Resumido", copyFrom: "contract.object" },
          { name: "valor_estimado", label: "Valor Estimado", copyFrom: "contract.value" },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Dados Básicos",
        isOptional: false,
      },
      {
        platformId: pncp.id,
        stepNumber: 3,
        title: "Anexar Documentos Obrigatórios",
        description: "Upload dos documentos exigidos pela Lei 14.133/2021",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([
          { type: "termo", filename: "TERMO_CONTRATACAO_DIRETA.pdf" },
          { type: "justificativa", filename: "JUSTIFICATIVA_TECNICA.pdf" },
          { type: "cotacoes", filename: "COTACOES_PRECOS.pdf" },
          { type: "ata_ratificacao", filename: "ATA_RATIFICACAO.pdf" },
        ]),
        category: "Upload de Documentos",
        isOptional: false,
      },
      {
        platformId: pncp.id,
        stepNumber: 4,
        title: "Publicar Contratação",
        description: "Revisar e publicar a contratação direta no PNCP",
        fields: JSON.stringify([
          { name: "data_publicacao", label: "Data de Publicação", copyFrom: null },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Publicação",
        isOptional: false,
      }
    );
  }

  // Nenhuma (Modo Presencial)
  if (none) {
    checklistsData.push(
      {
        platformId: none.id,
        stepNumber: 1,
        title: "Preparar Documentação Física",
        description: "Imprimir e organizar todos os documentos da contratação direta",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([
          { type: "termo", filename: "TERMO_DISPENSA_INEXIGIBILIDADE.pdf" },
          { type: "justificativa", filename: "JUSTIFICATIVA.pdf" },
          { type: "cotacoes", filename: "COTACOES.pdf" },
          { type: "mapa_comparativo", filename: "MAPA_COMPARATIVO.pdf" },
        ]),
        category: "Documentação",
        isOptional: false,
      },
      {
        platformId: none.id,
        stepNumber: 2,
        title: "Obter Aprovação Interna",
        description: "Submeter processo para aprovação da autoridade competente",
        fields: JSON.stringify([
          { name: "autoridade", label: "Autoridade Competente", copyFrom: null },
          { name: "data_aprovacao", label: "Data da Aprovação", copyFrom: null },
        ]),
        requiredDocuments: JSON.stringify([]),
        category: "Aprovação",
        isOptional: false,
      },
      {
        platformId: none.id,
        stepNumber: 3,
        title: "Publicar no PNCP",
        description: "Publicação obrigatória no Portal Nacional de Contratações Públicas (Lei 14.133/2021)",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([]),
        category: "Publicação",
        isOptional: false,
      },
      {
        platformId: none.id,
        stepNumber: 4,
        title: "Arquivar Processo Físico",
        description: "Organizar e arquivar processo físico conforme normas do órgão",
        fields: JSON.stringify([]),
        requiredDocuments: JSON.stringify([]),
        category: "Arquivamento",
        isOptional: false,
      }
    );
  }

  console.log("Inserindo checklists...");
  await db.insert(platformChecklists).values(checklistsData);
  console.log(`✅ ${checklistsData.length} checklists inseridos\n`);

  console.log("🎉 Seed concluído com sucesso!");
  process.exit(0);
}

// Executar seed
seedDirectContractPlatforms().catch((error) => {
  console.error("❌ Erro ao executar seed:", error);
  process.exit(1);
});
