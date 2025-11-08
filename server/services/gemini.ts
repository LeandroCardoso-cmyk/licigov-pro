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
}): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

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

  const prompt = `Você é um especialista em licitações públicas e na Lei 14.133/21 (Nova Lei de Licitações e Contratos Administrativos).

Sua tarefa é gerar um **Estudo Técnico Preliminar (ETP)** completo e profissional para o seguinte processo licitatório:

**DADOS DO PROCESSO:**
- Nome do Processo: ${params.processName}
- Objeto da Contratação: ${params.object}
- Valor Estimado: ${valueInReais}
- Modalidade: ${modalityName}
- Categoria: ${categoryName}

**INSTRUÇÕES:**
1. O ETP deve seguir rigorosamente as diretrizes da Lei 14.133/21, especialmente o Art. 18, §1º
2. O documento deve ser estruturado, formal e tecnicamente preciso
3. Use linguagem jurídica apropriada para documentos oficiais
4. Inclua todas as seções obrigatórias de um ETP
5. Forneça justificativas técnicas e econômicas sólidas
6. Cite artigos relevantes da Lei 14.133/21 quando apropriado
7. O documento deve estar pronto para ser apresentado à autoridade competente

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

    return text;
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
}): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const valueInReais = (params.estimatedValue / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

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
    return result.response.text();
  } catch (error) {
    console.error("Erro ao gerar TR com Gemini:", error);
    throw new Error("Falha ao gerar TR. Por favor, tente novamente.");
  }
}
