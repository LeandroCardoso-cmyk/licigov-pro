# 🚀 Módulos Futuros - LiciGov Pro

## 📋 Roadmap de Desenvolvimento

Este documento apresenta as ideias robustas e detalhadas para os próximos módulos do LiciGov Pro, com foco em criar uma plataforma completa de gestão de licitações e contratos públicos.

---

## 🎯 Módulo 2: Contratação Direta

**Status:** 🔜 Em Breve  
**Prioridade:** ALTA  
**Tempo estimado:** 3-4 semanas

### Visão Geral

Módulo dedicado à gestão de contratações diretas (Dispensa e Inexigibilidade) conforme Lei 14.133/2021, com geração automática de documentos justificativos e controle de limites legais.

---

### Funcionalidades Principais

#### 1. **Tipos de Contratação Direta**

**Dispensa de Licitação:**
- Dispensa por valor (Art. 75, I e II)
- Dispensa em razão do objeto (Art. 75, III a XVI)
- Dispensa para contratação de remanescente
- Controle automático de limites de valor

**Inexigibilidade:**
- Fornecedor exclusivo
- Serviços técnicos especializados
- Profissionais do setor artístico
- Produtos para pesquisa e desenvolvimento

---

#### 2. **Geração Automática de Documentos**

**Documentos gerados com IA:**
- **Justificativa de Contratação Direta** (fundamentação legal)
- **Termo de Referência Simplificado**
- **Pesquisa de Preços** (modelo estruturado)
- **Parecer Jurídico** (opcional)
- **Ratificação** (para dispensas)

**Personalização:**
- Templates editáveis
- Inserção automática de fundamentação legal
- Referências à Lei 14.133/2021

---

#### 3. **Controle de Limites e Alertas**

**Limites de Dispensa (Art. 75, I e II):**
- Obras e serviços de engenharia: até R$ 100.000,00
- Compras e outros serviços: até R$ 50.000,00
- Sistema alerta quando valor ultrapassa limite

**Dashboard de Contratações Diretas:**
- Total de dispensas no ano
- Total de inexigibilidades no ano
- Valor total contratado por dispensa
- Alertas de limite anual (20% do total licitado)

---

#### 4. **Fluxo de Trabalho**

**Passo 1: Criar Contratação Direta**
- Selecionar tipo (Dispensa ou Inexigibilidade)
- Informar objeto da contratação
- Informar valor estimado
- Selecionar fundamentação legal

**Passo 2: Geração de Documentos**
- Sistema gera justificativa automaticamente
- Sistema gera TR simplificado
- Sistema sugere modelo de pesquisa de preços

**Passo 3: Pesquisa de Preços**
- Upload de cotações (mínimo 3)
- Comparativo automático de preços
- Justificativa de escolha do fornecedor

**Passo 4: Aprovação e Ratificação**
- Aprovação interna
- Ratificação pela autoridade competente
- Publicação no portal de transparência

---

#### 5. **Integração com Processos Licitatórios**

- Converter contratação direta em processo licitatório (se necessário)
- Histórico de contratações diretas por fornecedor
- Relatórios de conformidade

---

### Interface Proposta

**Dashboard:**
- Cards de métricas (Total de dispensas, Total de inexigibilidades, Valor total)
- Lista de contratações diretas recentes
- Filtros por tipo, status, data

**Formulário de Nova Contratação:**
- Campos: Tipo, Objeto, Valor, Fundamentação Legal, Fornecedor
- Botão "Gerar Documentos"

**Tela de Detalhes:**
- Timeline de aprovação
- Documentos gerados
- Pesquisa de preços
- Histórico de alterações

---

## 🎯 Módulo 3: Gestão de Contratos

**Status:** 🔜 Em Breve  
**Prioridade:** ALTA  
**Tempo estimado:** 4-5 semanas

### Visão Geral

Módulo completo para acompanhamento de contratos administrativos, desde a assinatura até o encerramento, com controle de prazos, aditivos, fiscalização e alertas de renovação.

---

### Funcionalidades Principais

#### 1. **Cadastro de Contratos**

**Informações básicas:**
- Número do contrato
- Objeto
- Contratado (nome, CNPJ)
- Valor inicial
- Data de assinatura
- Data de início da vigência
- Data de término da vigência
- Modalidade de licitação (ou contratação direta)
- Número do processo licitatório (link)

**Documentos anexados:**
- Contrato assinado (PDF)
- Nota de empenho
- Garantia contratual
- Outros anexos

---

#### 2. **Acompanhamento de Vigência**

**Controle de Prazos:**
- Cálculo automático de dias restantes
- Badges visuais:
  - ✅ **Vigente** (mais de 90 dias)
  - ⚠️ **Vence em X dias** (menos de 90 dias)
  - ❌ **Vencido** (prazo expirado)

**Alertas Automáticos:**
- 90 dias antes do vencimento
- 60 dias antes do vencimento
- 30 dias antes do vencimento
- No dia do vencimento
- Notificações por email e in-app

---

#### 3. **Gestão de Aditivos**

