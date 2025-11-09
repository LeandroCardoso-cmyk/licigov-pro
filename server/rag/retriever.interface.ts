/**
 * Interface para Document Retriever (RAG)
 * 
 * Esta interface define o contrato para implementação futura de RAG.
 * Permite trocar de provedor (Pinecone, Supabase, etc) sem mudar o código.
 */

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    type: 'law' | 'jurisprudence' | 'template' | 'user_document';
    title: string;
    userId?: number; // null para conhecimento global
    createdAt: Date;
  };
  score: number; // Similaridade (0-1)
}

export interface RetrievalQuery {
  query: string;
  userId?: number; // Para buscar documentos do usuário
  topK?: number; // Número de resultados
  minScore?: number; // Score mínimo
  filter?: {
    type?: string[];
    source?: string;
  };
}

export interface DocumentRetriever {
  /**
   * Buscar documentos similares à query
   */
  retrieve(query: RetrievalQuery): Promise<DocumentChunk[]>;

  /**
   * Indexar novo documento na base de conhecimento
   */
  index(params: {
    content: string;
    metadata: {
      source: string;
      type: 'law' | 'jurisprudence' | 'template' | 'user_document';
      title: string;
      userId?: number;
    };
  }): Promise<void>;

  /**
   * Remover documento da base
   */
  delete(documentId: string): Promise<void>;

  /**
   * Atualizar documento existente
   */
  update(documentId: string, content: string): Promise<void>;
}

/**
 * Exemplo de implementação futura:
 * 
 * import { PineconeRetriever } from './pinecone.retriever';
 * 
 * const retriever = new PineconeRetriever();
 * 
 * // Indexar Lei 14.133/21
 * await retriever.index({
 *   content: lei14133Content,
 *   metadata: {
 *     source: 'Lei 14.133/21',
 *     type: 'law',
 *     title: 'Nova Lei de Licitações',
 *   },
 * });
 * 
 * // Buscar contexto relevante
 * const results = await retriever.retrieve({
 *   query: 'Estudo Técnico Preliminar',
 *   topK: 5,
 *   filter: { type: ['law', 'jurisprudence'] },
 * });
 */

export default DocumentRetriever;
