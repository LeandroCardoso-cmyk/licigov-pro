import { invokeLLM } from "../_core/llm";
import { getDirectContractById, getLegalArticleById, getDocumentSettingsByUser } from "../db";

/**
 * Serviço de Geração de Documentos Específicos para Contratação Direta
 */

interface GenerateTermoParams {
  directContractId: number;
  userId: number;
}

/**
 * Gera Termo de Dispensa de Licitação
 */
export async function generateTermoDispensa(params: GenerateTermoParams): Promise<string> {
  const { directContractId, userId } = params;

  // Buscar dados da contratação
  const contract = await getDirectContractById(directContractId);
  if (!contract) {
    throw new Error("Contratação não encontrada");
  }

  if (contract.type !== "dispensa") {
    throw new Error("Este documento é apenas para dispensas");
  }

  // Buscar artigo legal
  const article = await getLegalArticleById(contract.legalArticleId);
  if (!article) {
    throw new Error("Artigo legal não encontrado");
  }

  // Buscar configurações do usuário
  const settings = await getDocumentSettingsByUser(userId);

  const valueInReais = contract.value / 100;

  const prompt = `Você é um servidor público especializado em elaborar Termos de Dispensa de Licitação conforme a Lei 14.133/2021.

**DADOS DA CONTRATAÇÃO:**
- Número: ${contract.number}/${contract.year}
- Objeto: ${contract.object}
- Valor: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Artigo Legal: ${article.article} ${article.inciso || ""}
- Justificativa: ${contract.justification}
${contract.supplierName ? `- Fornecedor: ${contract.supplierName}` : ""}
${contract.supplierCNPJ ? `- CNPJ: ${contract.supplierCNPJ}` : ""}
${contract.executionDeadline ? `- Prazo de execução: ${contract.executionDeadline} dias` : ""}

**DADOS DO ÓRGÃO:**
${settings?.organizationName ? `- Órgão: ${settings.organizationName}` : ""}
${settings?.cnpj ? `- CNPJ: ${settings.cnpj}` : ""}
${settings?.address ? `- Endereço: ${settings.address}` : ""}

**TAREFA:**
Elabore um **TERMO DE DISPENSA DE LICITAÇÃO** completo e profissional, seguindo esta estrutura:

# TERMO DE DISPENSA DE LICITAÇÃO Nº ${contract.number}/${contract.year}

## 1. IDENTIFICAÇÃO
- Órgão/Entidade
- CNPJ
- Endereço

## 2. OBJETO DA CONTRATAÇÃO
Descrever detalhadamente o objeto

## 3. FUNDAMENTAÇÃO LEGAL
- Citar o artigo legal aplicável (${article.article} ${article.inciso || ""})
- Transcrever o texto legal
- Explicar por que se aplica ao caso concreto

## 4. JUSTIFICATIVA
- Necessidade da contratação
- Razões para dispensa
- Urgência (se aplicável)
- Impossibilidade de competição (se aplicável)

## 5. VALOR ESTIMADO
- Valor total: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Demonstrar compatibilidade com preços de mercado
- Justificar razoabilidade

## 6. FORNECEDOR (se já identificado)
${contract.supplierName ? `- Nome: ${contract.supplierName}` : "- A definir após cotações"}
${contract.supplierCNPJ ? `- CNPJ: ${contract.supplierCNPJ}` : ""}

## 7. PRAZO DE EXECUÇÃO
${contract.executionDeadline ? `${contract.executionDeadline} dias` : "A definir em contrato"}

## 8. DOTAÇÃO ORÇAMENTÁRIA
(A ser preenchido pelo setor responsável)

## 9. RATIFICAÇÃO
Solicito a ratificação da presente dispensa de licitação pela autoridade competente.

---

Local e Data: _________________, ___ de __________ de ${contract.year}

**Responsável pela Elaboração:**
_________________________________
Nome e Cargo

**Ratificação:**
_________________________________
Autoridade Competente

**IMPORTANTE:**
- Use linguagem formal e técnica
- Cite a Lei 14.133/2021 e outros normativos relevantes
- Seja objetivo mas completo
- Formate em Markdown profissional
- Mínimo 800 palavras`;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "Você é um servidor público especializado em elaborar Termos de Dispensa de Licitação. Use linguagem formal, técnica e objetiva.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.choices[0].message.content || "";
}

/**
 * Gera Termo de Inexigibilidade de Licitação
 */
export async function generateTermoInexigibilidade(params: GenerateTermoParams): Promise<string> {
  const { directContractId, userId } = params;

  // Buscar dados da contratação
  const contract = await getDirectContractById(directContractId);
  if (!contract) {
    throw new Error("Contratação não encontrada");
  }

  if (contract.type !== "inexigibilidade") {
    throw new Error("Este documento é apenas para inexigibilidades");
  }

  // Buscar artigo legal
  const article = await getLegalArticleById(contract.legalArticleId);
  if (!article) {
    throw new Error("Artigo legal não encontrado");
  }

  // Buscar configurações do usuário
  const settings = await getDocumentSettingsByUser(userId);

  const valueInReais = contract.value / 100;

  const prompt = `Você é um servidor público especializado em elaborar Termos de Inexigibilidade de Licitação conforme a Lei 14.133/2021.

**DADOS DA CONTRATAÇÃO:**
- Número: ${contract.number}/${contract.year}
- Objeto: ${contract.object}
- Valor: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Artigo Legal: ${article.article} ${article.inciso || ""}
- Justificativa: ${contract.justification}
${contract.supplierName ? `- Fornecedor: ${contract.supplierName}` : ""}
${contract.supplierCNPJ ? `- CNPJ: ${contract.supplierCNPJ}` : ""}

**DADOS DO ÓRGÃO:**
${settings?.organizationName ? `- Órgão: ${settings.organizationName}` : ""}
${settings?.cnpj ? `- CNPJ: ${settings.cnpj}` : ""}
${settings?.address ? `- Endereço: ${settings.address}` : ""}

**TAREFA:**
Elabore um **TERMO DE INEXIGIBILIDADE DE LICITAÇÃO** completo e profissional, seguindo esta estrutura:

# TERMO DE INEXIGIBILIDADE DE LICITAÇÃO Nº ${contract.number}/${contract.year}

## 1. IDENTIFICAÇÃO
- Órgão/Entidade
- CNPJ
- Endereço

## 2. OBJETO DA CONTRATAÇÃO
Descrever detalhadamente o objeto

## 3. FUNDAMENTAÇÃO LEGAL
- Citar o artigo legal aplicável (${article.article} ${article.inciso || ""})
- Transcrever o texto legal (Art. 74 da Lei 14.133/2021)
- Explicar por que se aplica ao caso concreto

## 4. CARACTERIZAÇÃO DA INEXIGIBILIDADE
- Demonstrar inviabilidade de competição
- Provar exclusividade (se Art. 74, I)
- Provar notória especialização (se Art. 74, III)
- Justificar singularidade do objeto

## 5. JUSTIFICATIVA TÉCNICA
- Necessidade da contratação
- Características únicas do objeto/fornecedor
- Impossibilidade de substituição

## 6. FORNECEDOR EXCLUSIVO
- Nome: ${contract.supplierName || "(A definir)"}
- CNPJ: ${contract.supplierCNPJ || "(A definir)"}
- Endereço: ${contract.supplierAddress || "(A definir)"}
- Comprovação de exclusividade (anexar documentos)

## 7. VALOR ESTIMADO
- Valor total: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Demonstrar compatibilidade com preços de mercado
- Justificar razoabilidade

## 8. PRAZO DE EXECUÇÃO
${contract.executionDeadline ? `${contract.executionDeadline} dias` : "A definir em contrato"}

## 9. DOTAÇÃO ORÇAMENTÁRIA
(A ser preenchido pelo setor responsável)

## 10. RATIFICAÇÃO
Solicito a ratificação da presente inexigibilidade de licitação pela autoridade competente.

---

Local e Data: _________________, ___ de __________ de ${contract.year}

**Responsável pela Elaboração:**
_________________________________
Nome e Cargo

**Ratificação:**
_________________________________
Autoridade Competente

**IMPORTANTE:**
- Use linguagem formal e técnica
- Demonstre claramente a inviabilidade de competição
- Cite jurisprudência e pareceres (se relevante)
- Formate em Markdown profissional
- Mínimo 1000 palavras`;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "Você é um servidor público especializado em elaborar Termos de Inexigibilidade de Licitação. Use linguagem formal, técnica e demonstre claramente a inviabilidade de competição.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.choices[0].message.content || "";
}

