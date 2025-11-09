# RAG (Retrieval-Augmented Generation) - Arquitetura Futura

Esta pasta contém a arquitetura preparada para implementação futura de RAG no LiciGov Pro.

## 📋 O que é RAG?

**RAG = Retrieval-Augmented Generation** (Geração Aumentada por Recuperação)

É uma técnica onde a IA:
1. **Busca** informações relevantes em uma base de conhecimento (documentos, PDFs, leis)
2. **Injeta** essas informações no prompt
3. **Gera** resposta baseada no contexto recuperado

## 🎯 Por que implementar RAG?

### **Benefícios:**
- ✅ **Precisão:** IA usa informações reais, não inventa
- ✅ **Personalização:** Aprende com documentos aprovados do cliente
- ✅ **Conformidade:** Cita jurisprudência e leis atualizadas
- ✅ **Diferencial:** Plano Premium com RAG pode custar 2-3x mais

### **Casos de uso:**
1. **Aprendizado com documentos aprovados:** Cliente faz upload de 10 ETPs que foram aprovados pelo jurídico → Sistema aprende o "estilo" e gera novos documentos similares
2. **Base de jurisprudência:** Indexar decisões de tribunais de contas (TCU, TCEs) → Gerar pareceres citando jurisprudência relevante
3. **Legislação atualizada:** Indexar Lei 14.133/21 + decretos + instruções normativas → Garantir conformidade com normas específicas
4. **Templates municipais:** Cada município tem templates próprios → Sistema gera documentos no formato exato do município

## 📊 Quando implementar?

**Recomendação:** Deixar para **Fase 2** (depois de ter 50+ clientes)

**Motivos:**
- ❌ Aumenta complexidade técnica (vector database, embeddings)
- ❌ Aumenta custos (R$ 50-200/mês)
- ❌ Requer mais dados (precisa de corpus grande)
- ❌ Não é diferencial no MVP (clientes não sabem o que é RAG)

**Quando faz sentido:**
- ✅ Quando clientes pedirem "aprenda com meus documentos"
- ✅ Quando quiser cobrar mais (plano Premium com RAG)
- ✅ Quando tiver orçamento para infraestrutura (R$ 500+/mês)

## 🛠️ Stack Sugerida

### **1. Vector Database**
| Opção | Custo | Prós | Contras |
|-------|-------|------|---------|
| **Pinecone** | R$ 0-100/mês | Fácil, grátis até 100k vetores | Vendor lock-in |
| **Supabase pgvector** | R$ 0-50/mês | Já usa Supabase | Menos features |
| **Weaviate** | R$ 0-200/mês | Open-source, self-hosted | Mais complexo |
| **Qdrant** | R$ 0-150/mês | Rápido, Rust | Menos maduro |

**Recomendação:** Pinecone (mais fácil para começar)

### **2. Embeddings**
| Opção | Custo | Dimensão | Qualidade |
|-------|-------|----------|-----------|
| **OpenAI text-embedding-3-small** | R$ 0,02/1M tokens | 1536 | ⭐⭐⭐⭐⭐ |
| **Google Vertex AI** | R$ 0,025/1M tokens | 768 | ⭐⭐⭐⭐ |
| **Cohere Embed** | R$ 0,10/1M tokens | 1024 | ⭐⭐⭐⭐ |

**Recomendação:** OpenAI text-embedding-3-small (melhor custo-benefício)

### **3. Chunking Strategy**
- **Chunk size:** 1000 caracteres
- **Overlap:** 200 caracteres
- **Método:** Recursive Character Text Splitter

## 📁 Arquitetura Preparada

```
server/rag/
├── rag.config.ts           # Configurações (providers, custos)
├── retriever.interface.ts  # Interface abstrata (trocar provider facilmente)
├── README.md               # Este arquivo
└── (futuro)
    ├── pinecone.retriever.ts   # Implementação Pinecone
    ├── embeddings.service.ts   # Serviço de embeddings
    └── chunking.service.ts     # Serviço de chunking
```

## 🚀 Como implementar (quando chegar a hora)

### **Passo 1: Instalar dependências**
```bash
pnpm add @pinecone-database/pinecone openai
```

