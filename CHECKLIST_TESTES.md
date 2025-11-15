# ✅ Checklist de Validação e Testes - LiciGov Pro

**Versão**: 1.0  
**Data**: 15 de novembro de 2025  
**Autor**: Manus AI

---

## 📊 Visão Geral

Este documento contém todos os testes necessários para validar as novas funcionalidades implementadas no LiciGov Pro. Cada teste inclui passos detalhados, critérios de sucesso e possíveis erros.

---

## 🧪 Teste 1: Sistema RAG - Indexação da Lei 14.133/21

### Objetivo
Verificar se a Lei 14.133/21 foi corretamente indexada no banco de dados e se o sistema consegue recuperar trechos relevantes.

### Pré-requisitos
- [ ] Arquivo `data/lei_14133_2021.txt` existe
- [ ] Tabela `law_chunks` criada no banco
- [ ] Script `server/scripts/indexLaw14133.mjs` criado

### Passos de Execução

**Passo 1.1: Executar Script de Indexação**
```bash
cd /home/ubuntu/licigov-pro
node server/scripts/indexLaw14133.mjs
```

**Resultado Esperado:**
```
🔄 Iniciando indexação da Lei 14.133/21...
📄 Lei dividida em 127 chunks
⚙️  Processando chunk 1/127...
⚙️  Processando chunk 2/127...
...
✅ Indexação concluída!
```

**Passo 1.2: Verificar Dados no Banco**
```bash
# Acessar banco de dados
pnpm drizzle-kit studio

# Ou via SQL direto
mysql -u root -p -e "SELECT COUNT(*) as total_chunks FROM law_chunks WHERE law_name = 'Lei 14.133/21';"
```

**Resultado Esperado:**
- Total de chunks: entre 100 e 150
- Cada chunk tem: id, lawName, chunkIndex, content, embedding, articleNumber

**Passo 1.3: Testar Recuperação de Trechos**

Criar arquivo de teste `test_rag.mjs`:
```javascript
import { retrieveRelevantLaw } from "./server/services/rag.js";

const query = "Estudo Técnico Preliminar para aquisição de materiais de escritório";
const results = await retrieveRelevantLaw(query, 5);

console.log("📚 Trechos recuperados:");
results.forEach((chunk, i) => {
  console.log(`\n${i + 1}. ${chunk.articleNumber || "Preâmbulo"} (${(chunk.similarity * 100).toFixed(1)}% relevância)`);
  console.log(chunk.content.substring(0, 200) + "...");
});
```

Executar:
```bash
node test_rag.mjs
```

**Resultado Esperado:**
- 5 trechos retornados
- Similaridade > 0.5 (50%) para pelo menos 3 trechos
- Artigos relevantes (ex: Art. 6º, Art. 18º, Art. 19º)

### Critérios de Sucesso
- [ ] Script executa sem erros
- [ ] Pelo menos 100 chunks indexados
- [ ] Função `retrieveRelevantLaw` retorna trechos relevantes
- [ ] Similaridade média > 50%
- [ ] Tempo de indexação < 5 minutos

### Possíveis Erros

| Erro | Causa | Solução |
|------|-------|---------|
| `ENOENT: no such file` | Arquivo da Lei não encontrado | Baixar Lei e salvar em `data/lei_14133_2021.txt` |
| `Database not available` | Banco não conectado | Verificar `DATABASE_URL` no `.env` |
| `Rate limit exceeded` | Muitas requisições à API | Adicionar delay de 200ms entre chunks |
| `Embedding dimension mismatch` | Modelo errado | Usar `text-embedding-004` |

---

## 🧪 Teste 2: Sistema RAG - Geração de Documentos com Contexto Legal

### Objetivo
Verificar se os documentos gerados (ETP, TR, DFD, Edital) citam artigos específicos da Lei 14.133/21.

### Pré-requisitos
- [ ] Teste 1 concluído com sucesso
- [ ] Funções de geração modificadas para usar RAG
- [ ] Servidor rodando

### Passos de Execução

