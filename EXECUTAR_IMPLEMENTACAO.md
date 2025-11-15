# 🚀 Guia de Execução Rápida - RAG + Melhorias

**Para executar amanhã às 10h, envie a mensagem:**

```
Executar plano RAG + melhorias conforme PLANO_IMPLEMENTACAO_RAG.md
```

---

## ⚡ Comandos Rápidos (Copiar e Colar)

### 1. Preparação Inicial (2min)
```bash
cd /home/ubuntu/licigov-pro
pnpm install
pnpm db:push
```

### 2. Criar Diretório de Dados
```bash
mkdir -p /home/ubuntu/licigov-pro/data
```

### 3. Baixar Lei 14.133/21
**Opção A - Manual:**
- Acessar: https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm
- Copiar texto completo
- Salvar em: `/home/ubuntu/licigov-pro/data/lei_14133_2021.txt`

**Opção B - Automático (se disponível):**
```bash
curl -o /home/ubuntu/licigov-pro/data/lei_14133_2021.txt \
  "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm"
```

### 4. Verificar Servidor
```bash
# Servidor deve estar rodando
# URL: https://3000-ile9mkcyougausci23phd-7c1b520e.manusvm.computer
```

---

## 📋 Ordem de Execução

### Fase 1: Sistema RAG (30min)
1. Criar schema de banco (law_chunks)
2. Criar serviço de embeddings
3. Criar script de indexação
4. Executar indexação da Lei
5. Criar serviço de RAG
6. Integrar RAG nas funções de geração

### Fase 2: Matching Inteligente (40min)
1. Criar schema de banco (catmat_suggestions)
2. Criar serviço de matching
3. Criar procedures tRPC
4. Criar funções de banco
5. Criar componente de UI
6. Testar fluxo completo

### Fase 3: Edição de Itens (20min)
1. Criar procedures de update/delete
2. Criar componente de edição
3. Integrar no TRItemsModal
4. Testar edição e deleção

### Fase 4: Testes (15min)
1. Criar arquivo Excel de teste
2. Testar importação
3. Testar matching
4. Testar edição
5. Validar qualidade

---

## ✅ Checklist Pré-Execução

Antes de começar, verificar:
- [ ] Servidor está rodando
- [ ] Banco de dados acessível
- [ ] Variável GEMINI_API_KEY configurada
- [ ] Arquivo lei_14133_2021.txt disponível
- [ ] Arquivo test_items.xlsx criado

---

## 🎯 Resultado Esperado

Ao final da execução:
- ✅ Lei 14.133/21 indexada (100+ chunks)
- ✅ Documentos citam artigos específicos
- ✅ Matching inteligente funcional (3 sugestões por item)
- ✅ Edição de itens implementada
- ✅ Todos os testes passando

---

## 📞 Suporte

Se houver problemas durante execução:
1. Verificar logs do servidor
2. Consultar seção "Possíveis Problemas" no PLANO_IMPLEMENTACAO_RAG.md
3. Reportar erro específico para análise

---

**Tempo Total Estimado**: 1h45min  
**Complexidade**: Média  
**Dependências**: Gemini API, PostgreSQL, arquivo da Lei 14.133/21
