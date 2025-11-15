/**
 * Script para popular checklists detalhados das 5 plataformas
 * Executar: pnpm tsx server/scripts/seedChecklists.ts
 */

import { drizzle } from "drizzle-orm/mysql2";
import { platformChecklists, platforms } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL!);

async function seedChecklists() {
  console.log("🌱 Iniciando seed de checklists...");

  // Buscar IDs das plataformas
  const allPlatforms = await db.select().from(platforms);
  const platformMap = Object.fromEntries(
    allPlatforms.map(p => [p.slug, p.id])
  );

  // Limpar checklists existentes
  await db.delete(platformChecklists);
  console.log("✅ Checklists antigos removidos");

  // ============================================
  // COMPRAS.GOV.BR - Portal Nacional de Contratações Públicas
  // ============================================
  const comprasGovChecklist = [
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 1,
      title: "Acesse o Portal Nacional de Contratações Públicas (PNCP)",
      description: "Faça login no PNCP com certificado digital da instituição",
      category: "Acesso",
      fields: [
        { label: "URL", value: "https://pncp.gov.br" },
        { label: "Tipo de Acesso", value: "Certificado Digital e-CPF ou e-CNPJ" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 2,
      title: "Cadastre o Processo Licitatório",
      description: "Preencha dados básicos do processo no módulo de Licitações",
      category: "Cadastro",
      fields: [
        { label: "Modalidade", value: "Pregão Eletrônico" },
        { label: "Tipo", value: "Menor Preço" },
        { label: "Forma de Disputa", value: "Aberto" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 3,
      title: "Informe a UASG",
      description: "Código da Unidade Administrativa de Serviços Gerais",
      category: "Cadastro",
      fields: [
        { label: "UASG", value: "[Informar UASG da sua instituição]" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 4,
      title: "Anexe o Edital",
      description: "Upload do edital em formato PDF, máximo 10MB",
      category: "Documentos",
      fields: [],
      requiredDocuments: [
        { type: "edital", filename: "EDITAL_[PROCESSO].pdf" },
      ],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 5,
      title: "Anexe o Termo de Referência",
      description: "Upload do TR em formato PDF",
      category: "Documentos",
      fields: [],
      requiredDocuments: [
        { type: "tr", filename: "ANEXO_I_TERMO_REFERENCIA.pdf" },
      ],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 6,
      title: "Anexe o Estudo Técnico Preliminar",
      description: "Upload do ETP em formato PDF",
      category: "Documentos",
      fields: [],
      requiredDocuments: [
        { type: "etp", filename: "ANEXO_II_ETP.pdf" },
      ],
      isOptional: true,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 7,
      title: "Cadastre os Itens com CATMAT/CATSER",
      description: "Vincule cada item ao código CATMAT (materiais) ou CATSER (serviços)",
      category: "Itens",
      fields: [
        { label: "Formato", value: "Planilha XLSX ou cadastro manual" },
        { label: "Campos obrigatórios", value: "Código CATMAT/CATSER, Descrição, Unidade, Quantidade, Valor Unitário" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 8,
      title: "Configure Critérios de Sustentabilidade",
      description: "Se aplicável, marque critérios de sustentabilidade conforme Decreto 11.462/2023",
      category: "Configurações",
      fields: [],
      requiredDocuments: [],
      isOptional: true,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 9,
      title: "Defina Data e Horário da Sessão",
      description: "Horário de Brasília obrigatório, mínimo 8 dias úteis de antecedência",
      category: "Agendamento",
      fields: [
        { label: "Prazo mínimo", value: "8 dias úteis" },
        { label: "Horário", value: "Horário de Brasília (UTC-3)" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 10,
      title: "Vincule ao SICAF",
      description: "Sistema de Cadastramento Unificado de Fornecedores",
      category: "Configurações",
      fields: [
        { label: "Habilitação", value: "Automática via SICAF" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 11,
      title: "Publique no PNCP",
      description: "Publicação automática no Portal Nacional de Contratações Públicas",
      category: "Publicação",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["compras-gov-br"],
      stepNumber: 12,
      title: "Aguarde Homologação",
      description: "Processo será homologado automaticamente após validações",
      category: "Publicação",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
  ];

  // ============================================
  // BLL COMPRAS - Bolsa de Licitações e Leilões
  // ============================================
  const bllChecklist = [
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 1,
      title: "Acesse a Plataforma BLL Compras",
      description: "Login com usuário e senha fornecidos pela BLL",
      category: "Acesso",
      fields: [
        { label: "URL", value: "https://www.bllcompras.org.br" },
        { label: "Suporte", value: "suporte@bllcompras.org.br" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 2,
      title: "Crie Novo Pregão Eletrônico",
      description: "Menu: Licitações > Novo Pregão",
      category: "Cadastro",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 3,
      title: "Preencha Dados Básicos",
      description: "Número do processo, objeto, valor estimado",
      category: "Cadastro",
      fields: [
        { label: "Formato do Número", value: "XXX/AAAA" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 4,
      title: "Anexe Documentos",
      description: "Upload de edital, TR, ETP e outros anexos",
      category: "Documentos",
      fields: [
        { label: "Formato de Anexos", value: "ANEXO_I_TR.pdf, ANEXO_II_MINUTA_CONTRATO.pdf" },
      ],
      requiredDocuments: [
        { type: "edital", filename: "EDITAL.pdf" },
        { type: "tr", filename: "ANEXO_I_TR.pdf" },
      ],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 5,
      title: "Cadastre Itens",
      description: "Importar planilha ou cadastrar manualmente",
      category: "Itens",
      fields: [
        { label: "Formato de Importação", value: "XLSX (modelo BLL)" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 6,
      title: "Configure Disputa de Lances",
      description: "Tipo de disputa, intervalo mínimo entre lances, modo de disputa",
      category: "Configurações",
      fields: [
        { label: "Intervalo Mínimo", value: "3 segundos (recomendado)" },
        { label: "Modo de Disputa", value: "Aberto ou Fechado" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 7,
      title: "Defina Data e Horário",
      description: "Agendar sessão pública de lances",
      category: "Agendamento",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 8,
      title: "Revise e Publique",
      description: "Revisar todos os dados antes de publicar",
      category: "Publicação",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bll-compras"],
      stepNumber: 9,
      title: "Integração Automática com PNCP",
      description: "BLL publica automaticamente no Portal Nacional",
      category: "Publicação",
      fields: [
        { label: "Integração", value: "Automática (100% integrado ao PNCP)" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
  ];

  // ============================================
  // LICITANET
  // ============================================
  const licitanetChecklist = [
    {
      platformId: platformMap["licitanet"],
      stepNumber: 1,
      title: "Acesse o Portal Licitanet",
      description: "Login com usuário e senha",
      category: "Acesso",
      fields: [
        { label: "URL", value: "https://portal.licitanet.com.br" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["licitanet"],
      stepNumber: 2,
      title: "Cadastre Nova Licitação",
      description: "Menu: Licitações > Nova Licitação",
      category: "Cadastro",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["licitanet"],
      stepNumber: 3,
      title: "Preencha Informações do Processo",
      description: "Dados básicos: número, objeto, modalidade, valor",
      category: "Cadastro",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["licitanet"],
      stepNumber: 4,
      title: "Anexe Documentos",
      description: "Upload de edital e anexos em PDF",
      category: "Documentos",
      fields: [],
      requiredDocuments: [
        { type: "edital", filename: "EDITAL.pdf" },
        { type: "tr", filename: "TERMO_REFERENCIA.pdf" },
      ],
      isOptional: false,
    },
    {
      platformId: platformMap["licitanet"],
      stepNumber: 5,
      title: "Cadastre Lotes e Itens",
      description: "Importar planilha ou cadastrar manualmente",
      category: "Itens",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["licitanet"],
      stepNumber: 6,
      title: "Configure Sessão de Lances",
      description: "Tipo de disputa e regras de lances",
      category: "Configurações",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["licitanet"],
      stepNumber: 7,
      title: "Agende Data e Horário",
      description: "Definir data/hora da sessão pública",
      category: "Agendamento",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["licitanet"],
      stepNumber: 8,
      title: "Publique a Licitação",
      description: "Revisar e publicar no portal",
      category: "Publicação",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
  ];

  // ============================================
  // BBMNET
  // ============================================
  const bbmnetChecklist = [
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 1,
      title: "Acesse a Plataforma BBMNet",
      description: "Login com certificado digital ou usuário/senha",
      category: "Acesso",
      fields: [
        { label: "URL", value: "https://www.bbmnet.com.br" },
        { label: "Suporte", value: "suporte@bbmnet.com.br" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 2,
      title: "Crie Novo Processo",
      description: "Menu: Processos > Novo Pregão Eletrônico",
      category: "Cadastro",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 3,
      title: "Preencha Dados do Processo",
      description: "Informações básicas conforme Lei 14.133/2021",
      category: "Cadastro",
      fields: [
        { label: "Conformidade", value: "Lei 14.133/2021" },
      ],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 4,
      title: "Anexe Edital e Documentos",
      description: "Upload de todos os documentos necessários",
      category: "Documentos",
      fields: [],
      requiredDocuments: [
        { type: "edital", filename: "EDITAL.pdf" },
        { type: "tr", filename: "TERMO_REFERENCIA.pdf" },
      ],
      isOptional: false,
    },
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 5,
      title: "Cadastre Itens",
      description: "Importar ou cadastrar itens manualmente",
      category: "Itens",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 6,
      title: "Configure Sessão Eletrônica",
      description: "Parâmetros da disputa de lances",
      category: "Configurações",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 7,
      title: "Agende a Sessão",
      description: "Definir data e horário da sessão pública",
      category: "Agendamento",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["bbmnet"],
      stepNumber: 8,
      title: "Publique o Pregão",
      description: "Revisar e publicar na plataforma",
      category: "Publicação",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
  ];

  // ============================================
  // OUTRA PLATAFORMA (Genérico)
  // ============================================
  const outraChecklist = [
    {
      platformId: platformMap["outra"],
      stepNumber: 1,
      title: "Acesse a Plataforma",
      description: "Faça login na plataforma de licitação eletrônica",
      category: "Acesso",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["outra"],
      stepNumber: 2,
      title: "Cadastre o Processo",
      description: "Preencha dados básicos do processo licitatório",
      category: "Cadastro",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["outra"],
      stepNumber: 3,
      title: "Anexe Documentos",
      description: "Upload de edital, TR, ETP e outros anexos",
      category: "Documentos",
      fields: [],
      requiredDocuments: [
        { type: "edital", filename: "EDITAL.pdf" },
        { type: "tr", filename: "TERMO_REFERENCIA.pdf" },
      ],
      isOptional: false,
    },
    {
      platformId: platformMap["outra"],
      stepNumber: 4,
      title: "Cadastre Itens",
      description: "Importar ou cadastrar itens manualmente",
      category: "Itens",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
    {
      platformId: platformMap["outra"],
      stepNumber: 5,
      title: "Configure e Publique",
      description: "Revisar configurações e publicar o processo",
      category: "Publicação",
      fields: [],
      requiredDocuments: [],
      isOptional: false,
    },
  ];

  // Inserir todos os checklists
  const allChecklists = [
    ...comprasGovChecklist,
    ...bllChecklist,
    ...licitanetChecklist,
    ...bbmnetChecklist,
    ...outraChecklist,
  ];

  for (const checklist of allChecklists) {
    await db.insert(platformChecklists).values({
      ...checklist,
      fields: JSON.stringify(checklist.fields),
      requiredDocuments: JSON.stringify(checklist.requiredDocuments),
    });
  }

  console.log(`✅ ${allChecklists.length} checklists inseridos com sucesso!`);
  console.log(`   - Compras.gov.br: ${comprasGovChecklist.length} passos`);
  console.log(`   - BLL Compras: ${bllChecklist.length} passos`);
  console.log(`   - Licitanet: ${licitanetChecklist.length} passos`);
  console.log(`   - BBMNet: ${bbmnetChecklist.length} passos`);
  console.log(`   - Outra: ${outraChecklist.length} passos`);
  console.log("🎉 Seed concluído!");

  process.exit(0);
}

seedChecklists().catch((error) => {
  console.error("❌ Erro ao executar seed:", error);
  process.exit(1);
});