/**
 * Gera Minuta de Contrato para Contratação Direta
 */
export async function generateMinutaContrato(params: GenerateTermoParams): Promise<string> {
  const { directContractId, userId } = params;

  // Buscar dados da contratação
  const contract = await getDirectContractById(directContractId);
  if (!contract) {
    throw new Error("Contratação não encontrada");
  }

  // Buscar configurações do usuário
  const settings = await getDocumentSettingsByUser(userId);

  const valueInReais = contract.value / 100;

  const prompt = `Você é um advogado especializado em contratos administrativos conforme a Lei 14.133/2021.

**DADOS DA CONTRATAÇÃO:**
- Tipo: ${contract.type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação"}
- Número: ${contract.number}/${contract.year}
- Objeto: ${contract.object}
- Valor: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
${contract.supplierName ? `- Contratada: ${contract.supplierName}` : ""}
${contract.supplierCNPJ ? `- CNPJ: ${contract.supplierCNPJ}` : ""}
${contract.supplierAddress ? `- Endereço: ${contract.supplierAddress}` : ""}
${contract.executionDeadline ? `- Prazo: ${contract.executionDeadline} dias` : ""}

**DADOS DO ÓRGÃO (CONTRATANTE):**
${settings?.organizationName ? `- Órgão: ${settings.organizationName}` : ""}
${settings?.cnpj ? `- CNPJ: ${settings.cnpj}` : ""}
${settings?.address ? `- Endereço: ${settings.address}` : ""}

**TAREFA:**
Elabore uma **MINUTA DE CONTRATO ADMINISTRATIVO** completa e profissional, seguindo a Lei 14.133/2021:

# CONTRATO Nº ${contract.number}/${contract.year}

## CONTRATANTE
[Nome do Órgão], inscrito no CNPJ sob o nº [CNPJ], com sede em [Endereço], neste ato representado por [Nome e Cargo do Representante Legal].

## CONTRATADA
${contract.supplierName || "[Nome da Empresa]"}, inscrita no CNPJ sob o nº ${contract.supplierCNPJ || "[CNPJ]"}, com sede em ${contract.supplierAddress || "[Endereço]"}, neste ato representada por [Nome e Cargo do Representante Legal].

## CLÁUSULA PRIMEIRA - DO OBJETO
Descrever detalhadamente o objeto do contrato: ${contract.object}

## CLÁUSULA SEGUNDA - DA FUNDAMENTAÇÃO LEGAL
- Lei nº 14.133/2021 (Nova Lei de Licitações)
- ${contract.type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação"} nº ${contract.number}/${contract.year}
- Demais normas aplicáveis

## CLÁUSULA TERCEIRA - DO VALOR
O valor total do contrato é de R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (valor por extenso).

## CLÁUSULA QUARTA - DO PRAZO DE EXECUÇÃO
${contract.executionDeadline ? `O prazo de execução é de ${contract.executionDeadline} dias corridos, contados da assinatura do contrato.` : "O prazo será definido conforme cronograma anexo."}

## CLÁUSULA QUINTA - DA FORMA DE PAGAMENTO
O pagamento será efetuado em até 30 (trinta) dias após a apresentação da nota fiscal e atesto de recebimento.

## CLÁUSULA SEXTA - DAS OBRIGAÇÕES DA CONTRATADA
1. Executar o objeto conforme especificações
2. Manter as condições de habilitação
3. Responsabilizar-se por danos causados
4. Cumprir prazos estabelecidos
5. [Outras obrigações específicas]

## CLÁUSULA SÉTIMA - DAS OBRIGAÇÕES DA CONTRATANTE
1. Efetuar o pagamento conforme cláusula quinta
2. Fiscalizar a execução do contrato
3. Fornecer informações necessárias
4. [Outras obrigações específicas]

## CLÁUSULA OITAVA - DA FISCALIZAÇÃO
A fiscalização será exercida por servidor designado, conforme Art. 117 da Lei 14.133/2021.

## CLÁUSULA NONA - DAS SANÇÕES ADMINISTRATIVAS
Em caso de inadimplemento, aplicam-se as sanções previstas nos Arts. 155 a 163 da Lei 14.133/2021.

## CLÁUSULA DÉCIMA - DA RESCISÃO
O contrato poderá ser rescindido nas hipóteses do Art. 137 da Lei 14.133/2021.

## CLÁUSULA DÉCIMA PRIMEIRA - DA DOTAÇÃO ORÇAMENTÁRIA
Elemento de Despesa: [A preencher]
Fonte de Recurso: [A preencher]

## CLÁUSULA DÉCIMA SEGUNDA - DO FORO
Fica eleito o foro de [Comarca] para dirimir quaisquer dúvidas oriundas do presente contrato.

---

Local e Data: _________________, ___ de __________ de ${contract.year}

**CONTRATANTE:**
_________________________________
[Nome e Cargo]

**CONTRATADA:**
_________________________________
[Nome e Cargo]

**TESTEMUNHAS:**
1. ____________________________
2. ____________________________

**IMPORTANTE:**
- Use linguagem jurídica formal
- Cite a Lei 14.133/2021 em todas as cláusulas relevantes
- Inclua todas as cláusulas obrigatórias
- Formate em Markdown profissional
- Mínimo 1200 palavras`;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "Você é um advogado especializado em contratos administrativos. Use linguagem jurídica formal e cite a Lei 14.133/2021.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.choices[0].message.content || "";
}