**Tipos de Aditivos:**
- Aditivo de prazo (prorrogação)
- Aditivo de valor (acréscimo ou supressão)
- Aditivo de objeto (alteração qualitativa)

**Controle de Limites:**
- Limite de acréscimo: 25% (obras) ou 50% (outros)
- Limite de supressão: 25%
- Sistema alerta quando limite é atingido

**Geração de Documentos:**
- Minuta de termo aditivo (gerada com IA)
- Justificativa técnica
- Parecer jurídico (opcional)

---

#### 4. **Fiscalização Contratual**

**Registro de Fiscalização:**
- Nome do fiscal
- Data da fiscalização
- Relatório de fiscalização
- Anexos (fotos, documentos)
- Status (Conforme, Não conforme, Pendente)

**Histórico de Fiscalização:**
- Timeline de fiscalizações
- Alertas de não conformidades
- Ações corretivas

---

#### 5. **Medições e Pagamentos**

**Controle de Medições:**
- Número da medição
- Período de referência
- Valor medido
- Data de aprovação
- Status (Pendente, Aprovada, Paga)

**Controle de Pagamentos:**
- Número da nota fiscal
- Data de emissão
- Valor
- Data de pagamento
- Comprovante de pagamento

**Dashboard Financeiro:**
- Valor total contratado
- Valor total pago
- Saldo a pagar
- Gráfico de evolução de pagamentos

---

#### 6. **Renovação de Contratos**

**Fluxo de Renovação:**
1. Sistema alerta 90 dias antes do vencimento
2. Admin clica em "Renovar Contrato"
3. Sistema gera nova proposta comercial
4. Órgão recebe proposta e decide renovar
5. Admin registra novo contrato (ou aditivo de prazo)

**Histórico de Renovações:**
- Contratos renovados
- Contratos não renovados
- Motivo de não renovação

---

### Interface Proposta

**Dashboard de Contratos:**
- Cards de métricas (Contratos ativos, Valor total, Contratos a vencer)
- Lista de contratos com badges de status
- Filtros por status, contratado, vigência

**Tela de Detalhes do Contrato:**
- Informações básicas
- Timeline de vigência
- Aba "Aditivos"
- Aba "Fiscalização"
- Aba "Medições e Pagamentos"
- Aba "Documentos"

**Calendário de Contratos:**
- Visualização mensal de vencimentos
- Alertas visuais de contratos próximos do vencimento

---

## 🎯 Módulo 4: Parecer Jurídico

**Status:** 🔜 Em Breve  
**Prioridade:** MÉDIA  
**Tempo estimado:** 2-3 semanas

### Visão Geral

Módulo para solicitação, acompanhamento e geração de pareceres jurídicos sobre processos licitatórios, com base em jurisprudências e legislação vigente.

---

### Funcionalidades Principais

#### 1. **Solicitação de Parecer**

**Fluxo:**
1. Usuário acessa processo licitatório
2. Clica em "Solicitar Parecer Jurídico"
3. Preenche formulário com dúvida/questão
4. Sistema notifica jurídico (ou gera parecer com IA)

**Campos do formulário:**
- Tipo de parecer (Favorável, Desfavorável, Com ressalvas)
- Questão jurídica
- Documentos anexados
- Prazo desejado

---

#### 2. **Geração de Parecer com IA**

**Base de Conhecimento:**
- Lei 14.133/2021
- Jurisprudências do TCU
- Súmulas do TCU
- Acórdãos relevantes
- Pareceres da AGU

**Estrutura do Parecer:**
- Relatório (resumo do caso)
- Fundamentação legal
- Análise jurídica
- Jurisprudências aplicáveis
- Conclusão (Favorável, Desfavorável, Com ressalvas)

---

#### 3. **Histórico de Pareceres**

**Listagem:**
- Todos os pareceres emitidos
- Filtros por tipo, data, processo
- Busca por palavra-chave

**Reutilização:**
- Salvar pareceres como templates
- Buscar pareceres similares
- Copiar fundamentação legal

---

### Interface Proposta

**Dashboard de Pareceres:**
- Cards de métricas (Total de pareceres, Favoráveis, Desfavoráveis)
- Lista de pareceres recentes

**Tela de Detalhes do Parecer:**
- Informações do processo
- Questão jurídica
- Parecer completo
- Jurisprudências citadas
- Botão "Exportar PDF"

---

## 🎯 Módulo 5: Gestão do Departamento de Licitações

**Status:** 🔜 Em Breve  
**Prioridade:** MÉDIA  
**Tempo estimado:** 3-4 semanas

### Visão Geral

Módulo de gestão de tarefas e projetos para departamentos de licitações, com visualização Kanban, calendário e controle de prazos.

---

### Funcionalidades Principais

#### 1. **Visualizações Múltiplas**

**Kanban (Padrão):**
- Colunas: Pendente, Em Andamento, Pausada, Atrasada, Aguardando Informação, Concluída
- Drag and drop para mover tarefas
- Badges de prioridade e prazo

**Lista:**
- Tabela com todas as tarefas
- Filtros por status, responsável, prioridade
- Ordenação por prazo, prioridade, data de criação

**Calendário:**
- Visualização mensal de tarefas
- Marcadores de prazos de licitações
- Alertas de tarefas atrasadas

---

#### 2. **Gestão de Tarefas**

**Campos da Tarefa:**
- Nome da tarefa
- Descrição
- Responsável (usuário do sistema)
- Status (Pendente, Em Andamento, Pausada, Atrasada, Aguardando Informação, Concluída)
- Prazo final
- Data da licitação (se aplicável)
- Prioridade (Baixa, Média, Alta, Urgente)
- Tags personalizadas
- Anexos (limite 10MB)

**Cores de Prioridade:**
- 🟢 **Baixa** (verde)
- 🟡 **Média** (amarelo)
- 🟠 **Alta** (laranja)
- 🔴 **Urgente** (vermelho)

---

#### 3. **Colaboração em Equipe**

**Comentários:**
- Comentários em tarefas
- Menções (@usuario)
- Histórico de comentários

**Notificações:**
- Tarefa atribuída
- Comentário em tarefa
- Prazo próximo
- Tarefa atrasada

---

#### 4. **Relatórios**

**Relatório Resumido:**
- Nome da tarefa
- Status
- Prazo
- Responsável

**Relatório Completo:**
- Todas as informações da tarefa
- Histórico de alterações
- Comentários
- Anexos

**Exportação:**
- PDF
- Excel
- CSV

---

### Interface Proposta

**Dashboard Kanban:**
- Colunas arrastáveis
- Cards de tarefas com badges
- Botão "Nova Tarefa"

**Tela de Detalhes da Tarefa:**
- Informações completas
- Seção de comentários
- Seção de anexos
- Histórico de alterações

**Calendário:**
- Visualização mensal
- Marcadores coloridos por prioridade
- Clique para ver detalhes da tarefa

---

## 🎯 Módulo 6: Analytics e Relatórios

**Status:** 🔜 Em Breve  
**Prioridade:** BAIXA  
**Tempo estimado:** 2-3 semanas

### Visão Geral

Módulo de business intelligence com dashboards interativos, relatórios customizáveis e exportação de dados para análise.

---

### Funcionalidades Principais

#### 1. **Dashboards Interativos**

**Dashboard de Processos:**
- Total de processos por modalidade
- Valor total licitado
- Tempo médio de conclusão
- Taxa de sucesso (concluídos vs. cancelados)

**Dashboard de Contratos:**
- Contratos ativos vs. vencidos
- Valor total contratado
- Distribuição por fornecedor
- Contratos a vencer (próximos 90 dias)

**Dashboard Financeiro:**
- Receita mensal (para admin)
- Assinaturas ativas
- Taxa de renovação
- Inadimplência

---

#### 2. **Relatórios Customizáveis**

**Tipos de Relatórios:**
- Processos licitatórios
- Contratações diretas
- Contratos
- Tarefas
- Atividades (auditoria)

**Filtros:**
- Período (data de início e fim)
- Status
- Modalidade
- Responsável
- Valor (mínimo e máximo)

**Exportação:**
- PDF
- Excel
- CSV

---

#### 3. **Análise de Desempenho**

**Métricas de Produtividade:**
- Processos concluídos por mês
- Tempo médio de geração de documentos
- Taxa de retrabalho (edições de documentos)

**Métricas de Qualidade:**
- Documentos aprovados vs. rejeitados
- Pareceres favoráveis vs. desfavoráveis
- Contratos renovados vs. não renovados

---

## 📊 Priorização de Desenvolvimento

### Fase 1 (Próximos 3 meses)
1. **Contratação Direta** (ALTA prioridade)
2. **Gestão de Contratos** (ALTA prioridade)

### Fase 2 (3-6 meses)
3. **Parecer Jurídico** (MÉDIA prioridade)
4. **Gestão do Departamento** (MÉDIA prioridade)

### Fase 3 (6-12 meses)
5. **Analytics e Relatórios** (BAIXA prioridade)
6. **Integrações externas** (PNCP, CATMAT/CATSER)

---

## 🎯 Diferenciais Competitivos

### Por que o LiciGov Pro será único?

1. **Geração de Documentos com IA**
   - Único sistema que gera documentos licitatórios completos e conformes com a Lei 14.133/2021
   - Economia de 70% do tempo gasto em documentação

2. **Conformidade Legal Garantida**
   - Base de conhecimento atualizada com legislação e jurisprudências
   - Alertas de limites e prazos legais

3. **Gestão Completa do Ciclo**
   - Do processo licitatório ao encerramento do contrato
   - Visão 360° de todo o departamento de licitações

4. **Interface Intuitiva**
   - Design moderno e responsivo
   - Curva de aprendizado mínima

5. **Suporte Especializado**
   - Equipe com conhecimento em licitações públicas
   - Treinamento e onboarding personalizados

---

## 💡 Próximos Passos

1. **Validar priorização** com você
2. **Definir MVP de cada módulo** (funcionalidades essenciais)
3. **Criar protótipos de interface** (Figma ou wireframes)
4. **Iniciar desenvolvimento** do Módulo 2 (Contratação Direta)

**Qual módulo você gostaria de priorizar primeiro?**
