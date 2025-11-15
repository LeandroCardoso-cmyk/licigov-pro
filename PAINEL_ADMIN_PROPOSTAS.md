# 🔐 Painel Admin de Propostas - LiciGov Pro

## 📋 Visão Geral

O painel de administração de propostas é **exclusivo para o dono da solução** (você) e permite gerenciar todo o fluxo de solicitações de propostas comerciais, desde a solicitação até a ativação da assinatura.

---

## 🎯 Acesso

**Rota:** `/admin/propostas`

**Quem pode acessar:**
- ✅ **Apenas o owner** (você) - identificado por `user.role === 'admin'` e `user.openId === OWNER_OPEN_ID`
- ❌ Usuários comuns **NÃO** têm acesso

**Navegação:**
- Não aparece no dashboard de seleção de módulos
- Acessível via menu lateral do painel admin (`/admin`)

---

## 🚀 Funcionalidades Implementadas

### 1. **Listagem de Solicitações de Propostas**

**Visualização:**
- Tabela com todas as solicitações recebidas
- Informações exibidas:
  - Nome do órgão
  - CNPJ
  - Responsável (nome, email, telefone)
  - Plano solicitado
  - Data da solicitação
  - Status (Pendente, Aprovado, Rejeitado)

**Filtros:**
- 🔍 **Busca por texto:** Nome do órgão ou responsável
- 📊 **Filtro por status:** Todos, Pendente, Aprovado, Rejeitado

---

### 2. **Registro de Empenho**

**Ação:** Botão "Registrar Empenho" em cada solicitação

**Campos do formulário:**
- **Número do Empenho:** Campo de texto
- **Data do Empenho:** Seletor de data
- **Valor do Empenho:** Campo numérico (R$)
- **Observações:** Textarea opcional

**Fluxo:**
1. Admin clica em "Registrar Empenho"
2. Preenche dados do empenho
3. Sistema salva no banco de dados
4. Status da proposta muda para "Aprovado"

---

### 3. **Ativação de Assinatura**

**Ação:** Botão "Ativar Assinatura" (aparece após registrar empenho)

**Fluxo:**
1. Admin clica em "Ativar Assinatura"
2. Sistema cria assinatura ativa para o órgão
3. Órgão ganha acesso completo ao sistema
4. Assinatura fica visível em `/admin/assinaturas`

---

### 4. **Download de Documentos**

**Botões disponíveis em cada solicitação:**
- 📄 **Download da Proposta** (PDF)
- 📄 **Download do Contrato** (DOCX)
- 📄 **Download do TR** (DOCX)
- 📦 **Download do ZIP Completo** (Proposta + Contrato + TR + Documentos da Empresa)

**Conteúdo do ZIP:**
```
proposta_comercial_[orgao].zip
├── proposta_comercial.pdf
├── minuta_contrato.docx
├── termo_referencia.docx
└── documentos_empresa/
    ├── contrato_social.pdf
    ├── cartao_cnpj.pdf
    ├── certidao_federal.pdf
    ├── certidao_estadual.pdf
    ├── certidao_municipal.pdf
    ├── certidao_fgts.pdf
    ├── certidao_trabalhista.pdf
    └── alvara_funcionamento.pdf
```

---

## 📁 Gestão de Documentos da Empresa

**Rota:** `/admin/documentos`

**Funcionalidades:**

### 1. **Upload de Documentos**

**Tipos de documentos suportados:**
- Contrato Social
- Cartão CNPJ
- Certidão Federal (Receita Federal e Dívida Ativa da União)
- Certidão Estadual (Fazenda Estadual)
- Certidão Municipal (Fazenda Municipal)
- Certidão FGTS
- Certidão Trabalhista (TST)
- Alvará de Funcionamento

**Campos do formulário:**
- **Tipo de Documento:** Select com opções
- **Data de Validade:** Seletor de data (opcional)
- **Arquivo:** Upload (PDF, máx 10MB)

---

### 2. **Controle de Validade**

**Status visuais:**
- ✅ **Válido** (verde) - Mais de 30 dias até vencer
- ⚠️ **Vence em X dias** (amarelo) - Menos de 30 dias até vencer
- ❌ **Vencido** (vermelho) - Data de validade passou

**Alertas:**
- Sistema avisa se tentar gerar proposta com documentos vencidos
- Badge visual na listagem de documentos

---

### 3. **Atualização de Documentos**

**Fluxo:**
1. Admin clica em "Atualizar" em um documento existente
2. Faz upload do novo arquivo
3. Sistema substitui o documento anterior
4. Mantém histórico de versões (implementação futura)

---

## 🔄 Fluxo Completo de Proposta

### **Passo 1: Órgão Solicita Proposta**
- Órgão acessa landing page (`/`)
- Clica em "Solicitar Proposta"
- Preenche formulário com dados do órgão
- Seleciona plano desejado
- Envia solicitação

### **Passo 2: Admin Recebe Solicitação**
- Solicitação aparece em `/admin/propostas`
- Status: **Pendente**

### **Passo 3: Admin Registra Empenho**
- Admin clica em "Registrar Empenho"
- Preenche número, data e valor do empenho
- Sistema muda status para **Aprovado**

### **Passo 4: Admin Ativa Assinatura**
- Admin clica em "Ativar Assinatura"
- Sistema cria assinatura ativa
- Órgão ganha acesso ao sistema

### **Passo 5: Órgão Acessa Sistema**
- Órgão faz login via OAuth
- Acessa dashboard de módulos
- Começa a usar o sistema

---

## 📊 Dados Armazenados

### **Tabela: proposal_requests**
```sql
- id (int)
- orgaoNome (varchar)
- orgaoCnpj (varchar)
- orgaoEndereco (text)
- responsavelNome (varchar)
- responsavelEmail (varchar)
- responsavelTelefone (varchar)
- planoSelecionado (varchar)
- status (enum: pending, approved, rejected)
- numeroEmpenho (varchar, nullable)
- dataEmpenho (date, nullable)
- valorEmpenho (decimal, nullable)
- observacoes (text, nullable)
- createdAt (timestamp)
- updatedAt (timestamp)
```

### **Tabela: company_documents**
```sql
- id (int)
- documentType (varchar)
- fileName (varchar)
- fileUrl (varchar)
- expiresAt (date, nullable)
- uploadedAt (timestamp)
- updatedAt (timestamp)
```

---

## 🎨 Interface do Painel Admin

### **Tela de Propostas** (`/admin/propostas`)

**Header:**
- Título: "Gerenciar Propostas"
- Descrição: "Visualize solicitações, registre empenhos e ative assinaturas"

**Filtros:**
- Campo de busca (órgão ou responsável)
- Dropdown de status (Todos, Pendente, Aprovado, Rejeitado)

**Tabela:**
- Colunas: Órgão, CNPJ, Responsável, Plano, Data, Status, Ações
- Ações por linha:
  - Ver Detalhes
  - Registrar Empenho
  - Ativar Assinatura
  - Download Proposta
  - Download Contrato
  - Download TR
  - Download ZIP Completo

---

### **Tela de Documentos** (`/admin/documentos`)

**Header:**
- Título: "Documentos da Empresa"
- Descrição: "Gerencie certidões e documentos incluídos nas propostas"
- Botão: "Novo Documento"

**Tabela:**
- Colunas: Tipo, Nome do Arquivo, Data de Validade, Status, Ações
- Badges de status: Válido, Vence em X dias, Vencido
- Ações por linha:
  - Download
  - Atualizar
  - Excluir

---

## ✅ Status Atual

**Implementado:**
- ✅ Listagem de solicitações
- ✅ Filtros e busca
- ✅ Registro de empenho
- ✅ Ativação de assinatura
- ✅ Geração de proposta em PDF
- ✅ Geração de contrato em DOCX
- ✅ Geração de TR em DOCX
- ✅ Geração de ZIP com documentos
- ✅ Upload de documentos da empresa
- ✅ Controle de validade de documentos
- ✅ Badges visuais de status

**Pendente:**
- [ ] Upload de nota de empenho (PDF)
- [ ] Upload de contrato assinado (PDF)
- [ ] Histórico de versões de documentos
- [ ] Notificações de vencimento de certidões
- [ ] Dashboard de inadimplência
- [ ] Relatórios financeiros

---

## 🔒 Segurança

**Controle de Acesso:**
- Apenas owner pode acessar
- Verificação de `role === 'admin'` no backend
- Verificação de `openId === OWNER_OPEN_ID` no backend
- Rotas protegidas com middleware de autenticação

**Validações:**
- CNPJ válido no formulário de solicitação
- Formato de arquivo (apenas PDF para documentos)
- Tamanho máximo de arquivo (10MB)
- Campos obrigatórios validados

---

## 📝 Próximos Passos Sugeridos

1. **Adicionar upload de nota de empenho** no painel de propostas
2. **Adicionar upload de contrato assinado** no painel de propostas
3. **Implementar notificações automáticas** de vencimento de certidões (30 dias antes)
4. **Criar dashboard de inadimplência** com contratos a vencer
5. **Implementar relatórios financeiros** (receita mensal, contratos ativos, etc.)
