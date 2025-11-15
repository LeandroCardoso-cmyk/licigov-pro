# 📚 Guia: Adicionar Novos Documentos ao Sistema RAG

O sistema RAG do LiciGov Pro agora suporta **múltiplos documentos legais**. Este guia explica como adicionar novos documentos.

---

## 🎯 Documentos Recomendados

Além da **Lei 14.133/21** (já indexada), recomendamos adicionar:

1. **Lei 8.666/93** - Lei anterior de licitações (referência histórica)
2. **Decreto 11.462/2023** - Regulamenta a Lei 14.133/21
3. **IN SEGES/ME nº 65/2021** - Instrução Normativa de Contratações
4. **Lei Complementar 123/2006** - Estatuto da Microempresa e Empresa de Pequeno Porte

---

## 📥 Passo 1: Obter o Texto do Documento

### Opção A: Sites Oficiais

- **Planalto**: https://www.planalto.gov.br/ccivil_03/leis/
- **Diário Oficial**: https://www.in.gov.br/

### Opção B: Usar o Browser Automation

```bash
# Exemplo: Baixar Lei 8.666/93
# 1. Acesse a página do Planalto
# 2. Copie o texto completo
# 3. Salve em data/lei_8666_1993.txt
```

---

## 🔧 Passo 2: Preparar o Arquivo

1. Salve o texto em `/home/ubuntu/licigov-pro/data/`
2. Use formato `.txt` (UTF-8)
3. Mantenha a estrutura original (artigos, parágrafos, incisos)

**Exemplo de estrutura:**
```
data/
├── lei_14133_2021.txt  (já existe)
├── lei_8666_1993.txt   (novo)
├── decreto_11462_2023.txt (novo)
└── in_seges_65_2021.txt (novo)
```

---

## ⚙️ Passo 3: Indexar o Documento

Use o script genérico de indexação:

```bash
cd /home/ubuntu/licigov-pro

# Sintaxe:
# node server/scripts/indexDocument.mjs "<Nome do Documento>" <caminho_arquivo> [tamanho_chunk]

# Exemplo 1: Lei 8.666/93
node server/scripts/indexDocument.mjs "Lei 8.666/93" data/lei_8666_1993.txt

# Exemplo 2: Decreto com chunks maiores
node server/scripts/indexDocument.mjs "Decreto 11.462/2023" data/decreto_11462_2023.txt 600

# Exemplo 3: Instrução Normativa
node server/scripts/indexDocument.mjs "IN SEGES/ME nº 65/2021" data/in_seges_65_2021.txt
```

**Parâmetros:**
- `<Nome do Documento>`: Nome exato para identificação (use aspas)
- `<caminho_arquivo>`: Caminho relativo ao arquivo .txt
- `[tamanho_chunk]`: Opcional, padrão 512 caracteres

**Tempo estimado:** 2-5 minutos por documento (dependendo do tamanho)

---

## 🔍 Passo 4: Verificar Indexação

```bash
# Verificar quantos chunks foram indexados
mysql -u root -e "SELECT lawName, COUNT(*) as chunks FROM law_chunks GROUP BY lawName;"
```

**Resultado esperado:**
```
+-------------------------+--------+
| lawName                 | chunks |
+-------------------------+--------+
| Lei 14.133/21           |     91 |
| Lei 8.666/93            |    120 |
| Decreto 11.462/2023     |     45 |
| IN SEGES/ME nº 65/2021  |     30 |
+-------------------------+--------+
```

---

## 🎨 Passo 5: Usar no Código (Opcional)

O sistema RAG já busca automaticamente em **todos os documentos indexados**. Se quiser filtrar por documento específico:

```typescript
// server/services/gemini.ts

// Buscar apenas na Lei 14.133/21
const context = await retrieveRelevantLaw(
  "requisitos do ETP",
  5,
  ["Lei 14.133/21"]
);

// Buscar na Lei 14.133 E no Decreto
const context = await retrieveRelevantLaw(
  "modalidades de licitação",
  5,
  ["Lei 14.133/21", "Decreto 11.462/2023"]
);

// Buscar em TODOS os documentos (padrão)
const context = await retrieveRelevantLaw(
  "contratação de serviços",
  5
);
```

---

## 📊 Custos Estimados

**Indexação (uma vez):**
- Lei 8.666/93 (~120 chunks): US$ 0.0012
- Decreto 11.462/2023 (~45 chunks): US$ 0.00045
- IN SEGES (~30 chunks): US$ 0.0003

**Total para 3 novos documentos:** ~US$ 0.002 (menos de 1 centavo)

**Consultas RAG (recorrente):**
- Cada consulta busca em todos os documentos
- Custo permanece o mesmo (US$ 0.00001 por consulta)
- Cache de contexto reduz custos em 90%

---

## ✅ Checklist de Implementação

- [ ] Baixar texto da Lei 8.666/93
- [ ] Salvar em `data/lei_8666_1993.txt`
- [ ] Executar `node server/scripts/indexDocument.mjs "Lei 8.666/93" data/lei_8666_1993.txt`
- [ ] Verificar indexação no banco de dados
- [ ] Testar geração de documento (ETP) e verificar se cita a Lei 8.666 quando relevante

- [ ] Baixar texto do Decreto 11.462/2023
- [ ] Salvar em `data/decreto_11462_2023.txt`
- [ ] Indexar com script
- [ ] Verificar no banco

- [ ] Baixar IN SEGES/ME nº 65/2021
- [ ] Salvar em `data/in_seges_65_2021.txt`
- [ ] Indexar com script
- [ ] Verificar no banco

- [ ] Baixar Lei Complementar 123/2006
- [ ] Salvar em `data/lc_123_2006.txt`
- [ ] Indexar com script
- [ ] Verificar no banco

---

## 🚀 Benefícios

Com múltiplos documentos indexados:

✅ **Documentos mais completos** - Citam legislação complementar automaticamente
✅ **Maior precisão jurídica** - Referências cruzadas entre leis
✅ **Conformidade total** - Abrange toda a legislação de licitações
✅ **Diferencial competitivo** - Poucos sistemas têm RAG multi-documento

---

## 🆘 Troubleshooting

**Erro: "Cannot find module"**
- Verifique se está no diretório `/home/ubuntu/licigov-pro`
- Execute `pnpm install` para garantir dependências

**Erro: "Database not available"**
- Verifique se `DATABASE_URL` está configurada
- Teste conexão: `mysql -u root -e "SELECT 1;"`

**Chunks não aparecem no banco**
- Verifique se o arquivo .txt existe e tem conteúdo
- Confira logs do script para erros de parsing
- Tente reduzir o `chunkSize` para documentos complexos

**Documentos não são citados**
- Aguarde 1-2 minutos após indexação (cache)
- Verifique se a query é relevante ao documento
- Teste com `retrieveRelevantLaw` diretamente

---

## 📞 Suporte

Para dúvidas ou problemas, consulte:
- `PLANO_IMPLEMENTACAO_RAG.md` - Detalhes técnicos do RAG
- `server/services/rag.ts` - Código fonte do RAG
- `server/scripts/indexDocument.mjs` - Script de indexação