**Passo 2.1: Criar Novo Processo**
1. Fazer login no LiciGov Pro
2. Clicar em "Novo Processo"
3. Preencher formulário:
   - Nome: "Aquisição de Material de Escritório 2025"
   - Objeto: "Aquisição de materiais de escritório para atender as demandas administrativas"
   - Valor Estimado: R$ 50.000,00
   - Modalidade: Pregão Eletrônico
   - Categoria: Compras
4. Clicar em "Criar Processo"

**Passo 2.2: Aguardar Geração do ETP**
- Sistema gera ETP automaticamente em background
- Aguardar ~30 segundos
- Recarregar página de detalhes do processo

**Passo 2.3: Analisar Documento Gerado**

Verificar se o ETP contém:
- [ ] Citação explícita de artigos (ex: "Conforme Art. 6º, XXIII da Lei 14.133/21...")
- [ ] Pelo menos 3 artigos diferentes citados
- [ ] Contexto legal relevante para o objeto da contratação
- [ ] Estrutura conforme Lei 14.133/21

**Exemplo de trecho esperado:**
```
## 1. Fundamentação Legal

Conforme Art. 6º, XXIII da Lei 14.133/21, o Estudo Técnico Preliminar (ETP) 
é o documento constitutivo da primeira etapa do planejamento de uma contratação, 
que caracteriza o interesse público envolvido e a sua melhor solução...

## 2. Necessidade da Contratação

De acordo com o Art. 11 da Lei 14.133/21, a etapa de planejamento da contratação 
deverá observar o princípio do planejamento, de modo a assegurar a seleção da 
proposta apta a gerar o resultado de contratação mais vantajoso...
```

**Passo 2.4: Repetir para TR, DFD e Edital**
1. Clicar em "Adicionar Itens ao TR"
2. Adicionar pelo menos 1 item (busca manual ou importação)
3. Gerar TR
4. Verificar citações legais no TR
5. Gerar DFD
6. Verificar citações legais no DFD
7. Gerar Edital
8. Verificar citações legais no Edital

### Critérios de Sucesso
- [ ] Todos os 4 documentos citam artigos específicos
- [ ] Pelo menos 3 artigos diferentes por documento
- [ ] Citações são relevantes para o contexto
- [ ] Estrutura dos documentos está conforme Lei
- [ ] Tempo de geração < 60 segundos por documento

### Possíveis Erros

| Erro | Causa | Solução |
|------|-------|---------|
| Documento sem citações | RAG não integrado | Verificar se `retrieveRelevantLaw` é chamado |
| Citações genéricas | Query de busca vaga | Melhorar query com mais contexto |
| Artigos irrelevantes | Embeddings de baixa qualidade | Re-indexar Lei com chunks menores |
| Timeout na geração | Muitos chunks recuperados | Reduzir `topK` de 5 para 3 |

---

## 🧪 Teste 3: Matching Inteligente - Geração de Sugestões CATMAT

### Objetivo
Verificar se a IA consegue sugerir códigos CATMAT/CATSER relevantes para itens importados de planilha.

### Pré-requisitos
- [ ] Tabela `catmat_suggestions` criada
- [ ] Serviço `catmatMatcher.ts` implementado
- [ ] Procedures tRPC criadas
- [ ] Arquivo `test_items.xlsx` criado

### Passos de Execução

**Passo 3.1: Criar Arquivo de Teste**

Criar `test_items.xlsx` com seguinte conteúdo:

| Descrição | Quantidade | Unidade | Valor Unitário |
|-----------|------------|---------|----------------|
| Caneta esferográfica azul ponta média | 100 | UN | 1.50 |
| Papel sulfite A4 75g/m² branco | 50 | RESMA | 25.00 |
| Grampeador de mesa capacidade 20 folhas | 10 | UN | 35.00 |
| Clips de aço nº 2 caixa com 100 unidades | 20 | CAIXA | 5.00 |
| Borracha branca macia para lápis | 50 | UN | 0.80 |

**Passo 3.2: Importar Planilha**
1. Abrir processo criado no Teste 2
2. Clicar em "Adicionar Itens ao TR"
3. Ir para aba "Importar Planilha"
4. Fazer upload de `test_items.xlsx`
5. Mapear colunas:
   - Descrição: Coluna A
   - Quantidade: Coluna B
   - Unidade: Coluna C
   - Valor Unitário: Coluna D
