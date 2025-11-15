# 📋 Plano de Implementação: RAG + Melhorias LiciGov Pro

**Data de Criação**: 15 de novembro de 2025  
**Execução Prevista**: 16 de novembro de 2025, 10:00h  
**Tempo Estimado Total**: 1h30-2h  
**Autor**: Manus AI

---

## 🎯 Objetivo Geral

Implementar três melhorias críticas no LiciGov Pro conforme solicitado pelo usuário:

1. **Sistema RAG** com Lei 14.133/21 indexada para melhorar qualidade dos documentos gerados
2. **Matching Inteligente** de itens importados com códigos CATMAT/CATSER usando IA Gemini
3. **Edição de Itens Importados** permitindo ajustes manuais após importação
4. **Testes Completos** do fluxo de importação de itens

---

## 📊 Resumo Executivo

| Fase | Descrição | Tempo | Complexidade | Prioridade |
|------|-----------|-------|--------------|------------|
| 1 | Sistema RAG com Lei 14.133/21 | 30min | Média | Alta |
| 2 | Matching Inteligente CATMAT | 40min | Alta | Alta |
| 3 | Edição de Itens Importados | 20min | Baixa | Média |
| 4 | Testes e Validação | 15min | Baixa | Alta |

**Custo Estimado de IA**: ~US$ 0,05 para indexação inicial + US$ 0,001 por processo gerado (com cache)

---

## 🔧 Fase 1: Sistema RAG com Lei 14.133/21 (30 minutos)

### Objetivo
Criar sistema de Retrieval Augmented Generation para melhorar precisão e conformidade legal dos documentos gerados, buscando automaticamente os artigos relevantes da Lei 14.133/21 durante a geração.

### Arquitetura Técnica

**Stack de RAG:**
- **Embeddings**: `text-embedding-004` (Google) - US$ 0,00001 por 1k tokens
- **Vector Store**: Tabela PostgreSQL com extensão `pgvector` (já disponível no projeto)
- **Chunking Strategy**: 512 tokens por chunk, overlap de 50 tokens
- **Retrieval**: Top-5 chunks mais relevantes por consulta
- **Reranking**: Gemini reordena chunks por relevância antes de gerar

### Passos de Implementação

#### 1.1. Criar Schema de Banco de Dados (5min)

**Arquivo**: `drizzle/schema.ts`

```typescript
// Adicionar tabela para armazenar chunks da Lei 14.133/21
export const lawChunks = mysqlTable("law_chunks", {
  id: int("id").autoincrement().primaryKey(),
  lawName: varchar("law_name", { length: 100 }).notNull(), // "Lei 14.133/21"
  chunkIndex: int("chunk_index").notNull(), // Ordem do chunk
  articleNumber: varchar("article_number", { length: 20 }), // "Art. 6º"
  content: text("content").notNull(), // Texto do chunk
  embedding: json("embedding").notNull(), // Vector de 768 dimensões
  metadata: json("metadata"), // { section: "...", topic: "..." }
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Comando**: `pnpm db:push`

#### 1.2. Criar Serviço de Embeddings (5min)

**Arquivo**: `server/services/embeddings.ts`

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings = await Promise.all(texts.map(generateEmbedding));
  return embeddings;
}

// Calcular similaridade de cosseno entre dois vetores
export function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}
```

#### 1.3. Criar Script de Indexação da Lei (10min)

**Arquivo**: `server/scripts/indexLaw14133.mjs`

```javascript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "../db.js";
import fs from "fs";
import path from "path";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Função para dividir texto em chunks
function chunkText(text, chunkSize = 512, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    chunks.push(chunk);
  }
  
  return chunks;
}

// Função para extrair número do artigo
function extractArticleNumber(chunk) {
  const match = chunk.match(/Art\.\s*(\d+[ºª]?(-[A-Z])?)/);
  return match ? match[0] : null;
}

async function indexLaw() {
  console.log("🔄 Iniciando indexação da Lei 14.133/21...");
  
  // 1. Ler arquivo da lei (você precisará adicionar este arquivo)
  const lawPath = path.join(process.cwd(), "data", "lei_14133_2021.txt");
  const lawText = fs.readFileSync(lawPath, "utf-8");
  
  // 2. Dividir em chunks
  const chunks = chunkText(lawText);
  console.log(`📄 Lei dividida em ${chunks.length} chunks`);
  
  // 3. Gerar embeddings
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const db = await getDb();
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const articleNumber = extractArticleNumber(chunk);
    
    console.log(`⚙️  Processando chunk ${i + 1}/${chunks.length}...`);
    
    const result = await model.embedContent(chunk);
    const embedding = result.embedding.values;
    
    // 4. Salvar no banco
    await db.insert(lawChunks).values({
      lawName: "Lei 14.133/21",
      chunkIndex: i,
      articleNumber,
      content: chunk,
      embedding: JSON.stringify(embedding),
      metadata: JSON.stringify({ section: articleNumber || "Preâmbulo" }),
    });
  }
  
  console.log("✅ Indexação concluída!");
}

indexLaw().catch(console.error);
```

**Nota**: Será necessário adicionar o arquivo `data/lei_14133_2021.txt` com o texto completo da lei.

#### 1.4. Criar Serviço de RAG (10min)

**Arquivo**: `server/services/rag.ts`

```typescript
import { getDb } from "../db";
import { lawChunks } from "../../drizzle/schema";
import { generateEmbedding, cosineSimilarity } from "./embeddings";
import { sql } from "drizzle-orm";

export interface RetrievedChunk {
  content: string;
  articleNumber: string | null;
  similarity: number;
}

export async function retrieveRelevantLaw(
  query: string,
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 1. Gerar embedding da query
  const queryEmbedding = await generateEmbedding(query);
  
  // 2. Buscar todos os chunks (em produção, usar índice vetorial)
  const allChunks = await db.select().from(lawChunks);
  
  // 3. Calcular similaridade
  const chunksWithSimilarity = allChunks.map((chunk) => {
    const chunkEmbedding = JSON.parse(chunk.embedding as string);
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
    
    return {
      content: chunk.content,
      articleNumber: chunk.articleNumber,
      similarity,
    };
  });
  
  // 4. Ordenar por similaridade e retornar top-K
  return chunksWithSimilarity
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const article = chunk.articleNumber ? `[${chunk.articleNumber}]` : "";
      return `### Trecho Relevante ${i + 1} ${article}\n${chunk.content}`;
    })
    .join("\n\n");
}
```

#### 1.5. Integrar RAG na Geração de Documentos (5min)

**Arquivo**: `server/services/gemini.ts` (modificar funções existentes)

```typescript
import { retrieveRelevantLaw, formatRetrievedContext } from "./rag";

// Modificar função generateETP
export async function generateETP(params: {
  processName: string;
  object: string;
  estimatedValue: number;
  modality: string;
  category: string;
  settings?: any;
}): Promise<string> {
  // 1. Buscar artigos relevantes da Lei 14.133/21
  const relevantLaw = await retrieveRelevantLaw(
    `Estudo Técnico Preliminar para ${params.object}. Modalidade: ${params.modality}`,
    5
  );
  
  const lawContext = formatRetrievedContext(relevantLaw);
  
  // 2. Incluir contexto legal no prompt
  const prompt = `
Você é um especialista em licitações públicas brasileiras. Gere um Estudo Técnico Preliminar (ETP) 
baseado ESTRITAMENTE na Lei 14.133/21.

**CONTEXTO LEGAL RELEVANTE:**
${lawContext}

**DADOS DO PROCESSO:**
- Nome: ${params.processName}
- Objeto: ${params.object}
- Valor Estimado: R$ ${(params.estimatedValue / 100).toFixed(2)}
- Modalidade: ${params.modality}
- Categoria: ${params.category}

**INSTRUÇÕES:**
1. Cite explicitamente os artigos da Lei 14.133/21 relevantes
2. Use o contexto legal fornecido acima
3. Estruture conforme Art. 6º, XXIII da Lei 14.133/21
...
`;

  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    systemInstruction: "Você é um especialista em licitações públicas brasileiras..."
  });
  
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Aplicar mesma lógica para generateTR, generateDFD, generateEdital
```

### Validação da Fase 1

- [ ] Tabela `law_chunks` criada no banco
- [ ] Script de indexação executa sem erros
- [ ] Pelo menos 100 chunks indexados
- [ ] Função `retrieveRelevantLaw` retorna chunks relevantes
- [ ] Documentos gerados citam artigos específicos da Lei 14.133/21

---

## 🤖 Fase 2: Matching Inteligente CATMAT com IA (40 minutos)

### Objetivo
Após usuário importar itens de planilha (descrições genéricas), usar IA Gemini para sugerir automaticamente os 3 códigos CATMAT/CATSER mais similares para cada item, com score de confiança.

### Fluxo de Usuário

1. Usuário importa planilha com 50 itens genéricos (ex: "Caneta esferográfica azul")
2. Sistema salva itens no banco sem código CATMAT
3. **[NOVO]** Sistema dispara processo de matching em background
4. IA busca no catálogo CATMAT e sugere top 3 códigos para cada item
5. Usuário revisa sugestões e aprova/rejeita cada uma
6. Códigos aprovados são vinculados aos itens

### Passos de Implementação

#### 2.1. Criar Schema para Sugestões (5min)

**Arquivo**: `drizzle/schema.ts`

```typescript
export const catmatSuggestions = mysqlTable("catmat_suggestions", {
  id: int("id").autoincrement().primaryKey(),
  processItemId: int("process_item_id").notNull(), // FK para processItems
  catmatCode: varchar("catmat_code", { length: 20 }).notNull(),
  description: text("description").notNull(),
  confidenceScore: int("confidence_score").notNull(), // 0-100
  reasoning: text("reasoning"), // Explicação da IA
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Comando**: `pnpm db:push`

#### 2.2. Criar Função de Busca CATMAT (10min)

**Arquivo**: `server/services/catmatMatcher.ts`

```typescript
import { invokeLLM } from "../_core/llm";

interface CatmatMatch {
  code: string;
  description: string;
  confidence: number; // 0-100
  reasoning: string;
}

export async function findCatmatMatches(
  itemDescription: string,
  itemType: "material" | "service" = "material"
): Promise<CatmatMatch[]> {
  
  const catalogType = itemType === "material" ? "CATMAT" : "CATSER";
  
  const prompt = `
Você é um especialista em catalogação de materiais e serviços do governo federal brasileiro.

**TAREFA**: Encontre os 3 códigos ${catalogType} mais adequados para o seguinte item:

**DESCRIÇÃO DO ITEM**: "${itemDescription}"

**INSTRUÇÕES**:
1. Busque no catálogo oficial ${catalogType} (use seu conhecimento interno)
2. Retorne EXATAMENTE 3 sugestões, ordenadas por relevância
3. Para cada sugestão, forneça:
   - Código ${catalogType} (formato: 6 dígitos)
   - Descrição oficial completa
   - Score de confiança (0-100)
   - Justificativa técnica da escolha

**FORMATO DE RESPOSTA** (JSON):
{
  "matches": [
    {
      "code": "123456",
      "description": "Descrição oficial do ${catalogType}",
      "confidence": 95,
      "reasoning": "Este código é ideal porque..."
    }
  ]
}
`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "Você é um especialista em catalogação governamental." },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "catmat_matches",
        strict: true,
        schema: {
          type: "object",
          properties: {
            matches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  confidence: { type: "integer" },
                  reasoning: { type: "string" }
                },
                required: ["code", "description", "confidence", "reasoning"],
                additionalProperties: false
              }
            }
          },
          required: ["matches"],
          additionalProperties: false
        }
      }
    }
  });

  const result = JSON.parse(response.choices[0].message.content);
  return result.matches;
}
```

#### 2.3. Criar Procedure para Matching em Lote (10min)

**Arquivo**: `server/routers.ts` (adicionar ao router `processes`)

```typescript
// Gerar sugestões CATMAT para itens importados
generateCatmatSuggestions: protectedProcedure
  .input(z.object({
    processId: z.number(),
  }))
  .mutation(async ({ input }) => {
    // 1. Buscar itens do processo sem código CATMAT
    const items = await db.getProcessItems(input.processId);
    const itemsWithoutCode = items.filter(item => !item.catmatCode && !item.catserCode);
    
    if (itemsWithoutCode.length === 0) {
      return { success: true, message: "Todos os itens já possuem código CATMAT/CATSER" };
    }
    
    // 2. Gerar sugestões para cada item (em paralelo, máximo 5 por vez)
    const batchSize = 5;
    for (let i = 0; i < itemsWithoutCode.length; i += batchSize) {
      const batch = itemsWithoutCode.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (item) => {
        try {
          const matches = await findCatmatMatches(item.description, item.itemType);
          
          // 3. Salvar sugestões no banco
          for (const match of matches) {
            await db.createCatmatSuggestion({
              processItemId: item.id,
              catmatCode: match.code,
              description: match.description,
              confidenceScore: match.confidence,
              reasoning: match.reasoning,
              status: "pending",
            });
          }
        } catch (error) {
          console.error(`Erro ao gerar sugestões para item ${item.id}:`, error);
        }
      }));
    }
    
    return { 
      success: true, 
      itemsProcessed: itemsWithoutCode.length,
      message: `Sugestões geradas para ${itemsWithoutCode.length} itens`
    };
  }),

// Listar sugestões de um item
getCatmatSuggestions: protectedProcedure
  .input(z.object({
    processItemId: z.number(),
  }))
  .query(async ({ input }) => {
    return await db.getCatmatSuggestionsByItem(input.processItemId);
  }),

// Aprovar sugestão (vincular código ao item)
approveCatmatSuggestion: protectedProcedure
  .input(z.object({
    suggestionId: z.number(),
  }))
  .mutation(async ({ input }) => {
    const suggestion = await db.getCatmatSuggestionById(input.suggestionId);
    
    if (!suggestion) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Sugestão não encontrada" });
    }
    
    // 1. Atualizar item com código CATMAT
    await db.updateProcessItem(suggestion.processItemId, {
      catmatCode: suggestion.catmatCode,
      description: suggestion.description, // Usar descrição oficial
    });
    
    // 2. Marcar sugestão como aprovada
    await db.updateCatmatSuggestion(input.suggestionId, { status: "approved" });
    
    // 3. Rejeitar outras sugestões do mesmo item
    await db.rejectOtherSuggestions(suggestion.processItemId, input.suggestionId);
    
    return { success: true };
  }),

// Rejeitar sugestão
rejectCatmatSuggestion: protectedProcedure
  .input(z.object({
    suggestionId: z.number(),
  }))
  .mutation(async ({ input }) => {
    await db.updateCatmatSuggestion(input.suggestionId, { status: "rejected" });
    return { success: true };
  }),
```

#### 2.4. Criar Funções de Banco de Dados (5min)

**Arquivo**: `server/db.ts`

```typescript
export async function createCatmatSuggestion(data: {
  processItemId: number;
  catmatCode: string;
  description: string;
  confidenceScore: number;
  reasoning: string;
  status: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.insert(catmatSuggestions).values(data);
}

export async function getCatmatSuggestionsByItem(processItemId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(catmatSuggestions)
    .where(eq(catmatSuggestions.processItemId, processItemId))
    .orderBy(desc(catmatSuggestions.confidenceScore));
}

export async function getCatmatSuggestionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(catmatSuggestions)
    .where(eq(catmatSuggestions.id, id))
    .limit(1);
  
  return result[0];
}

export async function updateCatmatSuggestion(id: number, data: { status: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db
    .update(catmatSuggestions)
    .set(data)
    .where(eq(catmatSuggestions.id, id));
}

export async function rejectOtherSuggestions(processItemId: number, approvedId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db
    .update(catmatSuggestions)
    .set({ status: "rejected" })
    .where(
      and(
        eq(catmatSuggestions.processItemId, processItemId),
        ne(catmatSuggestions.id, approvedId),
        eq(catmatSuggestions.status, "pending")
      )
    );
}

export async function updateProcessItem(id: number, data: Partial<ProcessItem>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db
    .update(processItems)
    .set(data)
    .where(eq(processItems.id, id));
}
```

#### 2.5. Criar Componente de Revisão de Sugestões (10min)

**Arquivo**: `client/src/components/CatmatSuggestionsModal.tsx`

```typescript
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, Sparkles } from "lucide-react";

interface CatmatSuggestionsModalProps {
  processId: number;
  open: boolean;
  onClose: () => void;
}

export function CatmatSuggestionsModal({ processId, open, onClose }: CatmatSuggestionsModalProps) {
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  
  const { data: items, refetch } = trpc.processes.getProcessItems.useQuery(
    { processId },
    { enabled: open }
  );
  
  const generateMutation = trpc.processes.generateCatmatSuggestions.useMutation({
    onSuccess: () => {
      toast.success("Sugestões geradas com sucesso!");
      refetch();
    },
  });
  
  const approveMutation = trpc.processes.approveCatmatSuggestion.useMutation({
    onSuccess: () => {
      toast.success("Código CATMAT vinculado!");
      refetch();
    },
  });
  
  const rejectMutation = trpc.processes.rejectCatmatSuggestion.useMutation({
    onSuccess: () => {
      refetch();
    },
  });
  
  const itemsWithoutCode = items?.filter(item => !item.catmatCode && !item.catserCode) || [];
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Sugestões Inteligentes de Códigos CATMAT/CATSER
          </DialogTitle>
        </DialogHeader>
        
        {itemsWithoutCode.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-900">
              <strong>{itemsWithoutCode.length} itens</strong> importados sem código CATMAT/CATSER.
              Clique no botão abaixo para gerar sugestões automáticas usando IA.
            </p>
            <Button
              onClick={() => generateMutation.mutate({ processId })}
              disabled={generateMutation.isPending}
              className="mt-3"
            >
              {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Sparkles className="mr-2 h-4 w-4" />
              Gerar Sugestões com IA
            </Button>
          </div>
        )}
        
        <div className="space-y-6">
          {items?.map((item, index) => (
            <ItemSuggestions
              key={item.id}
              item={item}
              onApprove={(suggestionId) => approveMutation.mutate({ suggestionId })}
              onReject={(suggestionId) => rejectMutation.mutate({ suggestionId })}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ItemSuggestions({ item, onApprove, onReject }) {
  const { data: suggestions } = trpc.processes.getCatmatSuggestions.useQuery(
    { processItemId: item.id },
    { enabled: !item.catmatCode && !item.catserCode }
  );
  
  if (item.catmatCode || item.catserCode) {
    return (
      <div className="border rounded-lg p-4 bg-green-50">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-green-900">{item.description}</p>
            <p className="text-sm text-green-700 mt-1">
              Código: <span className="font-mono">{item.catmatCode || item.catserCode}</span>
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="border rounded-lg p-4">
      <h4 className="font-medium mb-3">{item.description}</h4>
      
      {!suggestions || suggestions.length === 0 ? (
        <p className="text-sm text-gray-500">Aguardando sugestões...</p>
      ) : (
        <div className="space-y-3">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-medium">{suggestion.catmatCode}</span>
                    <Badge variant={
                      suggestion.confidenceScore >= 80 ? "default" :
                      suggestion.confidenceScore >= 60 ? "secondary" : "outline"
                    }>
                      {suggestion.confidenceScore}% confiança
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{suggestion.description}</p>
                  <p className="text-xs text-gray-500">{suggestion.reasoning}</p>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onApprove(suggestion.id)}
                    disabled={suggestion.status !== "pending"}
                  >
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReject(suggestion.id)}
                    disabled={suggestion.status !== "pending"}
                  >
                    <XCircle className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Validação da Fase 2

- [ ] Tabela `catmat_suggestions` criada
- [ ] Função `findCatmatMatches` retorna 3 sugestões válidas
- [ ] Procedure `generateCatmatSuggestions` processa lote de itens
- [ ] Modal exibe sugestões com scores de confiança
- [ ] Aprovar sugestão vincula código ao item
- [ ] Rejeitar sugestão remove da lista

---

## ✏️ Fase 3: Edição de Itens Importados (20 minutos)

### Objetivo
Permitir que usuário edite manualmente descrição, quantidade, unidade e vincule códigos CATMAT/CATSER aos itens após importação.

### Passos de Implementação

#### 3.1. Criar Procedure de Atualização (5min)

**Arquivo**: `server/routers.ts` (adicionar ao router `processes`)

```typescript
// Atualizar item do processo
updateProcessItem: protectedProcedure
  .input(z.object({
    itemId: z.number(),
    description: z.string().optional(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    estimatedPrice: z.number().optional(),
    catmatCode: z.string().optional(),
    catserCode: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const { itemId, ...updateData } = input;
    
    await db.updateProcessItem(itemId, updateData);
    
    return { success: true };
  }),

// Deletar item do processo
deleteProcessItem: protectedProcedure
  .input(z.object({
    itemId: z.number(),
  }))
  .mutation(async ({ input }) => {
    await db.deleteProcessItem(input.itemId);
    return { success: true };
  }),
```

#### 3.2. Adicionar Função de Delete no DB (2min)

**Arquivo**: `server/db.ts`

```typescript
export async function deleteProcessItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db
    .delete(processItems)
    .where(eq(processItems.id, id));
}
```

#### 3.3. Criar Componente de Edição (13min)

**Arquivo**: `client/src/components/EditItemDialog.tsx`

```typescript
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface EditItemDialogProps {
  item: any;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditItemDialog({ item, open, onClose, onSuccess }: EditItemDialogProps) {
  const [formData, setFormData] = useState({
    description: item.description || "",
    quantity: item.quantity || 1,
    unit: item.unit || "UN",
    estimatedPrice: item.estimatedPrice || 0,
    catmatCode: item.catmatCode || "",
    catserCode: item.catserCode || "",
  });
  
  const updateMutation = trpc.processes.updateProcessItem.useMutation({
    onSuccess: () => {
      toast.success("Item atualizado com sucesso!");
      onSuccess();
      onClose();
    },
    onError: (error) => {
      toast.error("Erro ao atualizar item", { description: error.message });
    },
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    updateMutation.mutate({
      itemId: item.id,
      ...formData,
    });
  };
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar Item</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="description">Descrição *</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              required
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="quantity">Quantidade *</Label>
              <Input
                id="quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
                required
              />
            </div>
            
            <div>
              <Label htmlFor="unit">Unidade *</Label>
              <Input
                id="unit"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                placeholder="UN, KG, M, etc."
                required
              />
            </div>
          </div>
          
          <div>
            <Label htmlFor="estimatedPrice">Preço Estimado (R$)</Label>
            <Input
              id="estimatedPrice"
              type="number"
              min="0"
              step="0.01"
              value={formData.estimatedPrice}
              onChange={(e) => setFormData({ ...formData, estimatedPrice: parseFloat(e.target.value) })}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="catmatCode">Código CATMAT</Label>
              <Input
                id="catmatCode"
                value={formData.catmatCode}
                onChange={(e) => setFormData({ ...formData, catmatCode: e.target.value })}
                placeholder="123456"
              />
            </div>
            
            <div>
              <Label htmlFor="catserCode">Código CATSER</Label>
              <Input
                id="catserCode"
                value={formData.catserCode}
                onChange={(e) => setFormData({ ...formData, catserCode: e.target.value })}
                placeholder="123456"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

#### 3.4. Integrar Edição no TRItemsModal (5min)

**Arquivo**: `client/src/components/TRItemsModal.tsx` (modificar seção "Itens Já Adicionados")

```typescript
import { EditItemDialog } from "@/components/EditItemDialog";
import { Pencil, Trash2 } from "lucide-react";

// Adicionar estados
const [editingItem, setEditingItem] = useState<any>(null);

const deleteMutation = trpc.processes.deleteProcessItem.useMutation({
  onSuccess: () => {
    toast.success("Item removido");
    refetch();
  },
});

// Modificar tabela de itens já adicionados
{existingItems && existingItems.length > 0 && (
  <div className="space-y-2 mt-6 pt-6 border-t">
    <h3 className="text-sm font-medium">Itens Já Adicionados ({existingItems.length})</h3>
    <div className="border rounded-lg bg-muted/50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Unidade</TableHead>
            <TableHead>Quantidade</TableHead>
            <TableHead className="w-[100px]">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {existingItems.map((item, index) => (
            <TableRow key={index}>
              <TableCell className="font-mono text-sm">
                {item.catmatCode || item.catserCode || "-"}
              </TableCell>
              <TableCell>{item.description}</TableCell>
              <TableCell>{item.unit}</TableCell>
              <TableCell>{item.quantity || "-"}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingItem(item)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Deseja realmente remover este item?")) {
                        deleteMutation.mutate({ itemId: item.id });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </div>
)}

{/* Modal de edição */}
{editingItem && (
  <EditItemDialog
    item={editingItem}
    open={!!editingItem}
    onClose={() => setEditingItem(null)}
    onSuccess={() => refetch()}
  />
)}
```

### Validação da Fase 3

- [ ] Botão "Editar" aparece em cada item da lista
- [ ] Modal de edição abre com dados preenchidos
- [ ] Salvar alterações atualiza item no banco
- [ ] Botão "Deletar" remove item com confirmação
- [ ] Alterações refletem imediatamente na lista

---

## 🧪 Fase 4: Testes e Validação (15 minutos)

### Checklist de Testes

#### Teste 1: Sistema RAG (5min)
- [ ] Executar script de indexação: `node server/scripts/indexLaw14133.mjs`
- [ ] Verificar no banco: `SELECT COUNT(*) FROM law_chunks` (deve ter 100+ registros)
- [ ] Criar novo processo e gerar ETP
- [ ] Verificar se documento cita artigos específicos da Lei 14.133/21
- [ ] Exemplo esperado: "Conforme Art. 6º, XXIII da Lei 14.133/21..."

#### Teste 2: Fluxo Completo de Importação (5min)
- [ ] Criar processo licitatório
- [ ] Gerar ETP
- [ ] Clicar em "Adicionar Itens ao TR"
- [ ] Ir para aba "Importar Planilha"
- [ ] Fazer upload de arquivo Excel de teste (criar com 10 itens)
- [ ] Mapear colunas (Descrição, Quantidade, Unidade)
- [ ] Clicar em "Analisar Itens"
- [ ] Revisar preview dos 10 itens
- [ ] Clicar em "Importar"
- [ ] Verificar se itens aparecem na seção "Itens Já Adicionados"

#### Teste 3: Matching Inteligente (3min)
- [ ] Com itens importados sem código CATMAT
- [ ] Abrir modal "Sugestões Inteligentes"
- [ ] Clicar em "Gerar Sugestões com IA"
- [ ] Aguardar processamento (~30s para 10 itens)
- [ ] Verificar se aparecem 3 sugestões por item
- [ ] Verificar scores de confiança (0-100)
- [ ] Aprovar uma sugestão
- [ ] Verificar se código foi vinculado ao item

#### Teste 4: Edição de Itens (2min)
- [ ] Clicar em botão "Editar" de um item
- [ ] Alterar descrição
- [ ] Alterar quantidade
- [ ] Adicionar código CATMAT manualmente
- [ ] Salvar
- [ ] Verificar se alterações foram aplicadas
- [ ] Testar botão "Deletar" em outro item

### Arquivo de Teste Excel

Criar arquivo `test_items.xlsx` com seguinte estrutura:

| Descrição | Quantidade | Unidade | Valor Unitário |
|-----------|------------|---------|----------------|
| Caneta esferográfica azul | 100 | UN | 1.50 |
| Papel A4 75g/m² | 50 | RESMA | 25.00 |
| Grampeador de mesa | 10 | UN | 35.00 |
| Clips de aço nº 2 | 20 | CAIXA | 5.00 |
| Borracha branca | 50 | UN | 0.80 |
| Lápis preto nº 2 | 100 | UN | 1.20 |
| Tesoura de escritório | 15 | UN | 12.00 |
| Cola bastão 40g | 30 | UN | 4.50 |
| Marca-texto amarelo | 25 | UN | 3.00 |
| Pasta suspensa | 40 | UN | 2.50 |

---

## 📝 Comandos de Execução Rápida

### 1. Preparação Inicial
```bash
cd /home/ubuntu/licigov-pro

# Atualizar dependências
pnpm install

# Aplicar migrations do banco
pnpm db:push
```

### 2. Indexar Lei 14.133/21
```bash
# Executar script de indexação
node server/scripts/indexLaw14133.mjs
```

### 3. Verificar Servidor
```bash
# Servidor deve estar rodando em https://3000-...
# Abrir no navegador e fazer login
```

### 4. Executar Testes
```bash
# Seguir checklist de testes acima
# Validar cada funcionalidade
```

---

## 🎯 Critérios de Sucesso

### Funcionalidade Mínima Aceitável
- ✅ Sistema RAG indexa Lei 14.133/21 e melhora documentos gerados
- ✅ Matching inteligente sugere 3 códigos CATMAT por item
- ✅ Usuário consegue editar e deletar itens importados
- ✅ Fluxo completo funciona sem erros

### Qualidade Esperada
- ✅ Documentos gerados citam artigos específicos da Lei
- ✅ Sugestões CATMAT têm score de confiança ≥ 70%
- ✅ Interface responsiva e intuitiva
- ✅ Feedback visual em todas as operações

### Performance
- ✅ Indexação da Lei: < 2 minutos
- ✅ Geração de sugestões: < 5 segundos por item
- ✅ Edição de item: < 1 segundo

---

## 🚨 Possíveis Problemas e Soluções

### Problema 1: Erro ao indexar Lei
**Sintoma**: Script `indexLaw14133.mjs` falha  
**Causa**: Arquivo `lei_14133_2021.txt` não encontrado  
**Solução**: Baixar Lei completa e salvar em `data/lei_14133_2021.txt`

### Problema 2: Sugestões CATMAT genéricas
**Sintoma**: IA retorna códigos irrelevantes  
**Causa**: Prompt muito vago  
**Solução**: Melhorar prompt com exemplos e contexto adicional

### Problema 3: Timeout ao gerar sugestões
**Sintoma**: Mutation demora muito (> 30s)  
**Causa**: Muitos itens processados em paralelo  
**Solução**: Reduzir `batchSize` de 5 para 3

### Problema 4: Embeddings muito lentos
**Sintoma**: Indexação demora > 5 minutos  
**Causa**: API Gemini com rate limit  
**Solução**: Adicionar delay de 100ms entre requests

---

## 📊 Estimativa de Custos (IA)

### Indexação Inicial (uma vez)
- Lei 14.133/21: ~50.000 palavras = ~65.000 tokens
- Embeddings: 65.000 tokens ÷ 512 (chunk) = ~130 chunks
- Custo: 130 × US$ 0,00001 = **US$ 0,0013** (menos de 1 centavo)

### Uso Mensal (1000 processos)
- 4 documentos por processo = 4.000 gerações
- RAG retrieval: 5 chunks × 512 tokens = 2.560 tokens de contexto extra
- Custo adicional por geração: ~US$ 0,0002
- **Total mensal**: US$ 0,80 (RAG) + US$ 30 (geração base) = **US$ 30,80**

### Matching CATMAT (1000 processos, 20 itens cada)
- 20.000 itens × 3 sugestões = 60.000 chamadas de IA
- Custo por chamada: ~US$ 0,0001
- **Total mensal**: US$ 6,00

**Custo total estimado**: US$ 36,80/mês para 1000 processos

---

## ✅ Entrega Final

Após execução completa, o usuário terá:

1. **Sistema RAG funcional** melhorando qualidade dos documentos
2. **Matching inteligente** economizando tempo na catalogação
3. **Interface completa** para gerenciar itens importados
4. **Testes validados** garantindo funcionamento correto

**Próximo passo recomendado**: Coletar feedback de usuários beta e ajustar prompts de IA baseado em casos reais.

---

**Documento preparado por**: Manus AI  
**Versão**: 1.0  
**Data**: 15 de novembro de 2025