/**
 * Gera Planilha de Cotação em Markdown (para conversão posterior em XLSX)
 */
export async function generatePlanilhaCotacao(params: {
  directContractId: number;
  quotations: Array<{
    supplierName: string;
    supplierCNPJ?: string;
    value: number;
    deliveryDeadline?: number;
    paymentTerms?: string;
  }>;
}): Promise<string> {
  const { directContractId, quotations } = params;

  // Buscar dados da contratação
  const contract = await getDirectContractById(directContractId);
  if (!contract) {
    throw new Error("Contratação não encontrada");
  }

  const sortedQuotations = [...quotations].sort((a, b) => a.value - b.value);

  let markdown = `# PLANILHA DE COTAÇÃO DE PREÇOS\n\n`;
  markdown += `**Contratação Direta nº ${contract.number}/${contract.year}**\n\n`;
  markdown += `**Objeto:** ${contract.object}\n\n`;
  markdown += `---\n\n`;
  markdown += `## COTAÇÕES RECEBIDAS\n\n`;
  markdown += `| Fornecedor | CNPJ | Valor (R$) | Prazo Entrega | Condições Pagamento |\n`;
  markdown += `|------------|------|------------|---------------|---------------------|\n`;

  sortedQuotations.forEach((q) => {
    const valueInReais = q.value / 100;
    markdown += `| ${q.supplierName} | ${q.supplierCNPJ || "N/A"} | ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | ${q.deliveryDeadline ? `${q.deliveryDeadline} dias` : "N/A"} | ${q.paymentTerms || "N/A"} |\n`;
  });

  markdown += `\n---\n\n`;
  markdown += `## ANÁLISE\n\n`;
  markdown += `**Menor Preço:** ${sortedQuotations[0].supplierName} - R$ ${(sortedQuotations[0].value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n\n`;
  markdown += `**Maior Preço:** ${sortedQuotations[sortedQuotations.length - 1].supplierName} - R$ ${(sortedQuotations[sortedQuotations.length - 1].value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n\n`;

  const avgValue =
    sortedQuotations.reduce((sum, q) => sum + q.value, 0) / sortedQuotations.length;
  markdown += `**Preço Médio:** R$ ${(avgValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n\n`;

  markdown += `---\n\n`;
  markdown += `## RECOMENDAÇÃO\n\n`;
  markdown += `Recomenda-se a contratação de **${sortedQuotations[0].supplierName}** por apresentar o menor preço e atender às especificações técnicas.\n\n`;
  markdown += `---\n\n`;
  markdown += `Local e Data: _________________, ___ de __________ de ${contract.year}\n\n`;
  markdown += `**Responsável pela Cotação:**\n`;
  markdown += `_________________________________\n`;
  markdown += `Nome e Cargo\n`;

  return markdown;
}

