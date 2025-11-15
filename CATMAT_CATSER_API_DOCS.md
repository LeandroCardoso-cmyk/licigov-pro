# 📚 Documentação da API CATMAT/CATSER

## 🔗 Informações Gerais

**Base URL:** `https://dadosabertos.compras.gov.br`

**Documentação Swagger:** https://dadosabertos.compras.gov.br/swagger-ui/index.html

**Autenticação:** Não requer autenticação (API pública)

---

## 📦 CATMAT - Catálogo de Materiais

### Endpoint Principal: Consultar Item de Material

**Método:** `GET`

**URL:** `/modulo-material/4_consultarItemMaterial`

**Descrição:** Consulta itens do catálogo de materiais (CATMAT) com filtros diversos

---

### Parâmetros de Consulta

| Parâmetro | Tipo | Obrigatório | Descrição | Exemplo |
|-----------|------|-------------|-----------|---------|
| `pagina` | integer | Não | Número da página (paginação) | `1` |
| `tamanhoPagina` | integer | Não | Quantidade de itens por página | `10` |
| `codigoItem` | integer | Não | Código específico do item CATMAT | `123456` |
| `codigoGrupo` | integer | Não | Código do grupo de materiais | `1000` |
| `codigoClasse` | integer | Não | Código da classe de materiais | `10001` |
| `codigoPdm` | integer | Não | Código do PDM (Padrão Descritivo de Material) | `100` |
| `descricaoItem` | string | Não | Descrição do item (busca textual) | `"notebook"` |
| `statusItem` | boolean | Não | Status do item (ativo/inativo) | `true` |
| `bps` | boolean | Não | Se é item de BPS (Bem Público Sustentável) | `false` |
| `codigo_ncm` | string | Não | Código NCM (Nomenclatura Comum do Mercosul) | `8471.30.12` |

---

### Exemplo de Requisição

```bash
GET https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial?descricaoItem=notebook&pagina=1&tamanhoPagina=10
```

---

### Exemplo de Resposta (200 OK)

```json
{
  "data": [
    {
      "codigoItem": 123456,
      "descricaoItem": "NOTEBOOK, PROCESSADOR INTEL CORE I5, 8GB RAM, 256GB SSD",
      "codigoGrupo": 1000,
      "descricaoGrupo": "EQUIPAMENTOS DE INFORMÁTICA",
      "codigoClasse": 10001,
      "descricaoClasse": "COMPUTADORES E PERIFÉRICOS",
      "codigoPdm": 100,
      "descricaoPdm": "NOTEBOOK PADRÃO",
      "unidadeFornecimento": "UNIDADE",
      "statusItem": true,
      "bps": false,
      "codigoNcm": "8471.30.12"
    },
    {
      "codigoItem": 123457,
      "descricaoItem": "NOTEBOOK, PROCESSADOR INTEL CORE I7, 16GB RAM, 512GB SSD",
      "codigoGrupo": 1000,
      "descricaoGrupo": "EQUIPAMENTOS DE INFORMÁTICA",
      "codigoClasse": 10001,
      "descricaoClasse": "COMPUTADORES E PERIFÉRICOS",
      "codigoPdm": 101,
      "descricaoPdm": "NOTEBOOK AVANÇADO",
      "unidadeFornecimento": "UNIDADE",
      "statusItem": true,
      "bps": false,
      "codigoNcm": "8471.30.12"
    }
  ],
  "pagina": 1,
  "tamanhoPagina": 10,
  "totalItens": 25,
  "totalPaginas": 3
}
```

---

## 🛠️ CATSER - Catálogo de Serviços

### Endpoint Principal: Consultar Item de Serviço

**Método:** `GET`

**URL:** `/modulo-servico/6_consultarItemServico`

**Descrição:** Consulta itens do catálogo de serviços (CATSER) com filtros diversos

---

### Parâmetros de Consulta (Similar ao CATMAT)