6. Clicar em "Analisar Itens"
7. Revisar preview
8. Clicar em "Importar 5 Itens"

**Resultado Esperado:**
- Toast: "5 itens importados com sucesso"
- Itens aparecem na seção "Itens Já Adicionados"
- Códigos CATMAT/CATSER estão vazios

**Passo 3.3: Gerar Sugestões com IA**
1. Clicar em botão "Sugestões Inteligentes" (adicionar ao TRItemsModal)
2. Clicar em "Gerar Sugestões com IA"
3. Aguardar processamento (~15-30 segundos para 5 itens)

**Resultado Esperado:**
- Toast: "Sugestões geradas para 5 itens"
- Modal exibe 3 sugestões por item
- Cada sugestão tem:
  - Código CATMAT (6 dígitos)
  - Descrição oficial
  - Score de confiança (0-100)
  - Justificativa técnica

**Passo 3.4: Validar Qualidade das Sugestões**

Para o item "Caneta esferográfica azul ponta média", verificar:
- [ ] Código CATMAT está no formato correto (6 dígitos)
- [ ] Descrição é similar ao item importado
- [ ] Score de confiança ≥ 70%
- [ ] Justificativa faz sentido

**Exemplo esperado:**
```
Código: 123456
Descrição: CANETA ESFEROGRAFICA, MATERIAL PLASTICO, COR AZUL, PONTA MEDIA
Confiança: 92%
Justificativa: Este código é ideal porque corresponde exatamente à descrição 
fornecida, incluindo o tipo (esferográfica), cor (azul) e especificação da 
ponta (média). É o código mais utilizado para este tipo de material de escritório.
```

**Passo 3.5: Aprovar Sugestão**
1. Clicar em botão ✓ (aprovar) na primeira sugestão
2. Verificar se código foi vinculado ao item
3. Verificar se outras sugestões do mesmo item foram rejeitadas

**Passo 3.6: Rejeitar Sugestão**
1. Para outro item, clicar em botão ✗ (rejeitar) em uma sugestão
2. Verificar se sugestão desaparece da lista

### Critérios de Sucesso
- [ ] Geração de sugestões completa sem erros
- [ ] 3 sugestões por item (total: 15 sugestões)
- [ ] Score médio de confiança ≥ 70%
- [ ] Códigos CATMAT são válidos (6 dígitos)
- [ ] Descrições são relevantes
- [ ] Aprovar sugestão vincula código ao item
- [ ] Tempo de processamento < 10 segundos por item

### Possíveis Erros

| Erro | Causa | Solução |
|------|-------|---------|
| Timeout após 30s | Muitos itens processados | Reduzir `batchSize` para 3 |
| Sugestões genéricas | Prompt vago | Melhorar prompt com exemplos |
| Códigos inválidos | IA inventando códigos | Adicionar validação no prompt |
| Score sempre 100% | IA não calibrada | Ajustar prompt para ser mais crítico |

---

## 🧪 Teste 4: Edição de Itens Importados

### Objetivo
Verificar se usuário consegue editar e deletar itens após importação.

### Pré-requisitos
- [ ] Teste 3 concluído (itens importados)
- [ ] Componente `EditItemDialog` criado
- [ ] Procedures `updateProcessItem` e `deleteProcessItem` criadas

### Passos de Execução

**Passo 4.1: Editar Item**
1. Na lista "Itens Já Adicionados", clicar em botão ✏️ (editar) de um item
2. Modal de edição abre com dados preenchidos
3. Alterar campos:
   - Descrição: Adicionar "- ALTA QUALIDADE" no final
   - Quantidade: Aumentar em 50%
   - Unidade: Manter
   - Preço Estimado: Aumentar em 20%
   - Código CATMAT: Adicionar manualmente "999999"
4. Clicar em "Salvar Alterações"

**Resultado Esperado:**
- Toast: "Item atualizado com sucesso!"
- Modal fecha
- Item na lista reflete alterações
- Código CATMAT aparece na coluna correspondente

**Passo 4.2: Validar Persistência**
1. Recarregar página
2. Verificar se alterações foram mantidas

