import { drizzle } from "drizzle-orm/mysql2";
import { directContractLegalArticles } from "../../drizzle/schema";

const db = drizzle(process.env.DATABASE_URL!);

/**
 * Seed de artigos legais para contratação direta
 * Base: Lei 14.133/2021
 */

const articles = [
  // ========================================
  // ART. 74 - INEXIGIBILIDADE
  // ========================================
  {
    type: "inexigibilidade" as const,
    article: "Art. 74, I",
    inciso: "I",
    summary: "Aquisição de materiais, equipamentos ou gêneros que só possam ser fornecidos por produtor, empresa ou representante comercial exclusivo",
    description: `Art. 74. É inexigível a licitação quando inviável a competição, em especial nos casos de:

I - aquisição de materiais, de equipamentos ou de gêneros diretamente de produtor, de empresa ou de representante comercial exclusivo, desde que vedada a preferência de marca e observados os preços praticados no mercado;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Aquisição de peças originais de veículos com fornecedor exclusivo",
      "Compra de software específico com distribuidor exclusivo no Brasil",
      "Aquisição de equipamento médico de marca específica com representante exclusivo"
    ]),
    requiredDocuments: JSON.stringify([
      "Atestado de exclusividade emitido pelo fabricante",
      "Pesquisa de mercado comprovando exclusividade",
      "Justificativa técnica da necessidade da marca específica",
      "Três orçamentos (quando possível)"
    ]),
    isActive: true,
  },
  {
    type: "inexigibilidade" as const,
    article: "Art. 74, II",
    inciso: "II",
    summary: "Contratação de profissional do setor artístico consagrado pela crítica especializada ou pela opinião pública",
    description: `Art. 74. É inexigível a licitação quando inviável a competição, em especial nos casos de:

II - contratação de profissional do setor artístico, diretamente ou por meio de empresário exclusivo, desde que consagrado pela crítica especializada ou pela opinião pública;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Contratação de cantor famoso para evento municipal",
      "Contratação de grupo teatral renomado",
      "Contratação de artista plástico consagrado para obra pública"
    ]),
    requiredDocuments: JSON.stringify([
      "Currículo do artista comprovando notoriedade",
      "Matérias de imprensa ou premiações",
      "Justificativa da escolha específica",
      "Proposta de preço compatível com mercado"
    ]),
    isActive: true,
  },
  {
    type: "inexigibilidade" as const,
    article: "Art. 74, III",
    inciso: "III",
    summary: "Contratação de serviços técnicos especializados de profissional ou empresa de notória especialização",
    description: `Art. 74. É inexigível a licitação quando inviável a competição, em especial nos casos de:

III - contratação de serviços técnicos especializados, com profissionais ou empresas de notória especialização, vedada a inexigibilidade para serviços de publicidade e divulgação;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Contratação de escritório de advocacia especializado",
      "Contratação de empresa de auditoria renomada",
      "Contratação de consultor técnico especializado",
      "Perícia técnica especializada"
    ]),
    requiredDocuments: JSON.stringify([
      "Comprovação de notória especialização (títulos, publicações, experiência)",
      "Justificativa da singularidade do serviço",
      "Proposta técnica e de preço",
      "Atestados de capacidade técnica"
    ]),
    isActive: true,
  },
  {
    type: "inexigibilidade" as const,
    article: "Art. 74, IV",
    inciso: "IV",
    summary: "Contratação de associação de portadores de deficiência física, sem fins lucrativos",
    description: `Art. 74. É inexigível a licitação quando inviável a competição, em especial nos casos de:

IV - contratação de associação de portadores de deficiência física, sem fins lucrativos e de comprovada idoneidade, para a prestação de serviços ou fornecimento de mão de obra, desde que o preço contratado seja compatível com o praticado no mercado;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Contratação de associação para serviços de limpeza",
      "Contratação de cooperativa de portadores de deficiência para serviços administrativos",
      "Fornecimento de mão de obra especializada por associação"
    ]),
    requiredDocuments: JSON.stringify([
      "Estatuto da associação comprovando natureza sem fins lucrativos",
      "Comprovação de idoneidade",
      "Pesquisa de preço de mercado",
      "Proposta de preço"
    ]),
    isActive: true,
  },

  // ========================================
  // ART. 75 - DISPENSA (Seleção dos principais)
  // ========================================
  {
    type: "dispensa" as const,
    article: "Art. 75, I",
    inciso: "I",
    summary: "Contratação de até R$ 50.000 (serviços e compras) ou R$ 100.000 (obras e serviços de engenharia)",
    description: `Art. 75. É dispensável a licitação:

I - para contratação que envolva valores inferiores a R$ 50.000,00 (cinquenta mil reais), no caso de obras e serviços de engenharia ou de serviços de manutenção de veículos automotores;

II - para contratação que envolva valores inferiores a R$ 100.000,00 (cem mil reais), no caso de compras e demais serviços não incluídos no inciso I deste caput;`,
    valueLimit: 10000000, // R$ 100.000 em centavos (limite maior)
    examples: JSON.stringify([
      "Compra de material de escritório no valor de R$ 30.000",
      "Contratação de serviço de manutenção predial no valor de R$ 45.000",
      "Aquisição de equipamentos de informática no valor de R$ 80.000"
    ]),
    requiredDocuments: JSON.stringify([
      "Três orçamentos de fornecedores distintos",
      "Justificativa da escolha do fornecedor",
      "Pesquisa de preço de mercado",
      "DFD (Documento de Formalização da Demanda)"
    ]),
    isActive: true,
  },
  {
    type: "dispensa" as const,
    article: "Art. 75, III",
    inciso: "III",
    summary: "Situação de emergência ou calamidade pública",
    description: `Art. 75. É dispensável a licitação:

III - nos casos de guerra, estado de defesa, estado de sítio, intervenção federal ou de grave perturbação da ordem ou de calamidade pública;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Contratação emergencial para reparos após enchente",
      "Aquisição de medicamentos durante pandemia",
      "Contratação de serviços de resgate em desastre natural"
    ]),
    requiredDocuments: JSON.stringify([
      "Decreto de calamidade pública ou emergência",
      "Justificativa da urgência",
      "Proposta de preço",
      "Termo de Dispensa"
    ]),
    isActive: true,
  },
  {
    type: "dispensa" as const,
    article: "Art. 75, IV",
    inciso: "IV",
    summary: "Contratação emergencial quando caracterizada urgência de atendimento",
    description: `Art. 75. É dispensável a licitação:

IV - quando caracterizada situação de urgência de atendimento de situação que possa ocasionar prejuízo ou comprometer a segurança de pessoas, obras, serviços, equipamentos e outros bens, públicos ou particulares, e somente para os bens necessários ao atendimento da situação emergencial e para as parcelas de obras e serviços que possam ser concluídas no prazo máximo de 1 (um) ano, contado da data de ocorrência da emergência;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Reparo emergencial em ponte com risco de desabamento",
      "Conserto urgente de sistema de abastecimento de água",
      "Manutenção emergencial de equipamento hospitalar essencial"
    ]),
    requiredDocuments: JSON.stringify([
      "Laudo técnico comprovando urgência",
      "Justificativa detalhada da situação emergencial",
      "Cronograma de execução (máximo 1 ano)",
      "Proposta de preço"
    ]),
    isActive: true,
  },
  {
    type: "dispensa" as const,
    article: "Art. 75, VIII",
    inciso: "VIII",
    summary: "Aquisição ou locação de imóvel para atender necessidades da Administração",
    description: `Art. 75. É dispensável a licitação:

VIII - para a aquisição ou locação de imóvel cujas características de instalações e de localização tornem necessária sua escolha;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Locação de imóvel para instalação de posto de saúde em bairro específico",
      "Aquisição de imóvel adjacente para ampliação de escola",
      "Locação de imóvel para instalação de órgão público em local estratégico"
    ]),
    requiredDocuments: JSON.stringify([
      "Justificativa técnica da necessidade de localização específica",
      "Avaliação de mercado do imóvel",
      "Laudo de vistoria técnica",
      "Proposta do proprietário"
    ]),
    isActive: true,
  },
  {
    type: "dispensa" as const,
    article: "Art. 75, XII",
    inciso: "XII",
    summary: "Contratação de instituição brasileira de pesquisa, ensino ou desenvolvimento institucional",
    description: `Art. 75. É dispensável a licitação:

XII - para contratação de instituição brasileira incumbida regimental ou estatutariamente da pesquisa, do ensino ou do desenvolvimento institucional ou de instituição dedicada à recuperação social do preso, desde que a contratada detenha inquestionável reputação ético-profissional e não tenha fins lucrativos;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Contratação de universidade pública para pesquisa científica",
      "Contratação de instituto de pesquisa para desenvolvimento de projeto",
      "Contratação de entidade para programa de ressocialização de presos"
    ]),
    requiredDocuments: JSON.stringify([
      "Estatuto ou regimento da instituição",
      "Comprovação de reputação ético-profissional",
      "Comprovação de natureza sem fins lucrativos",
      "Proposta técnica e de preço"
    ]),
    isActive: true,
  },
  {
    type: "dispensa" as const,
    article: "Art. 75, XIII",
    inciso: "XIII",
    summary: "Contratação de coleta, processamento e comercialização de resíduos sólidos por associações ou cooperativas",
    description: `Art. 75. É dispensável a licitação:

XIII - para contratação de associação ou cooperativa de catadores de materiais recicláveis, formada por pessoas físicas de baixa renda reconhecidas pelo poder público como catadores de materiais recicláveis, com o uso de equipamentos compatíveis com as normas técnicas, ambientais e de saúde pública;`,
    valueLimit: null,
    examples: JSON.stringify([
      "Contratação de cooperativa para coleta seletiva",
      "Contratação de associação para processamento de recicláveis",
      "Contratação de catadores para gestão de resíduos sólidos"
    ]),
    requiredDocuments: JSON.stringify([
      "Estatuto da cooperativa ou associação",
      "Comprovação de reconhecimento pelo poder público",
      "Comprovação de equipamentos adequados",
      "Proposta de preço"
    ]),
    isActive: true,
  },
];

async function seed() {
  console.log("🌱 Seeding direct contract legal articles...");
  
  try {
    for (const article of articles) {
      await db.insert(directContractLegalArticles).values(article);
      console.log(`✅ Inserted: ${article.article} - ${article.summary.substring(0, 50)}...`);
    }
    
    console.log(`\n✅ Successfully seeded ${articles.length} legal articles!`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding legal articles:", error);
    process.exit(1);
  }
}

seed();