### **Passo 2: Configurar variáveis de ambiente**
```bash
PINECONE_API_KEY=your_key
PINECONE_ENVIRONMENT=us-east-1
OPENAI_API_KEY=your_key
```

### **Passo 3: Criar implementação**
```typescript
// server/rag/pinecone.retriever.ts
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

export class PineconeRetriever implements DocumentRetriever {
  private pinecone: Pinecone;
  private openai: OpenAI;

  async retrieve(query: RetrievalQuery): Promise<DocumentChunk[]> {
    // 1. Gerar embedding da query
    const embedding = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query.query,
    });

    // 2. Buscar vetores similares no Pinecone
    const results = await this.pinecone.index('licigov').query({
      vector: embedding.data[0].embedding,
      topK: query.topK || 5,
      includeMetadata: true,
    });

    // 3. Retornar chunks
    return results.matches.map(match => ({
      id: match.id,
      content: match.metadata.content,
      metadata: match.metadata,
      score: match.score,
    }));
  }
}
```

### **Passo 4: Integrar com geração de documentos**
```typescript
// server/services/gemini.ts
import { retrieveRelevantContext } from '../rag/pinecone.retriever';

export async function generateETP(params) {
  // 1. Buscar contexto relevante
  const context = await retrieveRelevantContext({
    query: params.object,
    userId: params.userId,
    topK: 5,
  });

  // 2. Injetar contexto no prompt
  const enhancedPrompt = `
  ${basePrompt}
  
  **CONTEXTO RELEVANTE:**
  ${context.map(doc => doc.content).join('\n\n')}
  `;

  // 3. Gerar com contexto enriquecido
  const result = await model.generateContent(enhancedPrompt);
  return result.response.text();
}
```

### **Passo 5: Indexar base de conhecimento**
```typescript
// Script de setup inicial
import { PineconeRetriever } from './server/rag/pinecone.retriever';

const retriever = new PineconeRetriever();

// Indexar Lei 14.133/21
await retriever.index({
  content: lei14133Content,
  metadata: {
    source: 'Lei 14.133/21',
    type: 'law',
    title: 'Nova Lei de Licitações',
  },
});
```

## 💰 Custo Estimado

### **Fase Inicial (0-100 clientes):**
- Embeddings: R$ 10-30/mês
- Pinecone (grátis): R$ 0/mês
- **Total:** R$ 10-30/mês

### **Fase Crescimento (100-500 clientes):**
- Embeddings: R$ 50-100/mês
- Pinecone: R$ 50-100/mês
- **Total:** R$ 100-200/mês

## 📈 ROI Esperado

**Investimento:** R$ 100-200/mês (infraestrutura)

**Retorno:**
- Plano Premium com RAG: +R$ 50/mês por cliente
- Meta: 20 clientes Premium
- Receita: 20 × R$ 50 = R$ 1.000/mês
- **Lucro:** R$ 800-900/mês

**Break-even:** 2-4 clientes Premium

## ✅ Checklist de Implementação

Quando decidir implementar RAG, siga este checklist:

- [ ] Contratar Pinecone (ou escolher outro vector DB)
- [ ] Contratar OpenAI API (para embeddings)
- [ ] Implementar `PineconeRetriever`
- [ ] Implementar `EmbeddingsService`
- [ ] Implementar `ChunkingService`
- [ ] Indexar Lei 14.133/21 completa
- [ ] Indexar jurisprudência de TCU/TCEs
- [ ] Criar interface para usuário fazer upload de documentos
- [ ] Adicionar flag `learn_from_this` em documentos
- [ ] Criar job para indexar documentos marcados
- [ ] Testar qualidade das respostas (A/B test)
- [ ] Criar plano Premium com RAG
- [ ] Documentar para usuários ("Aprenda com seus documentos")

## 🎓 Recursos para Estudo

- [LangChain RAG Tutorial](https://python.langchain.com/docs/use_cases/question_answering/)
- [Pinecone RAG Guide](https://www.pinecone.io/learn/retrieval-augmented-generation/)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [RAG Best Practices](https://www.anthropic.com/index/retrieval-augmented-generation-best-practices)

---

**Preparado por:** Manus AI  
**Data:** Janeiro 2025  
**Status:** 🟡 Arquitetura preparada, aguardando implementação