**Passo 4.3: Deletar Item**
1. Clicar em botão 🗑️ (deletar) de outro item
2. Confirmar deleção no dialog
3. Verificar se item desaparece da lista

**Passo 4.4: Validar Deleção**
1. Recarregar página
2. Verificar se item continua deletado
3. Verificar contagem de itens (deve ter diminuído)

### Critérios de Sucesso
- [ ] Modal de edição abre com dados corretos
- [ ] Todos os campos são editáveis
- [ ] Salvar alterações atualiza item no banco
- [ ] Alterações persistem após reload
- [ ] Deletar item remove do banco
- [ ] Confirmação de deleção funciona
- [ ] Tempo de resposta < 1 segundo

### Possíveis Erros

| Erro | Causa | Solução |
|------|-------|---------|
| Modal não abre | Componente não importado | Verificar imports no TRItemsModal |
| Alterações não salvam | Mutation falha | Verificar logs do servidor |
| Item não deleta | FK constraint | Deletar sugestões CATMAT primeiro |
| Reload perde alterações | Cache do tRPC | Adicionar `refetch()` após mutation |

---

## 🧪 Teste 5: Fluxo Completo End-to-End

### Objetivo
Validar todo o fluxo desde criação do processo até geração de documentos com itens importados e matching inteligente.

### Passos de Execução

**Passo 5.1: Criar Processo Completo**
1. Login no LiciGov Pro
2. Criar novo processo:
   - Nome: "Aquisição de Material de Limpeza 2025"
   - Objeto: "Aquisição de materiais de limpeza e higiene para manutenção das instalações"
   - Valor: R$ 80.000,00
   - Modalidade: Pregão Eletrônico
   - Categoria: Compras
3. Aguardar geração automática do ETP

**Passo 5.2: Importar Itens**
1. Clicar em "Adicionar Itens ao TR"
2. Aba "Importar Planilha"
3. Upload de arquivo com 10 itens de limpeza
4. Mapear colunas
5. Importar

**Passo 5.3: Gerar Sugestões CATMAT**
1. Clicar em "Sugestões Inteligentes"
2. Gerar sugestões para os 10 itens
3. Aprovar sugestões com score ≥ 80%
4. Rejeitar sugestões com score < 60%
5. Para itens sem sugestão boa, editar manualmente e buscar código CATMAT

**Passo 5.4: Gerar Documentos Restantes**
1. Gerar TR (deve incluir os 10 itens com códigos CATMAT)
2. Verificar se TR cita artigos da Lei 14.133/21
3. Gerar DFD
4. Verificar citações legais no DFD
5. Gerar Edital
6. Verificar se Edital lista todos os itens com códigos CATMAT

**Passo 5.5: Validar Documentos Finais**

Verificar no Edital:
- [ ] Todos os 10 itens estão listados
- [ ] Cada item tem código CATMAT
- [ ] Descrições são oficiais (do CATMAT)
- [ ] Quantidades e unidades corretas
- [ ] Valores estimados presentes
- [ ] Citações de artigos da Lei 14.133/21
- [ ] Estrutura conforme legislação

### Critérios de Sucesso
- [ ] Fluxo completo sem erros
- [ ] Todos os documentos gerados
- [ ] Itens importados aparecem nos documentos
- [ ] Códigos CATMAT vinculados
- [ ] Citações legais presentes
- [ ] Tempo total < 5 minutos

---

## 📊 Métricas de Performance

### Benchmarks Esperados

| Operação | Tempo Esperado | Tempo Máximo Aceitável |
|----------|----------------|------------------------|
| Indexação da Lei | 2-3 minutos | 5 minutos |
| Geração de ETP com RAG | 30-45 segundos | 60 segundos |
| Importação de 10 itens | 2-3 segundos | 5 segundos |
| Matching de 1 item | 3-5 segundos | 10 segundos |
| Matching de 10 itens | 15-30 segundos | 60 segundos |
| Edição de item | < 1 segundo | 2 segundos |
| Deleção de item | < 1 segundo | 2 segundos |

### Qualidade Esperada

