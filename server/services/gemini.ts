import { GoogleGenerativeAI } from "@google/generative-ai";

// Inicializar cliente Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Gera o ETP (Estudo Técnico Preliminar) usando Google Gemini
 */
export async function generateETP(params: {
  processName: string;
  object: string;
  estimatedValue: number; // em centavos
  modality: string;
  category: string;
  organizationName?: string;
  address?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  website?: string;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.3, // Baixo para respostas mais determinísticas e menos criativas
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  // Converter valor de centavos para reais
  const valueInReais = (params.estimatedValue / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  // Mapear modalidades e categorias para nomes legíveis
  const modalityMap: Record<string, string> = {
    pregao: "Pregão",
    concorrencia: "Concorrência",
    tomada_precos: "Tomada de Preços",
    concurso: "Concurso",
    leilao: "Leilão",
    dialogo_competitivo: "Diálogo Competitivo",
  };

  const categoryMap: Record<string, string> = {
    obras: "Obras",
    servicos: "Serviços",
    compras: "Compras",
    locacao: "Locação",
    alienacao: "Alienação",
  };

  const modalityName = modalityMap[params.modality] || params.modality;
  const categoryName = categoryMap[params.category] || params.category;

  // Construir cabeçalho se houver configurações
  let header = "";
  if (params.organizationName) {
    header = `\n---\n**${params.organizationName}**\n`;
    if (params.address) header += `${params.address}\n`;
    if (params.cnpj) header += `CNPJ: ${params.cnpj}\n`;
    header += `---\n\n`;
  }

  // Construir rodapé se houver configurações
  let footer = "";
  if (params.phone || params.email || params.website) {
    footer = `\n\n---\n**Contato:**\n`;
    if (params.phone) footer += `Telefone: ${params.phone}\n`;
    if (params.email) footer += `E-mail: ${params.email}\n`;
    if (params.website) footer += `Website: ${params.website}\n`;
    footer += `---`;
  }

  const prompt = `Você é um especialista em licitações públicas e na Lei 14.133/21 (Nova Lei de Licitações e Contratos Administrativos).

Sua tarefa é gerar um **Estudo Técnico Preliminar (ETP)** completo e profissional para o seguinte processo licitatório:

**DADOS DO PROCESSO:**
- Nome do Processo: ${params.processName}
- Objeto da Contratação: ${params.object}
- Valor Estimado: ${valueInReais}
- Modalidade: ${modalityName}
- Categoria: ${categoryName}

**INSTRUÇÕES CRÍTICAS (SIGA RIGOROSAMENTE):**
1. O ETP deve seguir rigorosamente as diretrizes da Lei 14.133/21, especialmente o Art. 18, §1º
2. O documento deve ser estruturado, formal e tecnicamente preciso
3. Use linguagem jurídica apropriada para documentos oficiais
4. Inclua todas as seções obrigatórias de um ETP
5. Forneça justificativas técnicas e econômicas sólidas baseadas APENAS nas informações fornecidas
6. **NÃO INVENTE referências legais, artigos ou números que não existem**
7. **NÃO CITE artigos específicos da Lei 14.133/21 a menos que você tenha CERTEZA ABSOLUTA de que existem**
8. **Se precisar mencionar a lei, use referências genéricas como "conforme Lei 14.133/21" sem especificar artigos**
9. **NÃO INVENTE dados técnicos, valores ou especificações que não foram fornecidos**
10. **Use apenas as informações fornecidas nos DADOS DO PROCESSO acima**
11. O documento deve estar pronto para ser apresentado à autoridade competente
12. **AVISO: Este documento será revisado por um jurídico. Seja preciso e factual.**

**ESTRUTURA OBRIGATÓRIA DO ETP:**

# ESTUDO TÉCNICO PRELIMINAR (ETP)

## 1. IDENTIFICAÇÃO DA NECESSIDADE
[Descreva claramente a necessidade que motivou a contratação]

## 2. OBJETO DA CONTRATAÇÃO
[Descrição detalhada do objeto]

## 3. JUSTIFICATIVA DA CONTRATAÇÃO
[Justificativa técnica, econômica e jurídica]

## 4. REQUISITOS DA CONTRATAÇÃO
[Especificações técnicas, quantitativos, prazos]

## 5. ESTIMATIVA DE VALORES
[Detalhamento do valor estimado e metodologia de cálculo]

## 6. MODALIDADE DE LICITAÇÃO
[Justificativa da modalidade escolhida conforme Lei 14.133/21]

## 7. CRITÉRIO DE JULGAMENTO
[Definição e justificativa do critério]

## 8. REGIME DE EXECUÇÃO
[Regime de execução contratual]

## 9. PRAZO DE EXECUÇÃO
[Prazo estimado e justificativa]

## 10. ANÁLISE DE RISCOS
[Identificação e mitigação de riscos]

## 11. RESULTADOS ESPERADOS
[Benefícios e resultados da contratação]

## 12. CONCLUSÃO
[Conclusão e recomendações]

---

**IMPORTANTE:** Gere um documento completo, profissional e pronto para uso. Use markdown para formatação.`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Adicionar cabeçalho e rodapé ao documento
    return `${header}${text}${footer}`;
  } catch (error) {
    console.error("Erro ao gerar ETP com Gemini:", error);
    throw new Error("Falha ao gerar ETP. Por favor, tente novamente.");
  }
}

/**
 * Gera o TR (Termo de Referência) usando Google Gemini
 */
export async function generateTR(params: {
  processName: string;
  object: string;
  estimatedValue: number;
  modality: string;
  category: string;
  etpContent: string; // Conteúdo do ETP para contexto
  organizationName?: string;
  address?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  website?: string;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.3, // Baixo para respostas mais determinísticas e menos criativas
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  const valueInReais = (params.estimatedValue / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  // Construir cabeçalho
  let headerTR = "";
  if (params.organizationName) {
    headerTR = `\n---\n**${params.organizationName}**\n`;
    if (params.address) headerTR += `${params.address}\n`;
    if (params.cnpj) headerTR += `CNPJ: ${params.cnpj}\n`;
    headerTR += `---\n\n`;
  }

  // Construir rodapé
  let footerTR = "";
  if (params.phone || params.email || params.website) {
    footerTR = `\n\n---\n**Contato:**\n`;
    if (params.phone) footerTR += `Telefone: ${params.phone}\n`;
    if (params.email) footerTR += `E-mail: ${params.email}\n`;
    if (params.website) footerTR += `Website: ${params.website}\n`;
    footerTR += `---`;
  }

  const prompt = `Você é um especialista em licitações públicas e na Lei 14.133/21.

Com base no ETP já elaborado, gere agora um **Termo de Referência (TR)** completo e detalhado.

**CONTEXTO - ETP ELABORADO:**
${params.etpContent}

**DADOS DO PROCESSO:**
- Nome: ${params.processName}
- Objeto: ${params.object}
- Valor Estimado: ${valueInReais}
- Modalidade: ${params.modality}
- Categoria: ${params.category}

**INSTRUÇÕES:**
1. O TR deve ser mais detalhado e técnico que o ETP
2. Inclua especificações técnicas completas
3. Defina obrigações do contratado e do contratante
4. Estabeleça critérios de aceitação e fiscalização
5. Siga a Lei 14.133/21, especialmente Art. 6º, XXIII

Gere um documento profissional em markdown.`;

  try {
    const result = await model.generateContent(prompt);
    const textTR = result.response.text();
    return `${headerTR}${textTR}${footerTR}`;
  } catch (error) {
    console.error("Erro ao gerar TR com Gemini:", error);
    throw new Error("Falha ao gerar TR. Por favor, tente novamente.");
  }
}

/**
 * Gera o DFD (Documento Formalizador de Demanda) usando Google Gemini
 */
export async function generateDFD(params: {
  processName: string;
  object: string;
  estimatedValue: number;
  modality: string;
  category: string;
  etpContent: string;
  trContent: string;
  organizationName?: string;
  address?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  website?: string;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.3, // Baixo para respostas mais determinísticas e menos criativas
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  const valueInReais = (params.estimatedValue / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  // Construir cabeçalho
  let headerDFD = "";
  if (params.organizationName) {
    headerDFD = `\n---\n**${params.organizationName}**\n`;
    if (params.address) headerDFD += `${params.address}\n`;
    if (params.cnpj) headerDFD += `CNPJ: ${params.cnpj}\n`;
    headerDFD += `---\n\n`;
  }

  // Construir rodapé
  let footerDFD = "";
  if (params.phone || params.email || params.website) {
    footerDFD = `\n\n---\n**Contato:**\n`;
    if (params.phone) footerDFD += `Telefone: ${params.phone}\n`;
    if (params.email) footerDFD += `E-mail: ${params.email}\n`;
    if (params.website) footerDFD += `Website: ${params.website}\n`;
    footerDFD += `---`;
  }

  const prompt = `Você é um especialista em licitações públicas e na Lei 14.133/21.

Com base no ETP e TR já elaborados, gere agora um **Documento Formalizador de Demanda (DFD)** completo.

O DFD é o documento que formaliza a necessidade da contratação e dá início ao processo licitatório.

**CONTEXTO - ETP ELABORADO:**
${params.etpContent}

**CONTEXTO - TR ELABORADO:**
${params.trContent}

**DADOS DO PROCESSO:**
- Nome: ${params.processName}
- Objeto: ${params.object}
- Valor Estimado: ${valueInReais}
- Modalidade: ${params.modality}
- Categoria: ${params.category}

**INSTRUÇÕES:**
1. O DFD deve ser conciso e objetivo
2. Deve conter a justificativa da necessidade
3. Deve referenciar o ETP e TR
4. Deve indicar a disponibilidade orçamentária
5. Siga a Lei 14.133/21, especialmente Art. 11

Gere um documento profissional em markdown.`;

  try {
    const result = await model.generateContent(prompt);
    const textDFD = result.response.text();
    return `${headerDFD}${textDFD}${footerDFD}`;
  } catch (error) {
    console.error("Erro ao gerar DFD com Gemini:", error);
    throw new Error("Falha ao gerar DFD. Por favor, tente novamente.");
  }
}

/**
 * Gera o Edital usando Google Gemini
 */
export async function generateEdital(params: {
  processName: string;
  object: string;
  estimatedValue: number;
  modality: string;
  category: string;
  etpContent: string;
  trContent: string;
  dfdContent: string;
  organizationName?: string;
  address?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  website?: string;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.3, // Baixo para respostas mais determinísticas e menos criativas
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  const valueInReais = (params.estimatedValue / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  // Construir cabeçalho
  let headerEdital = "";
  if (params.organizationName) {
    headerEdital = `\n---\n**${params.organizationName}**\n`;
    if (params.address) headerEdital += `${params.address}\n`;
    if (params.cnpj) headerEdital += `CNPJ: ${params.cnpj}\n`;
    headerEdital += `---\n\n`;
  }

  // Construir rodapé
  let footerEdital = "";
  if (params.phone || params.email || params.website) {
    footerEdital = `\n\n---\n**Contato:**\n`;
    if (params.phone) footerEdital += `Telefone: ${params.phone}\n`;
    if (params.email) footerEdital += `E-mail: ${params.email}\n`;
    if (params.website) footerEdital += `Website: ${params.website}\n`;
    footerEdital += `---`;
  }

  const prompt = `Você é um especialista em licitações públicas e na Lei 14.133/21.

Com base em todos os documentos já elaborados (ETP, TR e DFD), gere agora o **Edital de Licitação** completo.

**CONTEXTO - ETP:**
${params.etpContent}

**CONTEXTO - TR:**
${params.trContent}

**CONTEXTO - DFD:**
${params.dfdContent}

**DADOS DO PROCESSO:**
- Nome: ${params.processName}
- Objeto: ${params.object}
- Valor Estimado: ${valueInReais}
- Modalidade: ${params.modality}
- Categoria: ${params.category}

**INSTRUÇÕES:**
1. O Edital deve ser completo e pronto para publicação
2. Inclua todas as seções obrigatórias de um edital
3. Defina prazos, critérios de habilitação e julgamento
4. Estabeleça regras claras de participação
5. Siga rigorosamente a Lei 14.133/21
6. Use linguagem jurídica formal e precisa

**ESTRUTURA DO EDITAL:**

# EDITAL DE LICITAÇÃO Nº [NUMERO]/[ANO]

## PREÂMBULO
## OBJETO
## CONDIÇÕES DE PARTICIPAÇÃO
## CREDENCIAMENTO
## PROPOSTA
## JULGAMENTO
## HABILITAÇÃO
## RECURSOS
## ADJUDICAÇÃO E HOMOLOGAÇÃO
## CONTRATAÇÃO
## ANEXOS

Gere um documento profissional e completo em markdown.`;

  try {
    const result = await model.generateContent(prompt);
    const textEdital = result.response.text();
    return `${headerEdital}${textEdital}${footerEdital}`;
  } catch (error) {
    console.error("Erro ao gerar Edital com Gemini:", error);
    throw new Error("Falha ao gerar Edital. Por favor, tente novamente.");
  }
}