| Parâmetro | Tipo | Obrigatório | Descrição | Exemplo |
|-----------|------|-------------|-----------|---------|
| `pagina` | integer | Não | Número da página (paginação) | `1` |
| `tamanhoPagina` | integer | Não | Quantidade de itens por página | `10` |
| `codigoItem` | integer | Não | Código específico do item CATSER | `654321` |
| `codigoSecao` | integer | Não | Código da seção de serviços | `5000` |
| `codigoDivisao` | integer | Não | Código da divisão de serviços | `50001` |
| `codigoGrupo` | integer | Não | Código do grupo de serviços | `500010` |
| `codigoClasse` | integer | Não | Código da classe de serviços | `5000101` |
| `codigoSubClasse` | integer | Não | Código da subclasse de serviços | `50001011` |
| `descricaoItem` | string | Não | Descrição do serviço (busca textual) | `"manutenção"` |
| `statusItem` | boolean | Não | Status do item (ativo/inativo) | `true` |

---

### Exemplo de Requisição

```bash
GET https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico?descricaoItem=manutenção&pagina=1&tamanhoPagina=10
```

---

### Exemplo de Resposta (200 OK)

```json
{
  "data": [
    {
      "codigoItem": 654321,
      "descricaoItem": "MANUTENÇÃO PREVENTIVA E CORRETIVA DE EQUIPAMENTOS DE INFORMÁTICA",
      "codigoSecao": 5000,
      "descricaoSecao": "SERVIÇOS TÉCNICOS ESPECIALIZADOS",
      "codigoDivisao": 50001,
      "descricaoDivisao": "SERVIÇOS DE INFORMÁTICA",
      "codigoGrupo": 500010,
      "descricaoGrupo": "MANUTENÇÃO DE EQUIPAMENTOS",
      "codigoClasse": 5000101,
      "descricaoClasse": "MANUTENÇÃO DE COMPUTADORES",
      "codigoSubClasse": 50001011,
      "descricaoSubClasse": "MANUTENÇÃO PREVENTIVA",
      "unidadeMedida": "HORA",
      "statusItem": true
    },
    {
      "codigoItem": 654322,
      "descricaoItem": "MANUTENÇÃO CORRETIVA DE IMPRESSORAS E MULTIFUNCIONAIS",
      "codigoSecao": 5000,
      "descricaoSecao": "SERVIÇOS TÉCNICOS ESPECIALIZADOS",
      "codigoDivisao": 50001,
      "descricaoDivisao": "SERVIÇOS DE INFORMÁTICA",
      "codigoGrupo": 500010,
      "descricaoGrupo": "MANUTENÇÃO DE EQUIPAMENTOS",
      "codigoClasse": 5000102,
      "descricaoClasse": "MANUTENÇÃO DE PERIFÉRICOS",
      "codigoSubClasse": 50001021,
      "descricaoSubClasse": "MANUTENÇÃO CORRETIVA",
      "unidadeMedida": "HORA",
      "statusItem": true
    }
  ],
  "pagina": 1,
  "tamanhoPagina": 10,
  "totalItens": 18,
  "totalPaginas": 2
}
```

---

## 🔍 Endpoints Auxiliares

### 1. Consultar Grupo de Material
**URL:** `/modulo-material/1_consultarGrupoMaterial`

### 2. Consultar Classe de Material
**URL:** `/modulo-material/2_consultarClasseMaterial`

### 3. Consultar PDM (Padrão Descritivo de Material)
**URL:** `/modulo-material/3_consultarPdmMaterial`

### 4. Consultar Unidade de Fornecimento
**URL:** `/modulo-material/6_consultarMaterialUnidadeFornecimento`

### 5. Consultar Seção de Serviço
**URL:** `/modulo-servico/1_consultarSecaoServico`

### 6. Consultar Divisão de Serviço
**URL:** `/modulo-servico/2_consultarDivisaoServico`

### 7. Consultar Grupo de Serviço
**URL:** `/modulo-servico/3_consultarGrupoServico`

### 8. Consultar Classe de Serviço
**URL:** `/modulo-servico/4_consultarClasseServico`

### 9. Consultar Subclasse de Serviço
**URL:** `/modulo-servico/5_consultarSubClasseServico`

### 10. Consultar Unidade de Medida de Serviço
**URL:** `/modulo-servico/7_consultarUndMedidaServico`