| Métrica | Valor Esperado | Valor Mínimo Aceitável |
|---------|----------------|------------------------|
| Chunks indexados | 120-150 | 100 |
| Similaridade RAG | 60-80% | 50% |
| Score de confiança CATMAT | 75-90% | 70% |
| Artigos citados por documento | 5-8 | 3 |
| Precisão de sugestões CATMAT | 80-95% | 70% |

---

## 🚨 Troubleshooting

### Problema: Indexação da Lei muito lenta

**Sintomas:**
- Script demora > 10 minutos
- Muitos erros de rate limit

**Diagnóstico:**
```bash
# Verificar logs do script
node server/scripts/indexLaw14133.mjs 2>&1 | tee indexacao.log
grep "rate limit" indexacao.log
```

**Solução:**
Adicionar delay entre requisições:
```javascript
// Em indexLaw()
for (let i = 0; i < chunks.length; i++) {
  // ... código existente ...
  
  // Adicionar delay de 200ms
  await new Promise(resolve => setTimeout(resolve, 200));
}
```

### Problema: Sugestões CATMAT irrelevantes

**Sintomas:**
- Códigos não correspondem aos itens
- Scores de confiança muito baixos (< 50%)
- Justificativas genéricas

**Diagnóstico:**
Testar prompt diretamente:
```javascript
import { findCatmatMatches } from "./server/services/catmatMatcher.js";

const result = await findCatmatMatches("Caneta esferográfica azul");
console.log(JSON.stringify(result, null, 2));
```

**Solução:**
Melhorar prompt com exemplos:
```javascript
const prompt = `
Você é um especialista em catalogação de materiais do governo federal brasileiro.

**EXEMPLOS DE MATCHING CORRETO:**
- "Caneta esferográfica azul" → Código 123456 (CANETA ESFEROGRAFICA, PLASTICO, AZUL)
- "Papel A4 branco" → Código 234567 (PAPEL SULFITE, A4, 75G/M2, BRANCO)

**TAREFA**: Encontre os 3 códigos CATMAT mais adequados para: "${itemDescription}"
...
`;
```

### Problema: Documentos não citam artigos da Lei

**Sintomas:**
- ETP/TR/DFD/Edital gerados sem citações legais
- Estrutura genérica

**Diagnóstico:**
```javascript
// Testar RAG diretamente
import { retrieveRelevantLaw } from "./server/services/rag.js";

const chunks = await retrieveRelevantLaw("Estudo Técnico Preliminar", 5);
console.log("Chunks recuperados:", chunks.length);
console.log("Similaridade média:", chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length);
```

**Solução:**
1. Verificar se `retrieveRelevantLaw` está sendo chamado nas funções de geração
2. Aumentar `topK` de 5 para 10
3. Melhorar query de busca com mais contexto

---

## ✅ Checklist Final de Entrega

Antes de considerar a implementação concluída:

### Funcionalidades
- [ ] Sistema RAG indexa Lei 14.133/21
- [ ] Documentos citam artigos específicos
- [ ] Matching inteligente sugere códigos CATMAT
- [ ] Edição de itens funciona
- [ ] Deleção de itens funciona
- [ ] Fluxo completo E2E funciona

### Performance
- [ ] Indexação < 5 minutos
- [ ] Geração de documentos < 60 segundos
- [ ] Matching < 10 segundos por item
- [ ] Edição/deleção < 2 segundos

### Qualidade
- [ ] Similaridade RAG ≥ 50%
- [ ] Score CATMAT ≥ 70%
- [ ] Pelo menos 3 artigos citados por documento
- [ ] Sugestões CATMAT relevantes

### Documentação
- [ ] PLANO_IMPLEMENTACAO_RAG.md completo
- [ ] EXECUTAR_IMPLEMENTACAO.md criado
- [ ] CHECKLIST_TESTES.md criado
- [ ] todo.md atualizado

### Testes
- [ ] Teste 1: RAG - Indexação ✅
- [ ] Teste 2: RAG - Geração de Documentos ✅
- [ ] Teste 3: Matching Inteligente ✅
- [ ] Teste 4: Edição de Itens ✅
- [ ] Teste 5: Fluxo E2E ✅

---

**Documento preparado por**: Manus AI  
**Versão**: 1.0  
**Última atualização**: 15 de novembro de 2025
