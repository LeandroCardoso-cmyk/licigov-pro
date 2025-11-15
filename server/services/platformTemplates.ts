/**
 * Serviço de templates específicos por plataforma
 * Adapta documentos (ETP, TR, DFD, Edital) para requisitos de cada plataforma
 */

import * as db from "../db";

/**
 * Instruções base de adaptação por plataforma
 * Estas instruções são injetadas nos prompts da IA para adaptar documentos
 */
const PLATFORM_INSTRUCTIONS: Record<string, {
  general: string;
  etp?: string;
  tr?: string;
  dfd?: string;
  edital?: string;
  terminology?: Record<string, string>;
  mandatoryClauses?: string[];
}> = {
  "compras-gov-br": {
    general: `
Este documento será publicado no Portal Nacional de Contratações Públicas (Compras.gov.br).
Requisitos específicos:
- Seguir rigorosamente a Lei 14.133/2021 e Decreto 11.462/2023
- Incluir número UASG (Unidade Administrativa de Serviços Gerais)
- Referenciar CATMAT/CATSER obrigatoriamente
- Formato de anexos: ANEXO_I, ANEXO_II, etc.
- Incluir link para PNCP (Portal Nacional de Contratações Públicas)
`,
    edital: `
Cláusulas obrigatórias para Compras.gov.br:
- Cláusula de adesão ao PNCP
- Referência ao SICAF (Sistema de Cadastramento Unificado de Fornecedores)
- Procedimento de disputa eletrônica via Compras.gov.br
- Horário de Brasília para todas as datas/horários
- Critérios de sustentabilidade (quando aplicável)
`,
    terminology: {
      "sessão pública": "sessão pública eletrônica",
      "licitante": "fornecedor",
      "proposta": "lance eletrônico",
    },
  },

  "bll-compras": {
    general: `
Este documento será publicado na plataforma BLL Compras (Bolsa de Licitações e Leilões).
Requisitos específicos:
- Plataforma 100% integrada ao PNCP
- Formato de anexos: ANEXO_I_TR.pdf, ANEXO_II_MINUTA_CONTRATO.pdf
- Incluir regulamento da BLL Compras
- Referenciar sistema de lances da BLL
- Mencionar suporte técnico da plataforma
`,
    edital: `
Cláusulas específicas BLL Compras:
- "A disputa de lances será realizada através da plataforma BLL Compras (www.bllcompras.org.br)"
- "Os licitantes deverão estar previamente cadastrados na plataforma BLL"
- "Dúvidas técnicas sobre a plataforma: suporte@bllcompras.org.br"
- "Regulamento completo disponível em: https://bll.org.br/regulamento"
`,
    terminology: {
      "sessão pública": "disputa de lances",
      "sistema eletrônico": "plataforma BLL Compras",
    },
    mandatoryClauses: [
      "DA PLATAFORMA ELETRÔNICA: A presente licitação será realizada através da plataforma BLL Compras, conforme regulamento disponível em www.bllcompras.org.br",
    ],
  },

  "licitanet": {
    general: `
Este documento será publicado na plataforma Licitanet.
Requisitos específicos:
- Plataforma com ampla cobertura nacional
- Sistema de chat ao vivo para dúvidas
- Formato padrão de anexos
- Incluir link de acesso ao pregão
`,
    edital: `
Cláusulas específicas Licitanet:
- "A licitação será processada através do portal Licitanet (portal.licitanet.com.br)"
- "Os licitantes deverão possuir cadastro ativo na plataforma"
- "Suporte técnico disponível via chat durante o horário comercial"
`,
    terminology: {
      "sessão pública": "sessão de lances",
      "sistema eletrônico": "portal Licitanet",
    },
  },

  "bbmnet": {
    general: `
Este documento será publicado na plataforma BBMNet.
Requisitos específicos:
- Plataforma especializada em Lei 14.133/2021
- Sistema moderno e intuitivo
- Treinamento disponível para licitantes
- Conformidade total com a Nova Lei de Licitações
`,
    edital: `
Cláusulas específicas BBMNet:
- "O pregão eletrônico será realizado através da plataforma BBMNet (www.bbmnet.com.br)"
- "Plataforma em conformidade com a Lei 14.133/2021"
- "Treinamento gratuito disponível para novos usuários"
- "Suporte técnico: suporte@bbmnet.com.br"
`,
    terminology: {
      "sessão pública": "sessão eletrônica",
      "sistema eletrônico": "plataforma BBMNet",
    },
  },

  "outra": {
    general: `
Este documento será publicado em plataforma de licitação eletrônica.
Formato genérico seguindo padrões da Lei 14.133/2021.
`,
    edital: `
Cláusulas genéricas:
- "A licitação será realizada em plataforma eletrônica"
- "Os licitantes deverão seguir as instruções da plataforma utilizada"
`,
  },
};