---

## 💡 Casos de Uso para o LiciGov Pro

### 1. **Busca de Itens ao Criar Processo**

**Fluxo:**
1. Usuário digita termo de busca (ex: "notebook")
2. Frontend chama API com `descricaoItem=notebook&tamanhoPagina=10`
3. Backend retorna lista de itens CATMAT
4. Frontend exibe autocomplete com código e descrição
5. Usuário seleciona item
6. Sistema salva código, descrição e unidade no banco

---

### 2. **Geração de TR com Itens Padronizados**

**Fluxo:**
1. Usuário seleciona múltiplos itens do CATMAT/CATSER
2. Sistema armazena itens selecionados na tabela `process_items`
3. Ao gerar TR, IA recebe lista de itens com:
   - Código CATMAT/CATSER
   - Descrição detalhada
   - Unidade de medida
   - Quantidade
   - Preço estimado
4. IA inclui tabela estruturada no TR

---

### 3. **Validação de Conformidade**

**Benefícios:**
- Garante uso de descrições padronizadas
- Facilita comparação de preços
- Aumenta conformidade com Lei 14.133/2021
- Reduz erros de digitação

---

## 🚀 Implementação no LiciGov Pro

### Backend (tRPC)

```typescript
// server/routers/catmatRouter.ts
export const catmatRouter = router({
  searchMaterials: publicProcedure
    .input(z.object({
      searchTerm: z.string(),
      page: z.number().default(1),
      pageSize: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const response = await fetch(
        `https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial?descricaoItem=${encodeURIComponent(input.searchTerm)}&pagina=${input.page}&tamanhoPagina=${input.pageSize}`
      );
      return await response.json();
    }),

  searchServices: publicProcedure
    .input(z.object({
      searchTerm: z.string(),
      page: z.number().default(1),
      pageSize: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const response = await fetch(
        `https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico?descricaoItem=${encodeURIComponent(input.searchTerm)}&pagina=${input.page}&tamanhoPagina=${input.pageSize}`
      );
      return await response.json();
    }),
});
```

### Frontend (React + Autocomplete)

```tsx
// client/src/components/CatmatSearch.tsx
const CatmatSearch = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const { data, isLoading } = trpc.catmat.searchMaterials.useQuery(
    { searchTerm, page: 1, pageSize: 10 },
    { enabled: searchTerm.length >= 3 } // Só busca com 3+ caracteres
  );

  return (
    <Autocomplete
      options={data?.data || []}
      getOptionLabel={(option) => `${option.codigoItem} - ${option.descricaoItem}`}
      onInputChange={(_, value) => setSearchTerm(value)}
      renderInput={(params) => (
        <TextField {...params} label="Buscar item CATMAT" />
      )}
    />
  );
};
```

---

## 📊 Estrutura de Dados Recomendada

### Tabela: `process_items`

```sql
CREATE TABLE process_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  processId INT NOT NULL,
  itemType ENUM('material', 'service') NOT NULL,
  catmatCode INT,
  catserCode INT,
  description TEXT NOT NULL,
  unit VARCHAR(50) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  estimatedPrice DECIMAL(10,2),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (processId) REFERENCES processes(id) ON DELETE CASCADE
);
```

---

## ✅ Checklist de Implementação

- [ ] Criar serviço de integração no backend
- [ ] Criar tRPC router para CATMAT/CATSER
- [ ] Implementar cache de resultados (Redis ou memória)
- [ ] Criar componente de busca com autocomplete
- [ ] Adicionar debounce na busca (500ms)
- [ ] Criar tabela `process_items` no schema
- [ ] Atualizar formulário de novo processo
- [ ] Atualizar prompt da IA para incluir itens no TR
- [ ] Testar integração completa
- [ ] Validar conformidade com Lei 14.133/2021

---

## 🔗 Referências

- **Portal ComprasNet:** https://www.gov.br/compras/pt-br
- **API Swagger:** https://dadosabertos.compras.gov.br/swagger-ui/index.html
- **Manual CATMAT/CATSER:** https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-catmat-catser
- **Lei 14.133/2021:** http://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm
