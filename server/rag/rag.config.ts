/**
 * Configuração para RAG (Retrieval-Augmented Generation)
 * 
 * Este arquivo define as configurações para implementação futura de RAG.
 * RAG permite que a IA busque informações relevantes em uma base de conhecimento
 * antes de gerar respostas, melhorando significativamente a precisão.
 * 
 * QUANDO IMPLEMENTAR:
 * - Quando tiver 50+ clientes (para justificar custo)
 * - Quando clientes pedirem "aprenda com meus documentos"
 * - Quando quiser cobrar mais (plano Premium com RAG)
 */

export const RAGConfig = {
  // Vector Database
  vectorDB: {
    provider: 'pinecone', // ou 'supabase-pgvector', 'weaviate', 'qdrant'
    apiKey: process.env.PINECONE_API_KEY || '',
    environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1',
    indexName: 'licigov-knowledge-base',
    dimension: 1536, // OpenAI text-embedding-3-small
  },

  // Embeddings
  embeddings: {
    provider: 'openai', // ou 'google', 'cohere'
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY || '',
    chunkSize: 1000, // Tamanho do chunk em caracteres
    chunkOverlap: 200, // Overlap entre chunks
  },

  // Retrieval
  retrieval: {
    topK: 5, // Número de documentos similares a recuperar
    minScore: 0.7, // Score mínimo de similaridade (0-1)
    maxTokens: 4000, // Máximo de tokens para contexto
  },

  // Knowledge Base
  knowledgeBase: {
    // Tipos de documentos para indexar
    documentTypes: [
      'law', // Leis (Lei 14.133/21, etc)
      'jurisprudence', // Jurisprudência de tribunais
      'template', // Templates aprovados
      'user_document', // Documentos do usuário
    ],
    
    // Fontes de conhecimento global (disponível para todos)
    globalSources: [
      {
        type: 'law',
        title: 'Lei 14.133/21',
        source: 'http://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm',
        description: 'Nova Lei de Licitações e Contratos Administrativos',
      },
      // Adicionar mais fontes aqui quando implementar
    ],
  },

  // Custos estimados (para planejamento)
  estimatedCosts: {
    embeddingsPerMonth: 'R$ 10-50', // Depende do volume
    vectorDBPerMonth: 'R$ 0-100', // Pinecone grátis até 100k vetores
    totalPerMonth: 'R$ 50-200',
  },
};

/**
 * Exemplo de uso futuro:
 * 
 * import { retrieveRelevantContext } from './retriever';
 * import { generateETP } from '../services/gemini';
 * 
 * // 1. Buscar contexto relevante na base de conhecimento
 * const context = await retrieveRelevantContext({
 *   query: params.object,
 *   userId: userId,
 *   topK: 5,
 * });
 * 
 * // 2. Injetar contexto no prompt
 * const enhancedPrompt = `
 * ${basePrompt}
 * 
 * **CONTEXTO RELEVANTE DA BASE DE CONHECIMENTO:**
 * ${context.map(doc => doc.content).join('\n\n')}
 * 
 * Use as informações acima como referência, mas adapte para o caso específico.
 * `;
 * 
 * // 3. Gerar documento com contexto enriquecido
 * const document = await generateETP(enhancedPrompt);
 */

export default RAGConfig;
