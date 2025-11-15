# 📋 Guia de Acompanhamento da Reindexação RAG

## 🎯 Objetivo

Este guia explica como acompanhar o progresso da reindexação dos 6 documentos legais no sistema RAG do LiciGov Pro.

---

## 📊 Status Atual

**Iniciado em**: Verificar timestamp do arquivo `/tmp/reindex_all.log`  
**Estimativa de conclusão**: ~2 horas (155 minutos)  
**Log completo**: `/tmp/reindex_all.log`

---

## 🔍 Como Acompanhar o Progresso

### Opção 1: Ver últimas 20 linhas do log
```bash
tail -20 /tmp/reindex_all.log
```

### Opção 2: Ver progresso em tempo real
```bash
tail -f /tmp/reindex_all.log
```
*(Pressione Ctrl+C para sair)*

### Opção 3: Ver apenas linhas de progresso
```bash
grep "Progresso:" /tmp/reindex_all.log | tail -10
```

### Opção 4: Ver resumo de documentos indexados
```bash
grep -E "(Indexando|concluída)" /tmp/reindex_all.log
```

---

## 📚 Ordem de Indexação

1. **Lei 14.133/21** - 681 chunks (~12 min)
2. **Lei 8.666/93** - 520 chunks (~9 min)
3. **Decreto 11.462/2023** - 101 chunks (~2 min)
4. **IN SEGES 65/2021** - 34 chunks (~1 min)
5. **LC 123/2006** - 749 chunks (~13 min)
6. **Manual TCU** - 6.581 chunks (~110 min) ⚠️ **Mais demorado**
7. **Manual TCE-PR** - 1.116 chunks (~19 min)

**Total**: ~9.782 chunks (~166 minutos)

---

## ✅ Como Saber Quando Terminou

Procure esta mensagem no log:
```
✅ Reindexação completa finalizada!
```

Ou execute:
```bash
grep "Reindexação completa finalizada" /tmp/reindex_all.log
```

Se retornar algo, a reindexação terminou! ✅

---

## 🧪 Validar RAG Após Conclusão

Após a reindexação terminar, execute este script para testar o RAG:

```bash
cd /home/ubuntu/licigov-pro
pnpm tsx server/scripts/testRAG.ts
```

**Resultado esperado**:
- ✅ 5 trechos relevantes encontrados
- ✅ Scores de similaridade entre 60-95%
- ✅ Trechos citam artigos específicos das leis
- ❌ **NÃO** deve haver erros de JSON parse

---

## 📈 Verificar Chunks no Banco de Dados

```bash
cd /home/ubuntu/licigov-pro
pnpm tsx -e "
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute('SELECT lawName, COUNT(*) as chunks FROM law_chunks GROUP BY lawName');
console.table(rows);
await conn.end();
"
```

**Resultado esperado**:
```
┌─────────┬────────────────────────────┬────────┐
│ (index) │          lawName           │ chunks │
├─────────┼────────────────────────────┼────────┤
│    0    │ 'Lei 14.133/21'            │  681   │
│    1    │ 'Lei 8.666/93'             │  520   │
│    2    │ 'Decreto 11.462/2023'      │  101   │
│    3    │ 'IN SEGES 65/2021'         │   34   │
│    4    │ 'LC 123/2006'              │  749   │
│    5    │ 'Manual TCU Licitações'    │ 6581   │
│    6    │ 'Manual TCE-PR Licitações' │ 1116   │
└─────────┴────────────────────────────┴────────┘
Total: 9782 chunks
```

---

## 🚨 Problemas Comuns

### Problema: Processo parou no meio
**Sintoma**: Log não atualiza há mais de 5 minutos  
**Solução**:
```bash
# Verificar se processo ainda está rodando
ps aux | grep reindexAll

# Se não estiver rodando, reiniciar do ponto onde parou
cd /home/ubuntu/licigov-pro
bash server/scripts/reindexAll.sh >> /tmp/reindex_all.log 2>&1 &
```

### Problema: Erros de rate limit da API Gemini
**Sintoma**: Muitos erros "429 Too Many Requests" no log  
**Solução**: O script já tem delay de 100ms entre requisições. Se persistir, aumentar delay:
```bash
# Editar server/scripts/indexLaw.ts
# Linha 101: await new Promise(resolve => setTimeout(resolve, 200)); // 200ms
```

### Problema: Embeddings ainda com formato inválido após reindexação
**Sintoma**: Erros de JSON parse no teste do RAG  
**Solução**: Verificar se a correção do script foi aplicada:
```bash
grep "CAST(? AS JSON)" server/scripts/indexLaw.ts
```
Deve retornar a linha com `CAST(? AS JSON)`. Se não retornar, o script não foi corrigido.

---

## 📞 Suporte

Se encontrar problemas, verifique:
1. Log completo: `cat /tmp/reindex_all.log`
2. Erros recentes: `grep -i error /tmp/reindex_all.log | tail -20`
3. Chunks no banco: Script de verificação acima

---

**Última atualização**: 2025-01-15