/**
 * Obter instruções de adaptação para uma plataforma
 */
export async function getPlatformInstructions(
  platformId: number | null,
  documentType: "etp" | "tr" | "dfd" | "edital"
): Promise<string> {
  if (!platformId) {
    return ""; // Sem plataforma selecionada, usar formato padrão
  }

  const platform = await db.getPlatformById(platformId);
  if (!platform) {
    return "";
  }

  const instructions = PLATFORM_INSTRUCTIONS[platform.slug];
  if (!instructions) {
    return "";
  }

  // Montar instruções completas
  let fullInstructions = instructions.general;

  // Adicionar instruções específicas do tipo de documento
  if (instructions[documentType]) {
    fullInstructions += "\n\n" + instructions[documentType];
  }

  // Adicionar terminologia específica
  if (instructions.terminology && Object.keys(instructions.terminology).length > 0) {
    fullInstructions += "\n\nTERMINOLOGIA ESPECÍFICA:\n";
    for (const [original, replacement] of Object.entries(instructions.terminology)) {
      fullInstructions += `- Usar "${replacement}" ao invés de "${original}"\n`;
    }
  }

  // Adicionar cláusulas obrigatórias
  if (instructions.mandatoryClauses && instructions.mandatoryClauses.length > 0) {
    fullInstructions += "\n\nCLÁUSULAS OBRIGATÓRIAS:\n";
    instructions.mandatoryClauses.forEach((clause, index) => {
      fullInstructions += `${index + 1}. ${clause}\n`;
    });
  }

  return fullInstructions;
}

/**
 * Aplicar terminologia específica da plataforma em um texto
 */
export async function applyPlatformTerminology(
  text: string,
  platformId: number | null
): Promise<string> {
  if (!platformId) {
    return text;
  }

  const platform = await db.getPlatformById(platformId);
  if (!platform) {
    return text;
  }

  const instructions = PLATFORM_INSTRUCTIONS[platform.slug];
  if (!instructions?.terminology) {
    return text;
  }

  let modifiedText = text;
  for (const [original, replacement] of Object.entries(instructions.terminology)) {
    // Substituir com case-insensitive
    const regex = new RegExp(original, "gi");
    modifiedText = modifiedText.replace(regex, replacement);
  }

  return modifiedText;
}

/**
 * Obter nome formatado de anexo para plataforma
 */
export async function getAnnexFileName(
  platformId: number | null,
  documentType: "etp" | "tr" | "dfd" | "edital",
  processName: string
): Promise<string> {
  const platform = platformId ? await db.getPlatformById(platformId) : null;
  
  // Sanitizar nome do processo (remover caracteres especiais)
  const sanitizedName = processName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  const typeMap = {
    etp: "ETP",
    tr: "TERMO_REFERENCIA",
    dfd: "DFD",
    edital: "EDITAL",
  };

  const typeName = typeMap[documentType];

  // BLL Compras tem formato específico
  if (platform?.slug === "bll-compras") {
    const annexMap = {
      etp: "ANEXO_I_ETP",
      tr: "ANEXO_I_TR",
      dfd: "ANEXO_II_DFD",
      edital: "EDITAL",
    };
    return `${annexMap[documentType]}_${sanitizedName}.pdf`;
  }

  // Formato padrão para outras plataformas
  return `${typeName}_${sanitizedName}.pdf`;
}

/**
 * Gerar metadados de publicação para plataforma
 */
export async function generatePublicationMetadata(
  processId: number,
  platformId: number | null
) {
  const process = await db.getProcessById(processId);
  if (!process) {
    throw new Error("Processo não encontrado");
  }

  const platform = platformId ? await db.getPlatformById(platformId) : null;
  const settings = await db.getDocumentSettingsByUser(process.ownerId);

  return {
    processName: process.name,
    processNumber: process.name, // TODO: Adicionar campo específico para número
    object: process.object,
    estimatedValue: process.estimatedValue ? process.estimatedValue / 100 : 0,
    modality: process.modality,
    category: process.category,
    platform: platform ? {
      name: platform.name,
      slug: platform.slug,
      websiteUrl: platform.websiteUrl,
    } : null,
    organization: {
      name: settings?.organizationName || "Órgão Público",
      cnpj: settings?.cnpj || "",
      address: settings?.address || "",
      phone: settings?.phone || "",
      email: settings?.email || "",
      website: settings?.website || "",
    },
  };
}