/**
 * Gera Mapa Comparativo de Preços
 */
export async function generateMapaComparativo(params: {
  directContractId: number;
  quotations: Array<{
    supplierName: string;
    supplierCNPJ?: string;
    value: number;
    deliveryDeadline?: number;
    paymentTerms?: string;
    notes?: string;
  }>;
}): Promise<string> {
  const { directContractId, quotations } = params;

  // Buscar dados da contratação
  const contract = await getDirectContractById(directContractId);
  if (!contract) {
    throw new Error("Contratação não encontrada");
  }

  const sortedQuotations = [...quotations].sort((a, b) => a.value - b.value);

  let markdown = `# MAPA COMPARATIVO DE PREÇOS\n\n`;
  markdown += `**Contratação Direta nº ${contract.number}/${contract.year}**\n\n`;
  markdown += `**Objeto:** ${contract.object}\n\n`;
  markdown += `**Tipo:** ${contract.type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação"}\n\n`;
  markdown += `---\n\n`;
  markdown += `## FORNECEDORES CONSULTADOS\n\n`;

  sortedQuotations.forEach((q, index) => {
    const valueInReais = q.value / 100;
    markdown += `### ${index + 1}. ${q.supplierName}\n\n`;
    markdown += `- **CNPJ:** ${q.supplierCNPJ || "Não informado"}\n`;
    markdown += `- **Valor:** R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n`;
    markdown += `- **Prazo de Entrega:** ${q.deliveryDeadline ? `${q.deliveryDeadline} dias` : "Não informado"}\n`;
    markdown += `- **Condições de Pagamento:** ${q.paymentTerms || "Não informado"}\n`;
    if (q.notes) {
      markdown += `- **Observações:** ${q.notes}\n`;
    }
    markdown += `\n`;
  });

  markdown += `---\n\n`;
  markdown += `## QUADRO COMPARATIVO\n\n`;
  markdown += `| Posição | Fornecedor | Valor (R$) | Diferença para Menor Preço |\n`;
  markdown += `|---------|------------|------------|----------------------------|\n`;

  const minValue = sortedQuotations[0].value;

  sortedQuotations.forEach((q, index) => {
    const valueInReais = q.value / 100;
    const diff = q.value - minValue;
    const diffPercentage = minValue > 0 ? ((diff / minValue) * 100).toFixed(2) : "0.00";
    markdown += `| ${index + 1}º | ${q.supplierName} | ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | ${diff === 0 ? "Menor preço" : `+R$ ${(diff / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (+${diffPercentage}%)`} |\n`;
  });

  markdown += `\n---\n\n`;
  markdown += `## ANÁLISE TÉCNICA\n\n`;
  markdown += `**Valor Estimado:** R$ ${(contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n\n`;
  markdown += `**Menor Preço Obtido:** R$ ${(minValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n\n`;

  const savings = contract.value - minValue;
  if (savings > 0) {
    const savingsPercentage = ((savings / contract.value) * 100).toFixed(2);
    markdown += `**Economia:** R$ ${(savings / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (${savingsPercentage}%)\n\n`;
  }

  markdown += `---\n\n`;
  markdown += `## PARECER\n\n`;
  markdown += `Com base nas cotações apresentadas, verifica-se que o menor preço foi oferecido por **${sortedQuotations[0].supplierName}**, no valor de R$ ${(minValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, estando compatível com os preços praticados no mercado.\n\n`;
  markdown += `Recomenda-se, portanto, a contratação do referido fornecedor.\n\n`;
  markdown += `---\n\n`;
  markdown += `Local e Data: _________________, ___ de __________ de ${contract.year}\n\n`;
  markdown += `**Responsável pela Análise:**\n`;
  markdown += `_________________________________\n`;
  markdown += `Nome e Cargo\n\n`;
  markdown += `**Aprovação:**\n`;
  markdown += `_________________________________\n`;
  markdown += `Autoridade Competente\n`;

  return markdown;
}
