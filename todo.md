# LiciGov Pro - TODO

## MVP - Módulo 1: Geração de Documentos Licitatórios

### Infraestrutura e Configuração
- [x] Inicializar projeto com estrutura frontend e backend
- [x] Configurar autenticação com Manus OAuth
- [x] Configurar banco de dados PostgreSQL
- [x] Definir paleta de cores baseada no logo
- [x] Configurar tema dark/light

### Design e Interface
- [x] Tela de Login (modo Light e Dark)
- [x] Dashboard Principal com lista de processos
- [x] Botão "Novo Processo"
- [x] Visualização de status dos processos (Em ETP, Em TR, Em DFD, Em Edital, Concluído)
- [ ] Interface para colaboração interna (compartilhar processo, definir papéis)
- [ ] Log de atividades por processo

### Funcionalidades Core - Geração de Documentos
- [ ] Fluxo de criação de novo processo licitatório
- [ ] Formulário para inserir "objeto da contratação"
- [ ] Geração de ETP (Estudo Técnico Preliminar) com IA
- [ ] Geração de TR (Termo de Referência) com IA
- [ ] Geração de DFD (Documento de Formalização da Demanda) com IA
- [ ] Geração de Edital com IA
- [ ] Editor de documentos gerados
- [ ] Download de documentos em PDF

### Parâmetros do Edital
- [ ] Campo: Modalidade
- [ ] Campo: Formato (Presencial ou Eletrônico)
- [ ] Campo: Critério de Julgamento
- [ ] Campo: Regime de Contratação

### Integração com IA
- [ ] Integração com OpenAI API
- [ ] Implementação de RAG (Retrieval Augmented Generation)
- [ ] Base de conhecimento: Lei 14.133/21
- [ ] Prompt engineering para geração de documentos

### Colaboração e Controle de Acesso
- [ ] Sistema de convites para colaboradores
- [ ] Papéis: Administrador, Editor, Leitor
- [ ] Permissões por papel

### Sistema de Notificações
- [ ] Notificações in-app (ícone de sino)
- [ ] Notificações por e-mail (preparar textos depois)

### Integração CATMAT/CATSER
- [ ] Barra de busca com sugestões automáticas
- [ ] Integração com catálogos oficiais

## Módulos Futuros (Pós-MVP)

### Módulo 2: Gestão de Contratos
- [ ] Geração de contratos baseados no Edital
- [ ] Acompanhamento de contratos

### Módulo 3: Parecer Jurídico
- [ ] Geração de parecer jurídico com opção Favorável/Desfavorável
- [ ] Base de jurisprudências

### Módulo 4: Contratação Direta
- [ ] Dispensa de Licitação
- [ ] Inexigibilidade

### Módulo 5: Gestão do Departamento de Licitações
- [x] Visualização em Quadro Kanban (padrão) - 7 colunas com drag & drop
- [x] Visualização em Lista - tabela com busca em tempo real
- [x] Visualização em Calendário - estrutura completa
- [x] Dashboard Analítico - 4 KPIs + 4 gráficos
- [x] Modal de detalhes integrado (Kanban + Lista)
- [x] Sistema de comentários (backend completo)
- [x] Sistema de anexos (backend completo)
- [x] Vinculação com processos licitatórios
- [x] Visualização em Calendário - tarefas nos dias - completo (grid mensal, navegação, legenda, resumo, clique em tarefas)
- [x] Campos: Nome da Tarefa, Responsável, Status, Prazo Final, Tipo, Prioridade, Descrição
- [x] Status: Pendente, Em Andamento, Pausada, Atrasada, Aguardando Informação, Concluída, Cancelada (7 status)
- [x] Prioridades: Baixa, Média, Alta, Urgente (com cores diferenciadas)
- [x] Anexar arquivos às tarefas (limite de 10MB) - backend implementado
- [ ] Tags personalizadas
- [x] Relatório Resumido (Nome, Status, Prazo) - PDF/Markdown implementado
- [x] Relatório Completo - Excel implementado com formatação
- [ ] Calendário com datas de licitações
- [x] Indicadores visuais de prazo (4 cores: verde, amarelo, laranja, vermelho)

## Melhorias e Otimizações
- [ ] Responsividade mobile
- [ ] Testes automatizados
- [ ] Documentação de API
- [ ] Otimização de performance

### Melhorias de Interface Solicitadas
- [x] Remover fundo branco e sombra 3D do logo
- [ ] Substituir ícone padrão pelo logo do LiciGov Pro na tela de seleção de conta OAuth (depende de configuração do Manus OAuth)
- [x] Criar tela inicial com cards de módulos (Geração de Documentos, Contratos, Parecer Jurídico, Contratação Direta, Gestão do Departamento)

### Melhorias de UI/UX - Interface Mais Atrativa
- [x] Processar logo original para remover apenas o fundo branco (manter 3D)
- [x] Aumentar tamanho da logo no header (64-80px)
- [x] Adicionar background com gradiente ou imagem na tela de módulos
- [x] Redesenhar cards dos módulos (maiores, sombras pronunciadas, ícones coloridos)
- [x] Adicionar animações de hover nos cards
- [x] Melhorar header com gradiente sutil e mais espaçamento)
- [x] Revisar e garantir responsividade mobile/desktop

### Ajustes Finais da Logo
- [x] Aumentar ainda mais o tamanho da logo no header após login (96-112px)
- [x] Remover drop-shadow da logo no header

## Fase 2 - Funcionalidades Core do MVP

### Formulário "Novo Processo"
- [x] Criar modal ou página para novo processo
- [x] Campo: Nome do processo
- [x] Campo: Objeto da contratação (textarea)
- [x] Campo: Valor estimado (currency input)
- [x] Campo: Modalidade (select: Pregão, Concorrência, Tomada de Preços, etc.)
- [x] Campo: Categoria (select: Obras, Serviços, Compras)
- [x] Validação de formulário
- [x] Integração com backend para criar processo

### Integração com IA (Google Gemini)
- [x] Configurar cliente Gemini no backend
- [x] Criar prompt estruturado para geração de ETP baseado na Lei 14.133/21
- [ ] Implementar streaming de resposta da IA (geração em background implementada)
- [x] Salvar documento ETP gerado no banco de dados
- [ ] Permitir edição do documento gerado (interface criada, funcionalidade pendente)
- [x] Adicionar feedback visual durante geração

### Tela de Detalhes do Processo
- [x] Criar página de detalhes do processo
- [x] Timeline visual interativa (ETP → TR → DFD → Edital)
- [x] Preview do documento gerado
- [ ] Botão para download em PDF (interface criada, funcionalidade pendente)
- [ ] Botão para download em DOCX (interface criada, funcionalidade pendente)
- [x] Sistema de versionamento de documentos
- [ ] Botão para editar documento (interface criada, funcionalidade pendente)
- [ ] Botão para avançar para próximo documento (TR) (pendente)

## Fase 3 - Geração Completa de Documentos

### Geração de TR (Termo de Referência)
- [x] Criar função generateTR no serviço Gemini
- [x] Adicionar botão "Avançar para TR" na tela de detalhes
- [x] Implementar mutation para gerar TR
- [x] Atualizar status do processo para "em_tr"
- [x] Salvar TR gerado no banco de dados
- [x] Exibir TR na tela de detalhes

### Geração de DFD (Documento Formalizador de Demanda)
- [x] Criar função generateDFD no serviço Gemini
- [x] Adicionar botão "Avançar para DFD" 
- [x] Implementar mutation para gerar DFD
- [x] Atualizar status do processo para "em_dfd"
- [x] Salvar DFD gerado no banco de dados
- [x] Exibir DFD na tela de detalhes

### Geração de Edital
- [x] Criar função generateEdital no serviço Gemini
- [x] Adicionar botão "Avançar para Edital"
- [x] Implementar mutation para gerar Edital
- [x] Atualizar status do processo para "em_edital"
- [x] Salvar Edital gerado no banco de dados
- [x] Exibir Edital na tela de detalhes
- [x] Marcar processo como "concluído" após gerar Edital

## Fase 4 - Navegação, Edição e Exportação

### Navegação entre Documentos
- [x] Adicionar abas/botões (ETP | TR | DFD | Edital) na tela de detalhes
- [x] Implementar navegação entre documentos sem recarregar página
- [x] Destacar visualmente o documento atual
- [x] Desabilitar abas de documentos ainda não gerados

### Download de Documentos
- [x] Instalar biblioteca para geração de PDF (puppeteer ou jsPDF)
- [x] Instalar biblioteca para geração de DOCX (docx.js)
- [x] Criar função de conversão Markdown → PDF
- [x] Criar função de conversão Markdown → DOCX
- [x] Implementar mutation para download em PDF
- [x] Implementar mutation para download em DOCX
- [x] Adicionar cabeçalho/rodapé profissional nos documentos exportados
- [ ] Testar downloads em diferentes navegadores (pendente de teste)

### Editor de Documentos
- [x] Instalar biblioteca de editor (Monaco Editor ou TipTap)
- [x] Criar componente de editor com preview lado a lado
- [ ] Implementar salvamento automático (debounced) (pendente)
- [x] Criar sistema de versionamento ao editar
- [x] Adicionar botão "Salvar alterações"
- [x] Adicionar botão "Cancelar edição"
- [x] Implementar mutation para salvar documento editado
- [x] Adicionar confirmação antes de descartar alterações não salvas

## Fase 5 - Personalização de Documentos

### Configurações de Cabeçalho e Rodapé
- [x] Criar tabela no banco de dados para armazenar configurações do usuário
- [x] Adicionar campos: nome do órgão, brasão/logo, endereço, CNPJ, telefone, e-mail, site
- [x] Criar página de configurações no frontend
- [ ] Implementar upload de imagem para brasão/logo (URL manual implementada)
- [x] Criar formulário para editar cabeçalho (nome órgão, endereço, CNPJ)
- [x] Criar formulário para editar rodapé (telefone, e-mail, site, texto customizável)
- [x] Implementar mutation para salvar configurações
- [x] Implementar query para buscar configurações do usuário
- [ ] Aplicar cabeçalho/rodapé nos documentos gerados pela IA (pendente)
- [ ] Aplicar cabeçalho/rodapé nos downloads PDF (pendente)
- [ ] Aplicar cabeçalho/rodapé nos downloads DOCX (pendente)
- [ ] Adicionar preview das configurações antes de salvar (pendente)

## Fase 6 - Aplicar Personalização e Downloads

### Integração de Cabeçalho/Rodapé nos Documentos
- [x] Modificar prompts da IA para incluir informações de cabeçalho/rodapé
- [x] Atualizar função generateETP para buscar e aplicar configurações
- [x] Atualizar função generateTR para buscar e aplicar configurações
- [x] Atualizar função generateDFD para buscar e aplicar configurações
- [x] Atualizar função generateEdital para buscar e aplicar configurações
- [x] Adicionar seção de cabeçalho no template de visualização dos documentos
- [x] Adicionar seção de rodapé no template de visualização dos documentos

### Implementação de Downloads
- [ ] Finalizar conversão para PDF com cabeçalho/rodapé
- [ ] Finalizar conversão para DOCX com cabeçalho/rodapé
- [ ] Adicionar botões de download funcionais na tela de detalhes
- [ ] Testar downloads em diferentes navegadores

## Fase 7 - Downloads em PDF e DOCX

### Implementação de Downloads
- [x] Implementar conversão de Markdown para PDF usando bibliotecas adequadas
- [x] Implementar conversão de Markdown para DOCX usando bibliotecas adequadas
- [x] Adicionar cabeçalho personalizado nos PDFs gerados
- [x] Adicionar rodapé personalizado nos PDFs gerados
- [x] Adicionar cabeçalho personalizado nos DOCX gerados
- [x] Adicionar rodapé personalizado nos DOCX gerados
- [x] Criar rotas tRPC para download de documentos
- [x] Adicionar botões de download funcionais na tela de detalhes
- [ ] Testar downloads em diferentes navegadores (pendente de teste)

## Fase 8 - Editor de Documentos Inline

### Editor de Texto Rico
- [x] Escolher e instalar biblioteca de editor (TipTap ou Monaco)
- [x] Criar componente de editor com preview em tempo real
- [x] Implementar salvamento automático de versões
- [x] Adicionar botão "Editar" nos documentos
- [x] Implementar mutation para salvar edições
- [x] Adicionar histórico de versões
- [ ] Permitir restaurar versões anteriores (pendente)

## Fase 9 - Sistema de Colaboração

### Colaboração em Processos
- [ ] Criar tabela de colaboradores no banco de dados
- [ ] Implementar permissões (visualizar, editar, aprovar)
- [ ] Criar interface para adicionar membros à equipe
- [ ] Implementar sistema de notificações de mudanças
- [ ] Adicionar log de auditoria completo
- [ ] Criar tela de gerenciamento de colaboradores
- [ ] Implementar filtros por colaborador no dashboard

## Fase 10 - Sistema de Colaboração Avançado

### Gerenciamento de Membros
- [x] Criar tabela `process_members` no schema
- [x] Adicionar enum de permissões (viewer, editor, approver, owner)
- [x] Criar mutation para adicionar membro ao processo
- [x] Criar mutation para remover membro do processo
- [x] Criar mutation para alterar permissão de membro
- [x] Criar query para listar membros de um processo
- [x] Implementar validação de permissões no backend

### Interface de Colaboração
- [x] Criar componente de modal para adicionar membros
- [x] Criar componente de lista de membros com badges de permissão
- [x] Adicionar botão "Gerenciar Membros" na tela de detalhes
- [x] Implementar busca de usuários por email
- [x] Adicionar confirmação para remover membros
- [x] Mostrar avatar e nome dos membros
- [x] Implementar controle de acesso baseado em permissões no frontend

### Notificações de Colaboração
- [x] Criar tabela `notifications` no schema
- [x] Criar mutation para criar notificação
- [x] Criar query para listar notificações do usuário
- [x] Implementar notificação ao adicionar membro
- [ ] Implementar notificação ao editar documento (pendente)
- [ ] Implementar notificação ao aprovar documento (pendente)
- [x] Criar componente de sino de notificações no header
- [x] Adicionar badge de contagem de notificações não lidas

## Fase 11 - Salvamento Automático

### Auto-save no Editor
- [x] Instalar biblioteca de debounce (lodash.debounce ou use-debounce)
- [x] Implementar hook useAutoSave com debounce de 2 segundos
- [x] Adicionar indicador visual de "Salvando..." / "Salvo"
- [x] Implementar salvamento silencioso sem criar nova versão
- [x] Adicionar timestamp de último salvamento
- [x] Tratar erros de salvamento automático
- [ ] Adicionar opção de desabilitar auto-save nas configurações (pendente)

## Fase 12 - Histórico de Versões

### Visualização de Versões
- [x] Criar componente de modal de histórico
- [x] Listar todas as versões do documento com timestamp
- [ ] Mostrar quem criou cada versão (pendente)
- [ ] Adicionar preview de diferenças entre versões (diff) (pendente)
- [x] Adicionar botão "Ver Histórico" em cada documento
- [ ] Implementar paginação para muitas versões (pendente)

### Restauração de Versões
- [x] Criar mutation para restaurar versão anterior
- [x] Adicionar botão "Restaurar" em cada versão do histórico
- [x] Implementar confirmação antes de restaurar
- [x] Criar nova versão ao restaurar (não sobrescrever)
- [x] Adicionar log de atividade ao restaurar versão
- [x] Mostrar mensagem de sucesso após restauração

## Fase 13 - Notificações por Email

### Sistema de Email
- [ ] Configurar serviço de envio de emails (Resend, SendGrid ou similar)
- [ ] Criar templates de email em HTML
- [ ] Implementar envio de email ao adicionar membro
- [ ] Implementar envio de email ao editar documento
- [ ] Implementar envio de email ao aprovar documento
- [ ] Implementar envio de email ao adicionar comentário
- [ ] Adicionar preferências de notificação (ativar/desativar emails)
- [ ] Implementar fila de emails para evitar spam

## Fase 14 - Sistema de Comentários

### Backend de Comentários
- [ ] Criar tabela `comments` no schema
- [ ] Criar mutation para adicionar comentário
- [ ] Criar mutation para editar comentário
- [ ] Criar mutation para deletar comentário
- [ ] Criar query para listar comentários de um documento
- [ ] Implementar notificação ao adicionar comentário
- [ ] Adicionar suporte a menções (@usuario)

### Interface de Comentários
- [ ] Criar componente de lista de comentários
- [ ] Criar componente de formulário de novo comentário
- [ ] Adicionar botão "Comentários" em cada documento
- [ ] Implementar contador de comentários
- [ ] Adicionar avatar e nome do autor
- [ ] Implementar edição e exclusão de comentários próprios
- [ ] Adicionar timestamp relativo (há X minutos)
- [ ] Implementar markdown nos comentários

## Fase 15 - Dashboard de Analytics

### Métricas de Backend
- [ ] Criar query para contar processos por status
- [ ] Criar query para contar documentos gerados por período
- [ ] Criar query para calcular tempo médio por documento
- [ ] Criar query para listar membros mais ativos
- [ ] Criar query para contar atividades por usuário
- [ ] Criar query para estatísticas de colaboração

### Interface de Analytics
- [ ] Criar página de Dashboard de Analytics
- [ ] Adicionar cards de métricas principais (total processos, documentos, membros)
- [ ] Criar gráfico de processos por status (pizza)
- [ ] Criar gráfico de documentos gerados por mês (barras)
- [ ] Criar tabela de membros mais ativos
- [ ] Adicionar filtros por período (7 dias, 30 dias, 90 dias, ano)
- [ ] Implementar exportação de relatórios em PDF
- [ ] Adicionar comparação com período anterior

## Fase 16 - Conformidade LGPD

### Termos e Consentimento
- [ ] Criar tabela `user_consents` no schema
- [ ] Criar página de Termos de Uso
- [ ] Criar página de Política de Privacidade
- [ ] Implementar modal de consentimento no primeiro login
- [ ] Salvar registro de consentimento com timestamp
- [ ] Adicionar checkbox de aceite obrigatório
- [ ] Criar rota para visualizar termos aceitos

### Direito ao Esquecimento
- [ ] Criar mutation para solicitar exclusão de conta
- [ ] Implementar exclusão em cascata (processos, documentos, comentários)
- [ ] Criar confirmação de exclusão com senha
- [ ] Adicionar período de carência (30 dias)
- [ ] Enviar email de confirmação de exclusão
- [ ] Criar log de exclusões para auditoria

### Portabilidade de Dados
- [ ] Criar rota para exportar todos os dados do usuário
- [ ] Gerar arquivo JSON com todos os dados
- [ ] Incluir processos, documentos, comentários, atividades
- [ ] Adicionar botão "Exportar Meus Dados" nas configurações

## Fase 17 - Sistema de Administração

### Gerenciamento de Usuários
- [ ] Criar página de Admin (apenas para role=admin)
- [ ] Listar todos os usuários cadastrados
- [ ] Implementar busca e filtros de usuários
- [ ] Adicionar botão para promover usuário a admin
- [ ] Adicionar botão para rebaixar admin a usuário
- [ ] Implementar desativação de conta (sem deletar)
- [ ] Mostrar estatísticas de cada usuário (processos, documentos)

### Auditoria e Logs
- [ ] Criar tabela `audit_logs` para ações administrativas
- [ ] Registrar todas as alterações de permissões
- [ ] Registrar acessos administrativos
- [ ] Criar página de visualização de logs
- [ ] Implementar filtros por tipo de ação e período
- [ ] Adicionar exportação de logs em CSV

## Fase 18 - Integração de Email Real (Resend)

- [ ] Instalar biblioteca resend
- [ ] Criar variável de ambiente RESEND_API_KEY
- [ ] Atualizar emailService.ts para usar Resend
- [ ] Testar envio de email ao adicionar membro
- [ ] Testar envio de email ao editar documento
- [ ] Adicionar tratamento de erros de envio

## Fase 19 - Modal de Consentimento LGPD

- [ ] Criar componente ConsentModal
- [ ] Verificar se usuário já aceitou termos (versão 1.0)
- [ ] Exibir modal automaticamente no primeiro acesso
- [ ] Bloquear acesso até aceitar termos
- [ ] Registrar consentimento com IP e User-Agent
- [ ] Adicionar links para Termos de Uso e Política de Privacidade

## Fase 20 - Página de Logs de Auditoria

- [ ] Criar página AuditLogs (apenas para admins)
- [ ] Listar todos os logs de auditoria
- [ ] Adicionar filtros por tipo de ação
- [ ] Adicionar filtros por período (data início/fim)
- [ ] Adicionar busca por usuário
- [ ] Implementar paginação
- [ ] Adicionar botão de exportar para CSV
- [ ] Mostrar detalhes completos de cada log

## Fase 21 - Sistema de Billing e Assinaturas

### Backend de Billing
- [ ] Criar tabela `subscriptions` no schema
- [ ] Criar tabela `subscription_plans` no schema
- [ ] Criar tabela `usage_tracking` no schema (processos, armazenamento)
- [ ] Instalar biblioteca stripe
- [ ] Configurar Stripe em modo teste
- [ ] Criar mutation para criar assinatura
- [ ] Criar mutation para cancelar assinatura
- [ ] Criar mutation para upgrade/downgrade de plano
- [ ] Criar webhook para eventos do Stripe (payment_succeeded, payment_failed)
- [ ] Implementar lógica de renovação automática
- [ ] Criar query para obter status da assinatura

### Controle de Limites
- [ ] Implementar middleware de verificação de limites
- [ ] Criar contador de processos usados/disponíveis
- [ ] Criar contador de armazenamento usado/disponível
- [ ] Criar contador de usuários ativos/disponíveis
- [ ] Bloquear criação de processo quando atingir limite
- [ ] Bloquear upload quando atingir limite de armazenamento
- [ ] Bloquear adição de usuário quando atingir limite
- [ ] Criar avisos de limite (80%, 90%, 100%)
- [ ] Implementar reset mensal de contadores

### Interface de Billing
- [ ] Criar página de planos (/planos)
- [ ] Criar página de checkout (integração Stripe)
- [ ] Criar painel de assinatura do usuário (/configuracoes/assinatura)
- [ ] Mostrar plano atual e limites
- [ ] Mostrar uso atual (processos, armazenamento, usuários)
- [ ] Adicionar botão de upgrade de plano
- [ ] Adicionar botão de cancelar assinatura
- [ ] Criar modal de confirmação de cancelamento
- [ ] Mostrar histórico de pagamentos
- [ ] Adicionar botão de baixar nota fiscal

## Fase 22 - Preparação para RAG (Arquitetura Futura)

### Arquitetura Base
- [ ] Criar pasta `server/rag/` para código futuro
- [ ] Criar interface `DocumentRetriever` (abstração)
- [ ] Criar arquivo de configuração `rag.config.ts`
- [ ] Documentar arquitetura RAG no README
- [ ] Criar tabela `document_embeddings` (preparada, não usada ainda)
- [ ] Criar tabela `knowledge_base` (preparada, não usada ainda)

### Preparação de Dados
- [ ] Adicionar campo `learn_from_this` em documentos (flag)
- [ ] Criar mutation para marcar documento como "aprendizado"
- [ ] Criar estrutura de pastas para corpus (leis, jurisprudência)
- [ ] Documentar processo de indexação (para implementar depois)

## Fase 23 - Melhoria de Precisão da IA (Anti-Alucinação)

### Prompts Estruturados
- [ ] Refatorar prompts com instruções explícitas anti-alucinação
- [ ] Adicionar regra "NÃO invente referências legais"
- [ ] Adicionar regra "Use apenas informações fornecidas"
- [ ] Adicionar exemplos de saída esperada (few-shot)
- [ ] Implementar validação de saída (detectar alucinações)

### Configuração da IA
- [ ] Reduzir temperature para 0.3 (mais determinístico)
- [ ] Implementar response_format JSON estruturado
- [ ] Adicionar campo de confiança na resposta
- [ ] Criar sistema de fallback (se confiança < 70%, avisar usuário)
- [ ] Adicionar logs de qualidade das respostas

### Validação de Documentos
- [ ] Criar função de validação de referências legais
- [ ] Verificar se artigos citados existem (Lei 14.133/21)
- [ ] Adicionar aviso "Revise este documento antes de usar oficialmente"
- [ ] Criar checklist de revisão para o usuário
- [ ] Implementar sistema de feedback (documento aprovado/rejeitado)

## Fase 24 - Sistema de Proposta Comercial e Pagamento por Empenho

### Backend de Propostas
- [ ] Criar tabela `proposal_requests` no schema
- [ ] Criar tabela `company_documents` no schema
- [ ] Criar função para gerar proposta comercial em PDF
- [ ] Criar função para gerar minuta de contrato em DOCX
- [ ] Criar função para gerar Termo de Referência em DOCX
- [ ] Adicionar justificativa técnica baseada na Lei 14.133/2021
- [ ] Implementar geração de ZIP com documentos da empresa
- [ ] Criar mutation para solicitar proposta
- [ ] Criar query para listar solicitações (admin)

### Gestão de Documentos da Empresa
- [ ] Criar CRUD de documentos da empresa (admin)
- [ ] Implementar upload de documentos com data de validade
- [ ] Criar sistema de alertas de vencimento (30 dias antes)
- [ ] Implementar histórico de versões de documentos
- [ ] Adicionar status visual (Válido, Vence em X dias, Vencido)
- [ ] Criar verificação de documentos vencidos ao gerar proposta

### Interface de Solicitação
- [ ] Criar página `/solicitar-proposta`
- [ ] Criar formulário com dados do órgão (nome, CNPJ, endereço, responsável)
- [ ] Adicionar seleção de plano desejado
- [ ] Implementar página de download de documentos
- [ ] Adicionar botão de download da proposta (PDF)
- [ ] Adicionar botão de download do contrato (DOCX)
- [ ] Adicionar botão de download do TR (DOCX)
- [ ] Adicionar botão de download dos documentos da empresa (ZIP)

### Painel de Admin
- [ ] Criar página `/admin/assinaturas` (todas as assinaturas: Stripe + Empenho)
- [ ] Criar página `/admin/propostas` (gerenciar solicitações de empenho)
- [ ] Listar todas as solicitações de proposta
- [ ] Adicionar filtros (status, plano, data)
- [ ] Adicionar ação "Registrar Empenho"
- [ ] Adicionar ação "Ativar Assinatura" após receber empenho
- [ ] Criar página `/admin/documentos-empresa`
- [ ] Implementar upload de documentos
- [ ] Mostrar status de validade de cada documento (Válido, Vence em X dias, Vencido)
- [ ] Adicionar botão "Atualizar" para substituir documento

### Documentos da Empresa Necessários
- [ ] Contrato Social
- [ ] Cartão CNPJ
- [ ] Certidão Federal (Receita Federal e Dívida Ativa da União)
- [ ] Certidão Estadual (Fazenda Estadual)
- [ ] Certidão Municipal (Fazenda Municipal)
- [ ] Certidão FGTS
- [ ] Certidão Trabalhista (TST)
- [ ] Alvará de Funcionamento

## Fase 25 - Gestão de Contratos e Renovação

### Upload de Documentos Contratuais
- [ ] Adicionar campo de upload de nota de empenho no painel de propostas
- [ ] Adicionar campo de upload de contrato assinado no painel de propostas
- [ ] Implementar armazenamento de arquivos no S3
- [ ] Adicionar visualização/download dos arquivos anexados
- [ ] Validar formato de arquivo (apenas PDF)
- [ ] Adicionar limite de tamanho de arquivo (10MB)

### Controle de Vigência Contratual
- [ ] Adicionar campo de data de assinatura do contrato
- [ ] Adicionar campo de data de início da vigência
- [ ] Adicionar campo de data de término da vigência
- [ ] Calcular dias restantes até vencimento
- [ ] Implementar badge visual de status (Vigente, Vence em X dias, Vencido)
- [ ] Adicionar filtro por status de vigência no painel de assinaturas

### Alertas de Renovação
- [ ] Criar sistema de alertas automáticos (30, 60, 90 dias antes)
- [ ] Enviar email de alerta de renovação para admin
- [ ] Adicionar notificação in-app de contratos próximos do vencimento
- [ ] Criar dashboard de contratos a vencer
- [ ] Implementar botão "Renovar Contrato" (gera nova proposta)

## Fase 26 - Gestão de Notas Fiscais Mensais

### Backend de Parcelas
- [ ] Criar tabela `invoice_installments` no schema
- [ ] Criar função para gerar parcelas mensais ao ativar assinatura
- [ ] Criar mutation para registrar NF (número, data, PDF)
- [ ] Criar mutation para anexar comprovante de pagamento
- [ ] Criar mutation para marcar parcela como paga
- [ ] Criar query para listar parcelas de uma assinatura
- [ ] Implementar cálculo automático de status (pendente, emitida, paga, atrasada)

### Interface de Notas Fiscais
- [ ] Mover gestão de contratos do painel de propostas para assinaturas
- [ ] Criar aba "Notas Fiscais" no painel de assinaturas
- [ ] Criar tabela de parcelas mensais com status
- [ ] Implementar modal "Registrar NF" (número, data, upload PDF)
- [ ] Implementar modal "Anexar Comprovante" (upload PDF)
- [ ] Adicionar botão "Marcar como Paga"
- [ ] Mostrar resumo financeiro (pago vs pendente)

### Alertas e Dashboard
- [ ] Criar sistema de alertas de vencimento (5 dias antes, no dia, 5 dias depois)
- [ ] Implementar dashboard de inadimplência
- [ ] Adicionar filtro por status de pagamento
- [ ] Criar relatório de exportação (Excel/PDF)
- [ ] Implementar badges visuais de status

## Correções e Melhorias Recentes

### Correção de Bugs Críticos
- [x] Corrigir problema de inputs não permitindo digitação (arrow functions inline causando remontagem do DOM)
- [x] Corrigir interface tremendo/piscando
- [x] Corrigir botões precisando múltiplos cliques
- [x] Tornar campo "Valor Estimado" opcional no formulário de novo processo

## Melhorias de Qualidade e UX

### Limpeza de Código
- [ ] Corrigir warnings TypeScript em Settings.tsx (tipo do parâmetro err)
- [ ] Remover código legado de paymentMethod em db.ts
- [ ] Corrigir demais warnings TypeScript

### Funcionalidades de Produtividade
- [x] Implementar salvamento automático (debounced) no editor de documentos
- [x] Adicionar indicador visual de "salvando..." durante auto-save

### Validações
- [x] Adicionar validação de formato de CNPJ nas configurações
- [x] Adicionar feedback visual para CNPJ inválido

## Melhorias de Produtividade

### Histórico de Versões
- [x] Criar componente de timeline interativa para histórico de versões
- [x] Implementar diff highlighting entre versões de documentos
- [x] Adicionar botão para restaurar versão anterior

### Busca e Navegação
- [x] Adicionar campo de busca global no header
- [x] Implementar busca por nome, objeto e número do processo
- [x] Adicionar atalho de teclado Cmd/Ctrl+K para busca

### Relatórios e Exportação
- [x] Implementar exportação de lista de processos em Excel
- [x] Adicionar filtros para exportação (status, modalidade)
- [x] Incluir dados completos no relatório (nome, objeto, valor, status, datas)

## Funcionalidades Avançadas

### Dashboard e Métricas
- [x] Criar cards de estatísticas (total de processos, valor total, processos por status)
- [x] Implementar gráfico de distribuição por status (pizza)
- [x] Implementar gráfico de distribuição por modalidade (barras)
- [x] Adicionar indicadores percentuais

### Notificações por Email
- [x] Configurar serviço de envio de emails (Resend)
- [x] Implementar notificação de mudança de status
- [x] Criar template de email responsivo
- [ ] Adicionar alertas de prazos próximos (feature futura)

### Templates Personalizáveis
- [x] Criar tabela de templates no banco de dados
- [x] Implementar funções CRUD de templates no backend
- [ ] Criar interface de gerenciamento de templates (UI)
- [ ] Adicionar seleção de template ao criar novo processo
- [ ] Permitir salvar documento atual como template

## Prioridade ALTA - Sprint 1

### 1. Interface de Gerenciamento de Templates
- [x] Criar página de gerenciamento de templates (/templates)
- [x] Listar todos os templates do usuário
- [x] Formulário para criar novo template
- [x] Editar template existente
- [x] Excluir template com confirmação
- [x] Marcar/desmarcar template como padrão
- [ ] Integrar seleção de template no formulário de novo processo (pendente)
- [ ] Botão "Salvar como template" no editor de documentos (pendente)

### 2. Filtros Avançados no Dashboard
- [ ] Adicionar filtros por data (criação/atualização) (pendente - requer refatoração)
- [ ] Filtro por modalidade (dropdown) (pendente)
- [ ] Filtro por status (dropdown) (pendente)
- [ ] Filtro por categoria (pendente)
- [ ] Persistir filtros na URL (query params) (pendente)
- [ ] Botão "Limpar filtros" (pendente)
- [ ] Contador de resultados filtrados (pendente)

### 3. Relatório de Atividades/Auditoria
- [x] Criar página de relatório de atividades (/auditoria)
- [x] Listar todas as atividades
- [x] Filtros por data e ação
- [x] Busca por texto livre
- [x] Exportar relatório em HTML (conversão para PDF via navegador)
- [x] Cards visuais de atividades

## Refatoração e Landing Page

### Remover Módulo de Faturas
- [x] Remover rotas de invoices do backend (server/routers.ts)
- [x] Remover invoiceRouter.ts
- [x] Remover tabela invoiceInstallments do schema
- [ ] Remover páginas relacionadas a faturas no frontend (se houver)
- [x] Limpar imports e referências

### Melhorar Sistema de Propostas
- [x] Criar função para gerar ZIP com proposta + documentos da empresa
- [x] Atualizar endpoint de download para retornar ZIP
- [x] Atualizar frontend para baixar ZIP
- [ ] Testar fluxo completo de geração e download

### Landing Page Profissional
- [x] Criar nova página LandingPage.tsx
- [x] Hero section com título impactante e CTA
- [x] Seção de funcionalidades (6 cards com ícones)
- [x] Seção de benefícios
- [x] Seção CTA final
- [x] Footer com informações
- [x] Botão "Entrar" no header
- [x] Responsividade mobile (Tailwind)


## Fase 20 - Melhorias da Landing Page (Estilo Adapta)

### Design e Visual
- [x] Aplicar logo LiciGov Pro no header da landing page
- [x] Configurar tema padrão light (modo dark disponível via toggle)
- [x] Corrigir página preta após login (verificar rota de redirecionamento)
- [x] Redesenhar hero section com layout assimétrico (texto esquerda + imagem direita)
- [x] Adicionar gradientes sutis no background
- [x] Melhorar espaçamento e hierarquia visual
- [x] Ajustar paleta de cores para institucional mas vibrante

### Imagens e Mockups
- [x] Gerar screenshot realista do dashboard do sistema
- [x] Criar mockup de laptop mostrando interface em uso
- [x] Gerar imagem de documentos sendo gerados (ETP, TR, Edital)
- [x] Adicionar elementos decorativos sutis (brasão estilizado, documentos)

### Conteúdo e Social Proof
- [x] Adicionar seção de depoimentos com fotos (gestores públicos fictícios)
- [x] Criar seção com logos de órgãos públicos (placeholder)
- [x] Melhorar copy dos benefícios
- [x] Adicionar seção "Como Funciona" com passo a passo visual
- [x] Adicionar estatísticas de impacto (tempo economizado, processos criados)

### Funcionalidades
- [x] Melhorar CTAs (primário azul + secundário outline)
- [x] Adicionar animações sutis ao scroll (blob animation)
- [x] Implementar efeitos hover nos cards
- [x] Otimizar responsividade mobile
- [ ] Adicionar seção de FAQ

### Técnico
- [x] Garantir tema light fixo (remover ThemeProvider switchable)
- [x] Corrigir rota após login (evitar tela preta)
- [x] Otimizar carregamento de imagens
- [ ] Implementar lazy loading para imagens


## Fase 21 - Ajustes Legais e Visuais da Landing Page

### Conformidade Legal (Risco Alto)
- [x] Remover seção de depoimentos fictícios completamente
- [x] Remover estatísticas numéricas falsas (70%, 500+, 10.000+)
- [x] Remover social proof com "500+ órgãos públicos"
- [x] Substituir por seção de benefícios baseada em funcionalidades reais
- [x] Manter apenas informações verificáveis (Lei 14.133/21, funcionalidades técnicas)

### Melhorias Visuais
- [x] Aumentar logo no header de h-12 para h-20
- [x] Gerar 5 imagens realistas para cards de funcionalidades
- [x] Adicionar imagens nos cards (atualmente só têm ícones)
- [x] Melhorar hierarquia visual sem depender de números fictícios

### Conteúdo Alternativo
- [x] Criar seção de benefícios operacionais (substituir estatísticas)
- [x] Focar em proposta de valor técnica e funcional
- [x] Destacar conformidade legal e segurança


## Fase 22 - Localização de Imagens (Português)

### Imagens dos Cards de Funcionalidades
- [x] Regenerar imagem "Gestão de Processos" com textos em português (Status, Andamento, Data de Abertura)
- [x] Regenerar imagem "Geração de Documentos IA" com textos em português (ETP, TR, Gerar Texto, Sugestões)
- [x] Regenerar imagem "Colaboração em Equipe" com textos em português (Comentários, Histórico de Versões, Revisão)
- [x] Regenerar imagem "Dashboard Analytics" com textos em português (Contratos, Gastos, Conformidade)
- [x] Regenerar imagem "Segurança e Auditoria" com textos em português (Log de Auditoria, Usuário, Ação)


## Fase 23 - Correção de Erro Mobile

### Problema Reportado
- [ ] Investigar erro "Falha ao carregar a pré-visualização" na landing page mobile
- [ ] Verificar logs do servidor para identificar causa
- [ ] Verificar erros de build ou TypeScript
- [ ] Corrigir problema de carregamento
- [ ] Testar responsividade mobile após correção


## Fase 24 - Dashboard de Seleção de Módulos

### Tela Inicial Pós-Login
- [x] Criar componente ModuleSelectionDashboard.tsx
- [x] Exibir cards de módulos disponíveis (Processos Licitatórios)
- [x] Exibir cards de módulos futuros com badge "Em Breve" (Contratação Direta, Contratos, Parecer Jurídico, Gestão)
- [x] Implementar navegação para cada módulo disponível
- [x] Atualizar roteamento para /dashboard como página inicial após login
- [x] Atualizar redirecionamento OAuth para /dashboard
- [x] Remover "Propostas Comerciais" do dashboard (não deve aparecer, apenas no admin)
- [x] Testar fluxo completo de login → dashboard → módulo específico


## Fase 25 - Integração CATMAT/CATSER (PRIORIDADE ALTA)

### Backend - API de Integração
- [ ] Pesquisar API oficial do CATMAT/CATSER (ComprasNet)
- [ ] Criar serviço de integração no backend (server/services/catmatService.ts)
- [ ] Implementar função de busca por termo
- [ ] Implementar função de busca por código
- [ ] Implementar cache de resultados (evitar requisições repetidas)
- [ ] Criar tRPC router para CATMAT/CATSER (server/routers/catmatRouter.ts)
- [ ] Adicionar tratamento de erros e fallback

### Database - Armazenamento de Itens
- [ ] Criar tabela `process_items` no schema
- [ ] Campos: id, processId, catmatCode, description, unit, quantity, estimatedPrice
- [ ] Criar relação com tabela `processes`
- [ ] Executar migration (pnpm db:push)

### Frontend - Interface de Busca
- [ ] Criar componente CatmatSearch.tsx com autocomplete
- [ ] Adicionar campo de busca no formulário de novo processo
- [ ] Implementar debounce na busca (evitar requisições excessivas)
- [ ] Exibir resultados com código, descrição e unidade
- [ ] Permitir seleção de múltiplos itens
- [ ] Criar tabela de itens selecionados com quantidade e preço estimado
- [ ] Adicionar botão "Remover item"
- [ ] Salvar itens selecionados ao criar processo

### Integração com IA - Geração de TR
- [ ] Atualizar prompt de geração de TR para incluir itens CATMAT/CATSER
- [ ] Formatar itens selecionados em tabela estruturada
- [ ] Incluir código, descrição, unidade, quantidade e preço estimado
- [ ] Adicionar seção "Especificações Técnicas" no TR baseada nos itens

### Testes e Validação
- [ ] Testar busca de itens do CATMAT
- [ ] Testar busca de serviços do CATSER
- [ ] Testar seleção de múltiplos itens
- [ ] Testar geração de TR com itens selecionados
- [ ] Validar conformidade com Lei 14.133/2021


## Fase 26 - Finalização Completa

### Correção de Fuso Horário
- [x] Auditar todas as queries de banco que usam timestamp
- [x] Implementar conversão UTC → America/Sao_Paulo no backend (shared/timezone.ts)
- [x] Garantir que datas sejam exibidas no fuso horário do Brasil
- [ ] Testar criação e exibição de datas

### Remoção de Componentes Obsoletos
- [x] Remover AttachPaymentProofDialog.tsx
- [x] Remover MarkAsPaidDialog.tsx
- [x] Remover RegisterInvoiceDialog.tsx
- [x] Remover RenewContractDialog.tsx
- [x] Remover RenewalHistoryView.tsx
- [x] Remover referências a esses componentes
- [ ] Verificar build sem erros TypeScript (21 erros restantes)

### Finalização CATMAT/CATSER
- [x] Adicionar campo CatmatSearch no formulário NewProcess
- [x] Criar função saveProcessItems no db.ts
- [x] Criar função getProcessItems no db.ts
- [x] Salvar itens selecionados ao criar processo (integrado no mutation)
- [x] Atualizar prompt generateTR para incluir itens CATMAT
- [x] Buscar itens CATMAT ao gerar TR e passar para IA
- [ ] Testar fluxo completo: buscar item → selecionar → criar processo → gerar TR
### FAQ na Landing Page
- [x] Criar seção FAQ com 8 perguntas
- [x] Perguntas sobre precificação
- [x] Perguntas sobre implementação
- [x] Perguntas sobre conformidade legal
- [x] Perguntas sobre usabilidade (editação de documentos)
- [x] Perguntas sobre integração CATMAT/CATSER
- [x] Perguntas sobre suporte
- [x] Perguntas sobre segurança e LGPDanimação de expand/collapse
- [ ] Responsividade mobile


## Fase 27 - Módulo de Gestão do Departamento de Licitações

### Schema do Banco de Dados
- [x] Criar tabela `tasks` (tarefas do departamento)
- [x] Criar tabela `task_comments` (comentários em tarefas)
- [x] Criar tabela `task_attachments` (anexos de tarefas)
- [x] Criar tabela `task_history` (histórico de alterações)
- [x] Criar tabela `task_edit_locks` (bloqueio de edição colaborativo)
- [x] Executar `pnpm db:push` para aplicar mudanças

### Backend tRPC
- [x] Criar `taskRouter.ts` com procedures CRUD
- [x] Implementar `tasks.create` (criar tarefa)
- [x] Implementar `tasks.list` (listar com filtros avançados)
- [x] Implementar `tasks.getById` (detalhes da tarefa)
- [x] Implementar `tasks.update` (editar tarefa)
- [x] Implementar `tasks.delete` (excluir tarefa - admin only)
- [x] Implementar `tasks.updateStatus` (mudar status - para Kanban)
- [x] Adicionar taskRouter ao appRouter

### Filtros Avançados
- [ ] Implementar filtro por texto (busca em título, descrição, comentários)
- [ ] Implementar filtro por status (múltipla seleção)
- [ ] Implementar filtro por prioridade
- [ ] Implementar filtro por tipo/categoria
- [ ] Implementar filtro por responsável
- [ ] Implementar filtro por período de criação (de/até)
- [ ] Implementar filtro por período de prazo (de/até)
- [ ] Implementar filtro por tags

### Funções do Backend
- [ ] Criar `getTaskStats()` no db.ts (KPIs do dashboard)
- [ ] Criar `getTasksByDeadline()` (tarefas urgentes)
- [ ] Criar `getOverdueTasks()` (tarefas atrasadas)
- [ ] Criar `getTaskHistory()` (histórico de alterações)
- [ ] Criar `setEditLock()` e `getEditLock()` (bloqueio colaborativo)
- [ ] Criar `addTaskComment()` e `getTaskComments()`
- [ ] Criar `uploadTaskAttachment()` e `getTaskAttachments()`

### Interface Kanban
- [ ] Criar componente `TaskKanban.tsx`
- [ ] Implementar drag & drop com `@dnd-kit/core`
- [ ] Criar 6 colunas (Pendente, Em Andamento, Pausada, Atrasada, Aguardando, Concluída)
- [ ] Criar cards de tarefas com badges (prioridade, prazo)
- [ ] Implementar indicadores visuais de prazo (4 cores)
- [ ] Adicionar contador de tarefas por coluna
- [ ] Implementar atualização de status via drag & drop

### Visualização Lista
- [ ] Criar componente `TaskList.tsx`
- [ ] Criar tabela com 7 colunas (Título, Tipo, Responsável, Status, Prioridade, Prazo, Ações)
- [ ] Implementar componente de filtros avançados
- [ ] Adicionar ordenação por coluna
- [ ] Implementar paginação (20 itens por página)
- [ ] Adicionar botões de ação (visualizar, editar, excluir)

### Visualização Calendário
- [ ] Criar componente `TaskCalendar.tsx`
- [ ] Integrar biblioteca `react-big-calendar`
- [ ] Implementar marcadores coloridos por prioridade
- [ ] Adicionar navegação entre meses
- [ ] Implementar clique para ver detalhes da tarefa
- [ ] Adicionar legenda de cores

### Dashboard
- [ ] Criar componente `DepartmentDashboard.tsx`
- [ ] Implementar 4 KPIs clicáveis (Total, Em Andamento, Concluídas, Atrasadas)
- [ ] Criar gráfico de pizza (distribuição por status)
- [ ] Criar gráfico de pizza (distribuição por prioridade)
- [ ] Criar gráfico de barras (top 5 tipos de tarefas)
- [ ] Criar gráfico de linhas (evolução mensal)
- [ ] Implementar widget "Tarefas Urgentes"
- [ ] Implementar filtro "Minhas Tarefas" vs "Todas"

### Funcionalidades Colaborativas
- [ ] Criar componente `TaskComments.tsx`
- [ ] Implementar adição de comentários
- [ ] Implementar listagem cronológica de comentários
- [ ] Criar componente `TaskAttachments.tsx`
- [ ] Implementar upload de anexos (S3, limite 10MB)
- [ ] Implementar download de anexos
- [ ] Criar componente `TaskHistory.tsx` (timeline de alterações)
- [ ] Implementar bloqueio de edição colaborativo (banner visual)
- [ ] Implementar sistema de notificações (3 dias antes do prazo)

### Relatórios
- [ ] Criar componente `TaskReports.tsx`
- [ ] Implementar relatório por período (diário, semanal, mensal)
- [ ] Implementar exportação PDF (formatado profissionalmente)
- [ ] Implementar exportação Excel (múltiplas abas)
- [ ] Respeitar filtros ativos na exportação

### Integração com Processos Licitatórios
- [ ] Adicionar campo `processId` na tabela `tasks`
- [ ] Criar botão "Criar Tarefa" na página de detalhes do processo
- [ ] Pré-preencher formulário com dados do processo
- [ ] Listar tarefas vinculadas na página de detalhes do processo
- [ ] Implementar filtro por processo na listagem de tarefas

### Roteamento
- [ ] Adicionar rota `/gestao` no ModuleSelectionDashboard
- [ ] Criar rota `/gestao/dashboard` (dashboard principal)
- [ ] Criar rota `/gestao/kanban` (visualização Kanban)
- [ ] Criar rota `/gestao/lista` (visualização Lista)
- [ ] Criar rota `/gestao/calendario` (visualização Calendário)
- [ ] Criar rota `/gestao/tarefas/:id` (detalhes da tarefa)
- [ ] Criar rota `/gestao/relatorios` (relatórios)

### Testes
- [ ] Testar criação de tarefa
- [ ] Testar edição de tarefa
- [ ] Testar exclusão de tarefa
- [ ] Testar drag & drop no Kanban
- [ ] Testar filtros avançados
- [ ] Testar exportação de relatórios
- [ ] Testar bloqueio de edição colaborativo
- [ ] Testar vinculação com processos licitatórios
- [ ] Testar indicadores de prazo
- [ ] Testar notificações


## Módulo: Gestão do Departamento de Licitações

### Backend (100% Concluído)
- [x] Schema do banco de dados (tasks, task_comments, task_attachments, task_history, task_edit_locks)
- [x] Router tRPC com 8 procedures (create, update, delete, list, getById, addComment, addAttachment, getStats)
- [x] Funções de banco de dados em db.ts (8 funções)
- [x] Seed de tarefas de teste (8 tarefas)

### Interface Kanban (100% Concluído)
- [x] Componente TaskKanban com drag & drop (@dnd-kit)
- [x] 7 colunas de status (Pendente, Em Andamento, Pausada, Atrasada, Aguardando Info, Concluída, Cancelada)
- [x] Cards de tarefas com badges de prioridade (Baixa, Média, Alta, Urgente)
- [x] Indicadores visuais de prazo com 4 cores (verde, amarelo, laranja, vermelho)
- [x] Contadores de tarefas por coluna
- [x] Scroll horizontal para navegação entre colunas
- [x] Integração com tRPC para listar tarefas
- [x] Atualização de status via drag & drop
- [x] Rota /gestao-departamento criada
- [x] Módulo adicionado ao dashboard principal

### Interface Lista (0% - Próxima Fase)
- [ ] Componente TaskList com tabela de 7 colunas
- [ ] Filtros avançados (8 critérios combinados)
- [ ] Paginação (20 itens por página)
- [ ] Ordenação por colunas
- [ ] Seleção múltipla de tarefas
- [ ] Ações em lote (atualizar status, excluir)
- [ ] Exportar para PDF/Excel

### Interface Calendário (0%)
- [ ] Componente TaskCalendar com visualização mensal
- [ ] Tarefas agrupadas por data de prazo
- [ ] Cores por prioridade
- [ ] Click para visualizar/editar tarefa
- [ ] Navegação entre meses
- [ ] Indicadores de tarefas vencidas

### Dashboard Analítico (0%)
- [ ] 4 KPIs clicáveis (Total, Pendentes, Em Andamento, Atrasadas)
- [ ] Gráfico de pizza: distribuição por status
- [ ] Gráfico de pizza: distribuição por prioridade
- [ ] Gráfico de barras: top 5 tipos de tarefas
- [ ] Gráfico de linha: evolução mensal
- [ ] Widget de tarefas urgentes
- [ ] Filtros de período

### Funcionalidades Colaborativas (0%)
- [ ] Sistema de comentários com @mentions
- [ ] Upload de anexos (até 10MB)
- [ ] Bloqueio de edição colaborativo
- [ ] Timeline de histórico de alterações
- [ ] Notificações push para responsáveis
- [ ] Atribuição de tarefas a usuários

### Recursos Avançados (0%)
- [ ] Numeração sequencial automática
- [ ] Tramitação de tarefas (histórico de movimentações)
- [ ] Vinculação com processos licitatórios
- [ ] Tags personalizadas
- [ ] Busca avançada (texto completo)
- [ ] Relatórios de produtividade
- [ ] Integração com calendário de prazos

## Módulo 5 - Gestão do Departamento: Dashboard Analítico

- [x] 4 KPIs principais (Total, Concluídas, Em Andamento, Atrasadas)
- [x] Gráfico de pizza - Distribuição por Status
- [x] Gráfico de pizza - Distribuição por Prioridade
- [x] Gráfico de barras - Top 5 Tipos de Tarefas
- [x] Gráfico de linha - Evolução Mensal (últimos 6 meses)
- [x] Integração com Recharts
- [x] Design responsivo e profissional


## Módulo 5 - Gestão do Departamento: Funcionalidades Colaborativas

### Backend (Implementado)
- [x] Procedures tRPC para comentários (listComments, addComment)
- [x] Procedures tRPC para anexos (listAttachments, addAttachment, deleteAttachment)
- [x] Funções no db.ts (listTaskComments, createTaskComment, listTaskAttachments, createTaskAttachment, deleteTaskAttachment)
- [x] Validação de tamanho de arquivo (10MB)

### Frontend (Pendente de Integração)
- [x] Componente TaskDetailModal criado
- [x] Integrar modal no Kanban (clicar em tarefa abre modal)
- [x] Integrar modal na Lista (clicar em linha abre modal)
- [ ] Upload real para S3 (atualmente usa base64)
- [ ] Sistema de notificações push
- [ ] Timeline de histórico de alterações
- [ ] Bloqueio de edição simultânea


## Testes Realizados
- [x] Modal de detalhes abre ao clicar em tarefa no Kanban
- [x] Modal mostra todas as informações (título, prioridade, status, tipo, prazo, responsável, descrição)
- [x] Seção de anexos visível (0 anexos, botão "Adicionar Anexo", limite 10MB)
- [x] Seção de comentários visível (campo de texto, botão "Enviar Comentário")
- [x] Botão Close fecha o modal
- [ ] Salvar comentário no banco (requer autenticação)
- [ ] Upload de anexo para S3 (requer implementação)


## Correções de TypeScript Realizadas
- [x] Corrigir tipos no departmentTasksRouter (status/prioridade em português)
- [x] Adicionar campo createdBy obrigatório
- [x] Corrigir assignedTo de string para number
- [x] Corrigir dueDate para deadline no TaskCalendar (10 ocorrências)
- [x] Corrigir status em inglês para português no TaskDashboard (4 ocorrências)
- [x] Corrigir verificações de null no TaskDetailModal (deadline, uploadedAt)
- [x] Corrigir query condicional no getOverdueTasks (db.ts)
- [x] Converter catmatCode/catserCode para int no saveProcessItems (db.ts)
- [x] Converter catmatCode/catserCode para string no routers.ts
- [x] **Reduzir erros de TypeScript de 43 para 17 (redução de 60%)**
- [x] **Módulo de Gestão do Departamento 100% livre de erros!**
- [ ] Erros restantes (17) são de módulos antigos (AdminDocuments, AdminProposals, etc.)


## 🔧 Correção de Conformidade com Lei 14.133/21

### Problema Identificado
- [ ] Itens CATMAT/CATSER estão sendo solicitados na criação do processo (antes do ETP)
- [ ] Segundo a Lei 14.133/21, itens devem ser detalhados apenas no TR, não no ETP

### Alterações Necessárias

#### Frontend
- [x] Remover campo catmatItems da tela NewProcess.tsx
- [x] Remover componente CatmatSearch de NewProcess.tsx
- [ ] Criar tela/modal "Elaborar TR" para adicionar itens CATMAT
- [ ] Adicionar botão "Adicionar Itens" na tela de detalhes do processo (quando status = "em_etp")
- [ ] Criar interface para gerenciar itens antes de gerar TR

#### Backend
- [x] Remover catmatItems do input da procedure processes.create
- [x] Remover chamada db.saveProcessItems da procedure processes.create
- [x] Criar procedure processes.addItemsToTR para salvar itens na fase TR
- [x] Criar procedure processes.getProcessItems para buscar itens
- [x] Procedure processes.generateDocument já busca itens ao gerar TR

#### Fluxo Correto (Lei 14.133/21)
- [ ] 1. Criar processo (dados básicos, sem itens)
- [ ] 2. Gerar ETP (estudo preliminar, sem detalhamento de itens)
- [ ] 3. Adicionar itens CATMAT/CATSER (tela específica)
- [ ] 4. Gerar TR (inclui itens adicionados)
- [ ] 5. Gerar DFD (consolida ETP + TR)
- [ ] 6. Gerar Edital

### Renomear Módulo de Propostas
- [ ] Renomear AdminProposals.tsx para CommercialManagement.tsx
- [ ] Atualizar rota de /admin/propostas para /admin/comercial
- [ ] Atualizar labels e títulos para "Gestão Comercial"
- [ ] Atualizar menu de navegação


## 🔄 Renomear Módulo Propostas para Gestão Comercial
- [x] Renomear arquivo proposalRouter.ts para commercialRouter.ts
- [x] Atualizar import no server/routers.ts
- [x] Renomear página AdminProposals.tsx para CommercialManagement.tsx
- [x] Atualizar rota de /admin/propostas para /gestao-comercial
- [x] Atualizar labels e títulos na interface

## 📊 Importação de Itens CATMAT/CATSER - Fase 1 (MVP)
### Backend
- [x] Instalar biblioteca xlsx para parsing de Excel/CSV
- [x] Criar procedure processes.parseItemsFile (recebe arquivo, retorna array de itens)
- [x] Adicionar validações (máximo 500 itens, descrição mínimo 10 caracteres)
- [x] Adicionar modo previewOnly para retornar primeiras 6 linhas
- [ ] Criar procedure processes.matchCatmatSimple (busca por palavras-chave) - Fase 2

### Frontend
- [x] Criar componente ImportItemsModal
- [x] Implementar drag & drop de arquivo
- [x] Preview da planilha (primeiras 5 linhas)
- [x] Mapeamento de colunas (dropdown)
- [x] Tabela de revisão de itens
- [x] Integrar no TRItemsModal (aba "Importar" + aba "Buscar Manual")
- [x] Manter busca manual funcionando

### Testes
- [ ] Testar importação de Excel (.xlsx)
- [ ] Testar importação de CSV (.csv)
- [ ] Testar validações (arquivo grande, muitos itens)
- [ ] Testar busca manual ainda funciona


## 🤖 Sistema RAG + Melhorias de IA (Próxima Implementação)

### Fase 1: Sistema RAG com Lei 14.133/21
- [x] Criar tabela law_chunks no banco de dados
- [x] Criar serviço de embeddings (server/services/embeddings.ts)
- [x] Criar script de indexação da Lei (server/scripts/indexLaw14133.mjs)
- [x] Adicionar arquivo data/lei_14133_2021.txt com texto completo da Lei
- [x] Executar indexação (node server/scripts/indexLaw14133.mjs) - 91 chunks indexados
- [x] Criar serviço de RAG (server/services/rag.ts)
- [x] Integrar RAG nas funções de geração (generateETP, generateTR, generateDFD, generateEdital)
- [ ] Testar se documentos gerados citam artigos específicos da Lei

### Fase 2: Matching Inteligente CATMAT com IA
- [x] Criar tabela catmat_suggestions no banco de dados
- [x] Criar função findCatmatMatches (server/services/catmatMatcher.ts)
- [x] Criar procedure generateCatmatSuggestions
- [x] Criar procedure getCatmatSuggestions
- [x] Criar procedure approveCatmatSuggestion
- [x] Criar procedure rejectCatmatSuggestion
- [x] Criar funções de banco de dados (createCatmatSuggestion, etc.)
- [ ] Criar componente CatmatSuggestionsModal (UI)
- [ ] Integrar modal no fluxo de processos (UI)
- [ ] Testar geração de sugestões para 10 itens
- [ ] Validar scores de confiança (≥ 70%)

### Fase 3: Edição de Itens Importados
- [x] Criar procedure updateProcessItem
- [x] Criar procedure deleteProcessItem
- [x] Adicionar funções updateProcessItem e deleteProcessItem no db.ts
- [ ] Criar componente EditItemDialog (UI)
- [ ] Integrar edição no TRItemsModal (botões Editar/Deletar) (UI)
- [ ] Testar edição de item (descrição, quantidade, unidade, código CATMAT)
- [ ] Testar deleção de item com confirmação

### Fase 4: Testes Completos
- [x] Validar servidor funcionando corretamente
- [x] Validar banco de dados com 91 chunks da Lei indexados
- [x] Validar procedures tRPC criadas e funcionais
- [ ] Criar arquivo de teste test_items.xlsx (10 itens) - Opcional para usuário
- [ ] Testar fluxo completo: Criar processo → Gerar ETP → Importar planilha - Pronto para uso
- [ ] Testar geração de sugestões CATMAT - Backend pronto
- [ ] Testar aprovação/rejeição de sugestões - Backend pronto
- [ ] Testar edição manual de itens - Backend pronto
- [ ] Testar deleção de itens - Backend pronto
- [ ] Validar performance (< 5s por item no matching) - Depende de testes reais
- [ ] Validar qualidade dos documentos gerados com RAG - Pronto para uso

### Documentação
- [x] Criar PLANO_IMPLEMENTACAO_RAG.md com detalhes técnicos completos
- [ ] Atualizar README.md com novas funcionalidades
- [ ] Documentar custos estimados de IA
- [ ] Criar guia de uso para usuários finais


## 🎨 Melhorias de UI e Dashboard (Nova Implementação)

### UI de Sugestões CATMAT
- [x] Criar componente CatmatSuggestionsModal.tsx
- [x] Integrar modal no fluxo de importação de itens
- [x] Adicionar botões Aprovar/Rejeitar para cada sugestão
- [x] Exibir score de confiança e justificativa técnica
- [x] Implementar loading states durante geração de sugestões
- [x] Adicionar botão "Sugerir Código" na tabela de itens sem código

### Edição Inline de Itens
- [x] Criar componente EditItemDialog.tsx
- [x] Adicionar colunas "Ações" na tabela de itens do TRItemsModal
- [x] Implementar botão "Editar" com ícone de lápis
- [x] Implementar botão "Deletar" com confirmação
- [x] Adicionar validações de formulário (descrição mínima, quantidade > 0)
- [x] Implementar feedback visual após edição/deleção

### Dashboard de Custos de IA (Admin - Implementação Completa)
- [x] Criar tabela aiUsageTracking no banco de dados
- [x] Criar funções de banco (getAIUsageStats, getAIUsageHistory, exportAIUsageCSV)
- [x] Criar procedures tRPC (aiUsage.getStats, aiUsage.getHistory, aiUsage.exportCSV)
- [x] Criar página AIUsageDashboard.tsx com:
  - [x] Cards de métricas (custo hoje, mês, total, operações/dia)
  - [x] Gráfico de linha: evolução de custos (últimos 30 dias)
  - [x] Gráfico de pizza: distribuição por tipo de operação
  - [x] Tabela detalhada com filtros (tipo, período, usuário)
  - [x] Botão exportar CSV
- [x] Criar helper centralizado de rastreamento (aiUsageTracker.ts)
- [x] Integrar rastreamento em findCatmatMatches (catmatMatcher.ts)
- [ ] Integrar rastreamento em geração de documentos (requer refatoração)
  - [ ] Adicionar userId e processId como parâmetros em generateETP/TR/DFD/Edital
  - [ ] Chamar trackDocumentGeneration após cada geração
- [x] Adicionar rota protegida /admin/ai-costs no App.tsx
- [x] Middleware adminProcedure já existe e foi usado nas procedures

## 📚 Expansão do Sistema RAG

### Suporte a Múltiplos Documentos
- [x] Modificar retrieveRelevantLaw para suportar filtro por documentos
- [x] Criar script genérico de indexação (indexDocument.mjs)
- [x] Criar guia completo de uso (GUIA_RAG_MULTIPLOS_DOCUMENTOS.md)
- [ ] Criar procedure admin para upload de novos documentos (UI)
- [ ] Implementar UI de gerenciamento de documentos (admin)

### Documentos para Indexação no RAG
- [x] Lei 8.666/93 (Lei de Licitações anterior - referência) - 520 chunks
- [x] Decreto 11.462/2023 (Regulamenta Lei 14.133/21) - 101 chunks
- [x] IN SEGES/ME nº 65/2021 (Instrução Normativa de Contratações) - 34 chunks
- [x] Lei Complementar 123/2006 (Estatuto da ME/EPP) - 749 chunks
- [x] Manual de Licitações e Contratos do TCU - 6581 chunks
- [x] Manual de Licitações e Contratos do TCE Paraná - 1116 chunks


## 🔧 Correções e Melhorias

### Formato de Embeddings no RAG
- [x] Corrigir script indexLaw.ts para salvar embeddings como JSON válido no MySQL
- [x] Limpar chunks antigos do banco de dados (9.192 chunks deletados)
- [x] Reindexar todos os 6 documentos com formato correto - CONCLUÍDA (9.782 chunks)
- [x] Testar RAG após reindexação para validar citações - FUNCIONANDO (scores 69-72%)

### Cache de Embeddings
- [x] Criar tabela embedding_cache no banco de dados
- [x] Implementar função de cache em embeddings.ts
- [x] Adicionar lógica de cache em generateEmbedding
- [ ] Testar redução de custos com queries repetidas (aguardar 7 dias de uso)

## Fase 11 - Sistema de Adaptação Inteligente de Editais por Plataforma

### Nível 1: Templates por Plataforma
- [x] Criar tabela platforms no banco de dados (id, name, slug, description, isActive, config JSON)
- [x] Criar tabela platform_templates no banco de dados (id, platformId, documentType, templateContent, metadata JSON)
- [x] Adicionar campo platformId na tabela processes
- [x] Criar seed inicial com 5 plataformas (Compras.gov.br, BLL, Licitanet, BBMnet, Outra)
- [x] Implementar funções de banco: getPlatforms, getPlatformById, getPlatformTemplates
- [x] Criar procedures tRPC: platforms.list, platforms.getById, platforms.getTemplates
- [x] Criar sistema de templates específicos por plataforma (nomenclaturas, formatação, anexos)
- [x] Integrar templates com sistema RAG para citações legais contextualizadas
- [x] Adicionar campo "Plataforma de Pregão" no formulário de novo processo
- [x] Modificar generateETP para aplicar template da plataforma selecionada (TR, DFD, Edital pendentes)
- [ ] Modificar generateTR para aplicar formatação específica da plataforma (assinatura adicionada, integração pendente)
- [ ] Modificar generateDFD para incluir instruções da plataforma (pendente)
- [ ] Modificar generateEdital para aplicar template da plataforma selecionada (pendente)
- [x] Criar biblioteca de cláusulas obrigatórias por plataforma (em platformTemplates.ts)

### Nível 2: Exportação Automatizada + Checklist
- [x] Criar tabela platform_checklists (id, platformId, step, description, fields JSON)
- [x] Implementar função generatePublicationPackage (procedure tRPC criada)
- [x] Criar componente PublicationPackageModal (botão "Preparar para Publicação")
- [x] Gerar planilha de itens CATMAT/CATSER no formato da plataforma (.XLSX) - estrutura preparada
- [x] Criar checklist interativo específico por plataforma
- [x] Implementar sistema de cópia automática de campos (click to copy)
- [x] Adicionar botões de download individual por documento no pacote
- [x] Criar preview do checklist antes de gerar pacote (integrado no modal)
- [ ] Implementar exportação do checklist em PDF (pendente)
- [ ] Adicionar instruções visuais (screenshots) no checklist (pendente)
- [ ] Popular tabela platform_checklists com checklists reais das 5 plataformas

### Nível 3: Preparação para Integração API (Futuro)
- [ ] Criar tabela platform_api_configs (id, platformId, apiUrl, authType, credentials, isActive)
- [ ] Criar interface abstrata IPlatformConnector para padronizar integrações
- [ ] Implementar ComprasGovConnector (estrutura preparada, sem implementação)
- [ ] Implementar BLLConnector (estrutura preparada, sem implementação)
- [ ] Implementar LicitanetConnector (estrutura preparada, sem implementação)
- [ ] Implementar BBMnetConnector (estrutura preparada, sem implementação)
- [ ] Criar tabela platform_publications (id, processId, platformId, externalId, status, publishedAt)
- [ ] Criar procedure tRPC: platforms.publish (preparada para futuro)
- [ ] Criar componente PublishToPlatformModal (UI preparada, botão desabilitado)
- [ ] Adicionar dashboard unificado de pregões publicados (estrutura preparada)
- [ ] Preparar sistema de webhooks para receber notificações das plataformas
- [ ] Criar tabela platform_notifications (id, publicationId, type, message, receivedAt)

### Funcionalidades Extras
- [ ] Criar comparador de plataformas (sugere melhor plataforma baseado em critérios)
- [ ] Implementar simulador de custos de publicação por plataforma
- [ ] Criar importador de pregões anteriores de outras plataformas
- [ ] Implementar versionamento de templates (quando plataforma atualiza requisitos)
- [ ] Adicionar sistema de notificações quando plataforma atualiza requisitos
- [ ] Criar página admin para gerenciar plataformas e templates
- [ ] Implementar analytics: qual plataforma é mais usada pelos clientes


## Fase 12 - Completar Sistema de Plataformas (Próximos Passos)

### Checklists Detalhados
- [x] Criar script de seed para popular platform_checklists
- [x] Adicionar checklist completo do Compras.gov.br (12 passos)
- [x] Adicionar checklist completo do BLL Compras (9 passos)
- [x] Adicionar checklist completo do Licitanet (8 passos)
- [x] Adicionar checklist completo do BBMNet (8 passos)
- [x] Adicionar checklist genérico para "Outra Plataforma" (5 passos)

### Integração de Templates
- [x] Adicionar platformInstructions em generateTR (buscar + injetar no prompt)
- [x] Adicionar platformInstructions em generateDFD (buscar + injetar no prompt)
- [x] Adicionar platformInstructions em generateEdital (buscar + injetar no prompt)
- [x] Atualizar chamadas de generateTR/DFD/Edital para passar platformId

### Exportação em Lote
- [x] Criar serviço de geração de planilha XLSX (excelService.ts)
- [x] Implementar função generateItemsSpreadsheet (formatar por plataforma)
- [x] Criar serviço de geração de ZIP (zipService.ts)
- [x] Implementar procedure tRPC: downloads.publicationPackage e downloads.itemsSpreadsheet
- [x] Adicionar botão "Baixar Todos (.ZIP)" funcional no modal

### Integração UI
- [x] Adicionar botão "Preparar para Publicação" na página ProcessDetails
- [x] Integrar modal PublicationPackageModal com download funcional
- [x] Adicionar loading state no botão de download
- [x] Sistema de cópia de campos implementado no checklist


## Fase 13 - Melhorias UX do Sistema de Plataformas

### Badge de Plataforma no Dashboard
- [x] Adicionar query de plataforma no card do processo (join em getProcessesByUser e getProcessById)
- [x] Integrar badge nos cards do dashboard
- [ ] Adicionar tooltip com informações da plataforma (pendente)

### Exportação de Checklist em PDF
- [x] Criar serviço pdfChecklistService.ts
- [x] Implementar função generateChecklistPDF
- [x] Adicionar procedure tRPC: downloads.checklistPDF
- [x] Adicionar botão "Exportar Checklist (PDF)" no modal
- [x] Incluir cabeçalho, resumo, instruções e rodapé no PDF

### Interface Administrativa
- [x] Criar página /admin/platforms
- [x] Criar dialog TemplateInstructionsDialog (estrutura básica)
- [x] Criar dialog ChecklistEditorDialog (estrutura básica)
- [x] Restringir acesso apenas para admins
- [ ] Implementar mutation de save de instruções (pendente)
- [ ] Implementar CRUD completo de checklists (pendente)
- [ ] Adicionar preview em tempo real das mudanças (pendente)
- [ ] Adicionar versionamento de templates (pendente)


## Fase 14 - Completar Interface Administrativa

### Tooltip no Badge de Plataforma
- [x] Adicionar Tooltip component no badge do dashboard
- [x] Mostrar nome completo, descrição e website da plataforma
- [x] Cursor help indicando informações adicionais

### Save de Instruções de Templates
- [x] Usar campo config (JSON) da tabela platforms existente
- [x] Criar função updatePlatformInstructions no db.ts
- [x] Criar procedure tRPC: platforms.updateInstructions
- [x] Implementar mutation no TemplateInstructionsDialog
- [x] Adicionar loading state e feedback de sucesso/erro
- [x] Carregar instruções atuais com useEffect

### CRUD de Checklists
- [x] Criar função createChecklistStep no db.ts
- [x] Criar função updateChecklistStep no db.ts
- [x] Criar função deleteChecklistStep no db.ts
- [x] Criar procedures tRPC: platforms.createChecklistStep, updateChecklistStep, deleteChecklistStep
- [x] Implementar dialog de adicionar novo passo (AddStepDialog)
- [x] Implementar dialog de editar passo existente (EditStepDialog)
- [x] Implementar confirmação de exclusão (AlertDialog)
- [ ] Adicionar reordenação de passos (drag and drop ou up/down buttons) - pendente
- [x] Invalidar queries após mutations para atualizar UI


## Fase 15 - Melhorias Finais da Interface Administrativa

### getPlatformInstructions Dinâmico
- [x] Modificar getPlatformInstructions para buscar instruções do campo config do banco
- [x] Manter fallback para instruções estáticas se config estiver vazio (PLATFORM_INSTRUCTIONS_FALLBACK)
- [x] Sistema de prioridade: 1) config.instructions do banco, 2) fallback estático

### Reordenação de Passos
- [x] Adicionar função reorderChecklistStep no db.ts (swap de stepNumber)
- [x] Criar procedure tRPC: platforms.reorderChecklistStep
- [x] Adicionar botões ↑ (ChevronUp) e ↓ (ChevronDown) em cada passo
- [x] Implementar lógica de swap de stepNumber entre passos
- [x] Invalidar queries após reordenação
- [x] Disabled quando já é primeiro/último passo

### Preview de Mudanças
- [x] Criar componente PreviewDialog.tsx (TemplatePreviewDialog + ChecklistPreviewDialog)
- [x] Adicionar botão "Preview" (👁️ Eye) ao lado de Instruções
- [x] Mostrar instruções gerais + específicas (ETP, TR, DFD, Edital)
- [x] Adicionar botão "Preview" (👁️ Eye) ao lado de Checklist
- [x] Mostrar checklist formatado com resumo e agrupamento por categoria
- [x] Criar wrappers com queries para buscar dados


## Fase 16 - Melhorias Finais Antes de Contratação Direta

### Menu Lateral com Item Plataformas
- [x] Adicionar item "Plataformas" no menu lateral do DashboardLayout
- [x] Adicionar ícone Settings (⚙️)
- [x] Restringir visibilidade apenas para admins (filtro .filter)
- [x] Adicionar badge "Admin" ao lado do item

### Página de Logs de Publicação
- [x] Criar página /admin/publication-logs
- [x] Criar query tRPC platforms.listPublications (retorna [] por enquanto)
- [x] Implementar filtros por plataforma e status
- [x] Criar tabela com colunas: Data, Processo, Plataforma, Status, ID Externo, Ações
- [ ] Adicionar paginação (pendente)
- [x] Adicionar botão "Ver Processo" por publicação
- [x] Preparar estrutura para Nível 3 (TODO marcado no código)

### Exportação de Relatório em PDF
- [x] Criar serviço processReportService.ts
- [x] Incluir no relatório: dados do processo, objeto, justificativa, documentos gerados, organização, checklist
- [x] Adicionar botão "Exportar Relatório" na página ProcessDetails
- [x] Criar procedure tRPC: downloads.processReport
- [x] Implementar download automático do PDF (base64 -> blob -> download)
- [x] Formatação profissional em Markdown convertido para PDF


## Módulo Contratação Direta

### Fase 1 - Infraestrutura e Schema
- [x] Criar tabela direct_contracts (contratações diretas)
- [x] Criar tabela direct_contract_legal_articles (artigos legais)
- [x] Criar tabela direct_contract_documents (documentos específicos)
- [x] Criar tabela direct_contract_quotations (cotações de preço)
- [x] Adicionar seed de artigos legais (Art. 74 e 75 da Lei 14.133) - 10 artigos populados
- [ ] Atualizar schema de processes para suportar tipo "dispensa" e "inexigibilidade" (não necessário, tabela separada)

### Fase 2 - Backend
- [x] Criar funções de banco: createDirectContract, getDirectContractById, listDirectContracts
- [x] Criar funções de banco: getLegalArticles, getLegalArticleById
- [x] Criar funções de banco: createQuotation, listQuotations
- [x] Criar router directContractsRouter com procedures básicas
- [x] Criar procedure: directContracts.create
- [x] Criar procedure: directContracts.list
- [x] Criar procedure: directContracts.getById
- [x] Criar procedure: directContracts.legalArticles.list
- [x] Registrar directContractsRouter no appRouter

### Fase 3 - Assistente de Enquadramento Legal (IA)
- [x] Criar serviço legalFrameworkAssistant.ts
- [x] Implementar função suggestLegalArticle (IA analisa situação e sugere artigo)
- [x] Implementar função generateJustification (IA gera justificativa inicial)
- [x] Implementar função validateValue (verifica limites legais)
- [x] Criar procedure: directContracts.assistant.suggestArticle
- [x] Criar procedure: directContracts.assistant.generateJustification
- [x] Criar procedure: directContracts.assistant.validateValue

#### Fase 4 - Geração de Documentos Específicos
- [x] Criar serviço directContractDocuments.ts
- [x] Implementar função generateTermoDispensa (Termo de Dispensa)
- [x] Implementar função generateTermoInexigibilidade (Termo de Inexigibilidade)
- [x] Implementar função generateMinutaContrato (Minuta de Contrato)
- [x] Implementar função generatePlanilhaCotacao (Planilha de Cotação)
- [x] Implementar função generateMapaComparativo (Mapa Comparativo de Preços)
- [x] Criar procedures: directContracts.generate.termoDispensa, termoInexigibilidade, minutaContrato, planilhaCotacao, mapaComparativoa cada tipo de documento

### Fase 5 - UI: Formulário e Dashboard
- [ ] Criar página NewDirectContract.tsx (formulário wizard de 4 passos)
- [ ] Passo 1: Enquadramento Legal (tipo, artigo, assistente IA)
- [ ] Passo 2: Dados da Contratação (objeto, justificativa, valor, prazo)
- [ ] Passo 3: Fornecedor (se conhecido - inexigibilidade)
- [ ] Passo 4: Documentação (quais documentos gerar, modo presencial/eletrônico)
- [ ] Criar página DirectContractsList.tsx (dashboard de contratações diretas)
- [ ] Criar página DirectContractDetails.tsx (detalhes da contratação)
- [ ] Adicionar filtros: Tipo, Artigo Legal, Valor, Status
- [ ] Adicionar rota /direct-contracts no App.tsx
- [ ] Adicionar item "Contratações Diretas" no menu lateral

### Fase 6 - Modo Presencial
- [ ] Criar serviço directContractPresencial.ts
- [ ] Implementar função generateEmailTemplate (template de email para fornecedores)
- [ ] Implementar função generatePresencialPackage (ZIP com documentos)
- [ ] Criar componente PresencialModeDialog
- [ ] Adicionar botão "Gerar Pacote Presencial" no DirectContractDetails
- [ ] Implementar upload de propostas recebidas
- [ ] Criar tabela comparativa de propostas
- [ ] Implementar geração de Mapa Comparativo

### Fase 7 - Integração com Plataformas
- [ ] Adaptar platformTemplates.ts para contratação direta
- [ ] Adicionar instruções específicas para dispensa/inexigibilidade por plataforma
- [ ] Criar checklists de publicação para contratação direta
- [ ] Integrar PublicationPackageModal com contratação direta
- [ ] Testar exportação de documentos por plataforma

### Fase 8 - Testes e Refinamentos
- [ ] Testar fluxo completo: Dispensa presencial
- [ ] Testar fluxo completo: Dispensa eletrônica
- [ ] Testar fluxo completo: Inexigibilidade presencial
- [ ] Testar fluxo completo: Inexigibilidade eletrônica
- [ ] Testar assistente de enquadramento legal
- [ ] Testar geração de todos os documentos
- [ ] Testar integração com plataformas
- [ ] Salvar checkpoint final


## Módulo Contratação Direta - Melhorias Avançadas

### Fase 7: Integração com Plataformas
- [x] Adicionar campo "plataforma" no schema (comprasnet, bll, pncp, nenhuma) - já existia
- [x] Criar tabela de checklists por plataforma - reutilizada tabela existente
- [x] Popular checklists específicos (ComprasNet, BLL, PNCP) - seed executado
- [x] Criar funções de banco (listPlatforms, getPlatformById, getPlatformChecklists)
- [x] Criar procedures tRPC (platforms.list, platforms.getById, platforms.getChecklists)
- [x] Adicionar seletor de plataforma no formulário de nova contratação - já existia
- [x] Exibir checklist específico na página de detalhes - ChecklistTab criado
- [ ] Criar serviço de adaptação de documentos por plataforma
- [ ] Validar campos obrigatórios por plataforma
- [ ] Gerar documentos adaptados conforme plataforma selecionada

### Fase 8: Validação de Documentos
- [x] Criar serviço de validação de CNPJ (API Receita Federal) - cnpjValidator.ts
- [x] Adicionar procedures tRPC (validateCNPJ, consultCNPJ)
- [x] Adicionar validação de CNPJ no formulário de fornecedor - botão Validar
- [x] Feedback visual (borda verde/vermelha) e preenchimento automático
- [ ] Criar checklist de documentos obrigatórios
- [ ] Adicionar upload de certidões negativas
- [ ] Validar certidões (Federal, Estadual, Municipal, FGTS, Trabalhista)
- [ ] Exibir status de validação na página de detalhes
- [ ] Bloquear geração de pacote se documentos inválidos
- [ ] Adicionar alertas de documentos vencidos

### Fase 9: Sistema de Histórico e Auditoria
- [x] Criar tabela de auditoria (direct_contract_audit_logs)
- [x] Criar funções de banco (createDirectContractAuditLog, getDirectContractAuditLogs, getDirectContractAuditLogsByAction)
- [x] Criar procedures tRPC (audit.getLogs, audit.getLogsByAction)
- [x] Registrar ações principais (criar, gerar documento, adicionar cotação)
- [x] Criar componente AuditTimeline com ícones e badges
- [x] Exibir timeline na página de detalhes (aba "Histórico")
- [x] Adicionar filtros na timeline (tipo de ação)
- [ ] Adicionar mais registros de auditoria (editar, deletar cotação, gerar pacote)
- [ ] Criar procedure para exportar relatório de auditoria
- [ ] Gerar PDF de relatório de auditoria
- [ ] Adicionar botão "Exportar Auditoria" na página de detalhes


### Fase 10: Completar Auditoria e Persistir Checklist
- [x] Adicionar auditoria na mutation de editar contratação (update)
- [x] Adicionar auditoria na mutation de gerar pacote presencial
- [x] Criar tabela direct_contract_checklist_progress
- [x] Criar funções de banco (saveChecklistProgress, getChecklistProgress, deleteChecklistProgress)
- [x] Criar procedures tRPC (checklist.saveProgress, checklist.getProgress)
- [x] Atualizar componente ChecklistTab para salvar estado (update otimista + rollback)
- [x] Carregar estado do checklist ao abrir página (useEffect)
- [x] Adicionar auditoria automática ao marcar checklist

### Fase 11: Exportação de Relatório de Auditoria
- [x] Criar serviço de geração de PDF de auditoria (directContractAuditReport.ts)
- [x] Instalar dependência pdfkit e @types/pdfkit
- [x] Criar procedure tRPC (audit.exportReport)
- [x] Adicionar botão "Exportar PDF" na aba Histórico
- [x] Formatar PDF com timeline completa (cabeçalho, informações, timeline, rodapé)
- [x] Adicionar estatísticas por tipo de ação e usuário
- [x] Incluir filtros aplicados no relatório
- [x] Registrar auditoria ao exportar relatório
- [x] Download automático do PDF no frontend


### Fase 12: Dashboard de Estatísticas e Analytics
- [x] Criar funções de banco para buscar estatísticas agregadas (5 funções)
- [x] Criar procedures tRPC (analytics.getOverview, analytics.getCharts, analytics.getTopSuppliers, analytics.getTopArticles, analytics.getRecent)
- [x] Instalar dependência recharts para gráficos
- [x] Criar página DirectContractsAnalytics.tsx
- [x] Implementar cards de métricas principais (total, valor, tempo médio, taxa de aprovação)
- [x] Implementar gráfico de linhas (dispensas vs inexigibilidades por mês)
- [x] Implementar gráfico de barras (valor por plataforma)
- [x] Implementar gráfico de pizza (distribuição por status)
- [x] Implementar gráfico de área (evolução mensal total)
- [x] Implementar tabela de top 5 fornecedores (com valor total e quantidade)
- [x] Implementar tabela de top 5 artigos legais (com descrição e usos)
- [x] Adicionar rota no App.tsx (/direct-contracts/analytics)
- [x] Adicionar botão "Analytics" no dashboard principal


## Módulo de Contratos

### Fase 1: Schema de Banco de Dados
- [x] Criar tabela `contracts` (25 campos: número, objeto, contratado, valor, vigência, status, renovação)
- [x] Criar tabela `contract_amendments` (15 campos: aditivos de prazo, valor, escopo)
- [x] Criar tabela `contract_apostilles` (14 campos: apostilamentos, reajustes, correções)
- [x] Criar tabela `contract_documents` (10 campos: documentos gerados)
- [x] Criar tabela `contract_audit_logs` (7 campos: auditoria completa)
- [x] Aplicar mudanças no banco (pnpm db:push) - 5 tabelas criadas

### Fase 2: Backend - Procedures tRPC e Funções de Banco
- [x] Criar funções de banco (createContract, getContractById, listContracts, updateContract)
- [x] Criar funções de aditivos (createAmendment, listAmendments)
- [x] Criar funções de apostilamentos (createApostille, listApostilles)
- [x] Criar funções de documentos (createContractDocument, listContractDocuments, updateContractDocument)
- [x] Criar funções de auditoria (createContractAuditLog, getContractAuditLogs, getContractAuditLogsByAction)
- [x] Criar funções de estatísticas (getContractsOverview, getRecentContracts)
- [x] Criar router de contratos (contractsRouter.ts) - 15 procedures
- [x] Criar procedures tRPC (contracts.create, contracts.list, contracts.getById, contracts.update)
- [x] Criar procedures de aditivos (amendments.create, amendments.list)
- [x] Criar procedures de apostilamentos (apostilles.create, apostilles.list)
- [x] Criar procedures de documentos (documents.create, documents.list, documents.update)
- [x] Criar procedures de auditoria (audit.getLogs, audit.getLogsByAction)
- [x] Criar procedures de estatísticas (analytics.getOverview, analytics.getRecent)
- [x] Registrar router no routers.ts principal

### Fase 3: Geração de Documentos
- [x] Criar serviço de geração de Minuta de Contrato (Lei 14.133/2021, 11 cláusulas)
- [x] Criar serviço de geração de Termo de Aditivo (prazo, valor, escopo, misto)
- [x] Criar serviço de geração de Termo de Apostilamento (reajuste, correção, designação)
- [x] Criar serviço de geração de Termo de Rescisão (unilateral, bilateral, judicial)
- [x] Criar procedures tRPC para gerar documentos (4 procedures: generateMinuta, generateAmendment, generateApostille, generateRescission)
- [x] Integrar geração com auditoria automática
- [x] Salvar documentos no banco de dados
- [x] Conectar botões de geração aos handlers
- [x] Implementar download automático de Markdown
- [x] Criar modal de rescisão com formulário completo

### Fase 4: UI - Formulário e Dashboard
- [x] Criar página Contracts.tsx (dashboard com filtros e cards de estatísticas)
- [x] Criar página NewContract.tsx (formulário wizard com 3 passos)
- [x] Implementar filtros (status, tipo, ano, vencimento)
- [x] Implementar cards de estatísticas (ativos, vencidos, a vencer)
- [x] Adicionar rotas no App.tsx

### Fase 5: Página de Detalhes e Gestão de Aditivos
- [x] Criar página ContractDetails.tsx (3 abas: visão geral, aditivos, documentos)
- [x] Implementar aba de visão geral (dados do contrato, contratado, vigência)
- [x] Implementar aba de aditivos (lista + formulário de novo aditivo)
- [x] Implementar aba de apostilamentos (lista + formulário de novo apostilamento)
- [x] Implementar aba de documentos (lista + botões de geração)
- [x] Implementar timeline de eventos

### Fase 6: Sistema de Alertas
- [x] Criar função de cálculo de dias até vencimento
- [x] Implementar badges de alerta (vencido, vence em 30/60/90 dias)
- [x] Criar página ContractAlerts.tsx com filtros e estatísticas
- [x] Adicionar botão "Alertas" no dashboard de Contratos com badge de contagem
- [x] Adicionar badge de alerta no card de Contratos no dashboard principal
- [ ] Criar sistema de notificações automáticas (notifyOwner) - pendente

### Fase 7: Integração com Outros Módulos
- [x] Adicionar botão "Gerar Contrato" em ProcessDetails.tsx
- [x] Adicionar botão "Gerar Contrato" em DirectContractDetails.tsx
- [x] Implementar pré-preenchimento automático via query params
- [x] Preencher dados automaticamente a partir do processo/contratação

### Fase 8: Auditoria e Relatórios
- [x] Criar tabela de auditoria (contract_audit_logs)
- [x] Registrar todas as ações (criar, editar, adicionar aditivo, gerar documento)
- [x] Adicionar aba "Histórico" na página de detalhes
- [ ] Criar componente ContractAuditTimeline - pendente
- [ ] Implementar exportação de relatório de auditoria em PDF - pendente

### Fase 9: Testes Finais
- [ ] Testar fluxo completo de criação de contrato
- [ ] Testar geração de todos os documentos
- [ ] Testar adição de aditivos e apostilamentos
- [ ] Testar sistema de alertas
- [ ] Testar integração com outros módulos
- [ ] Salvar checkpoint final

### Fase 10: Sistema de Notificações Automáticas
- [x] Criar função checkContractExpirations para verificar vencimentos
- [x] Implementar lógica de alertas (30, 60, 90 dias antes)
- [x] Integrar com notifyOwner para envio de notificações
- [x] Criar procedure tRPC para verificação manual
- [x] Adicionar botão "Verificar e Notificar" na página de Alertas
- [ ] Configurar job agendado (cron diário) - pendente

### Fase 11: Exportação de Relatórios
- [x] Implementar exportação de alertas em Excel
- [x] Implementar exportação de histórico de auditoria em Excel
- [x] Adicionar botão de exportação na página de Alertas
- [x] Adicionar botão de exportação na aba de Histórico
- [x] Criar procedures tRPC para exportação (exportAlertsExcel, exportAuditExcel)
- [x] Implementar download automático com conversão base64

### Fase 12: Validação de CNPJ Automática
- [x] Botão de validação de CNPJ no NewContract.tsx (já implementado)
- [x] Integração com procedure de consulta CNPJ (já existente)
- [x] Preenchimento automático de nome, endereço e contato (já funcional)
- [x] Feedback visual de validação (borda verde/vermelha)
- [x] Tratamento de erros completo
- [x] Fluxo completo de validação testado


### Fase 13: Completar Módulo de Gestão do Departamento
- [x] Implementar calendário funcional (renderizar tarefas nos dias)
- [x] Adicionar navegação entre meses no calendário
- [x] Implementar clique em tarefa no calendário para ver detalhes
- [x] Implementar relatório PDF (resumido: nome, status, prazo)
- [x] Implementar relatório Excel (completo: todos os campos)
- [x] Adicionar botões de exportação no header do DepartmentManagement
- [ ] Criar sistema de tags personalizadas (backend + frontend) - pendente
- [ ] Implementar filtro por tags - pendente
- [ ] Adicionar filtros avançados na exportação de relatórios - pendente


### Fase 14: Melhorias Finais do Módulo de Gestão
- [x] Criar componente TagManager para gerenciar tags personalizadas
- [x] Adicionar suporte a filtro por tags no backend
- [ ] Implementar CRUD de tags completo (criar, editar, deletar) - pendente
- [ ] Adicionar seletor de tags no formulário de tarefas - pendente
- [ ] Implementar filtro por tags em todas as visualizações - pendente
- [x] Criar serviço de notificações de prazo (taskNotifications.ts)
- [x] Implementar verificação automática de prazos (3 dias antes e atrasadas)
- [x] Integrar com notifyOwner para envio de alertas
- [x] Adicionar botão de verificação manual de prazos
- [x] Implementar filtros avançados de exportação (período, status, responsável, tags)
- [x] Atualizar procedures tRPC para aceitar filtros avançados
- [ ] Adicionar modal de configuração de filtros antes de exportar (UI) - pendente


### Fase 15: Melhorias na Landing Page
- [x] Substituir botão "Solicitar Proposta" do header por "Entrar no Sistema"
- [x] Ajustar estilo do botão de login para destaque (azul, primário)
- [x] Testar navegação e redirecionamento


### Fase 16: Melhorias Visuais na Landing Page
- [x] Remover botão "Acessar Sistema" duplicado (já existe no header)
- [x] Corrigir alinhamento do botão "Solicitar Proposta Comercial" (seta centralizada)
- [x] Adicionar gradientes sutis no hero section (blue-50 → white → indigo-50)
- [x] Adicionar gradientes hover nos botões (blue-600 → blue-700)
- [x] Adicionar gradientes em seções alternadas (gray-50, white, blue gradients)
- [x] Testar responsividade e legibilidade


### Fase 17: Melhorias Finais na Landing Page
- [x] Melhorar contraste dos cards (texto branco + overlay from-black/70)
- [x] Adicionar descrição dos cards sobre a imagem com drop-shadow
- [x] Implementar animações de scroll (fade-in e slide-up)
- [x] Criar hook useIntersectionObserver
- [x] Criar componente AnimatedSection com 4 tipos de animação
- [x] Aplicar animações nos cards de funcionalidades
- [x] Aplicar animações na seção "Como Funciona"
- [x] Criar formulário de contato inline (nome, email, órgão, telefone, mensagem)
- [x] Criar contactRouter com procedure submitContactForm
- [x] Integrar formulário antes do footer com handler de submit
- [x] Adicionar estado de loading e feedback com toasts
- [x] Integrar com notifyOwner para alertar proprietário


### Fase 18: Correções da Landing Page
- [x] Remover texto duplicado dos cards (removido overlay e texto sobre imagem)
- [x] Reverter overlay escuro dos cards (removido from-black/70)
- [x] Manter descrição apenas no CardContent abaixo da imagem
- [x] Limpar cache do TypeScript para resolver erro "1 error"
- [x] Testar landing page após correções


### Fase 19: Melhorar Contraste de Texto na Landing Page
- [x] Identificar texto cinza sobre fundo escuro (cards "Busca Inteligente" e "Gestão Completa")
- [x] Adicionar overlay escuro (from-black/60) apenas nesses cards
- [x] Alterar texto de text-gray-600 para text-white com drop-shadow
- [x] Posicionar texto sobre a imagem (absolute bottom-16)
- [x] Testar contraste e legibilidade


### Fase 20: Melhorias Finais do Sistema
- [x] Deletar linhas 29 e 307 do ProcessDetails.tsx (código comentado GlobalSearch)
- [x] Verificar se erros TypeScript foram resolvidos (cache limpo, erros eram antigos)
- [x] Favicon customizado já configurado (%VITE_APP_LOGO%)
- [x] Implementar Google Analytics GA4 no head (placeholder G-XXXXXXXXXX)
- [x] Testar todas as melhorias


### Fase 21: Ativar Google Analytics
- [x] Substituir G-XXXXXXXXXX por G-N0PT3PG3R1 no index.html
- [x] Google Analytics GA4 ativado e pronto para rastrear


### Fase 22: Meta Tags SEO para Redes Sociais
- [x] Adicionar Meta Tags Open Graph (og:title, og:description, og:image, og:url, og:type)
- [x] Adicionar Meta Tags Twitter Card (twitter:card, twitter:title, twitter:description, twitter:image)
- [x] Adicionar meta description padrão para SEO
- [ ] Testar preview em redes sociais


### Fase 23: Criar Imagem OG para Redes Sociais
- [x] Gerar imagem og-image.png (1200x630px) com IA
- [x] Salvar imagem em client/public/og-image.png
- [ ] Testar preview em redes sociais


### Fase 24: Correções de Alinhamento na Landing Page
- [x] Remover texto branco sobreposto nas imagens dos cards
- [x] Garantir que todo texto esteja legível (apenas no CardContent)
- [x] Corrigir altura do card 4 na seção "Como Funciona" (todos os cards devem ter mesma altura)
- [x] Gerar nova imagem realista para seção "Geração Automática com IA"
- [ ] Testar responsividade após correções


### Fase 25: Animações e Micro-interações na Landing Page
- [x] Adicionar animações de hover nos ícones (pulsar, bounce, rotate)
- [x] Melhorar hover effects nos cards (lift + sombra + scale)
- [x] Implementar efeito parallax sutil no hero section
- [x] Adicionar animação "breathing/pulse" no botão principal do hero
- [x] Criar linha do tempo visual animada na seção "Como Funciona"
- [x] Adicionar gradientes animados suaves no background
- [x] Testar todas as animações em diferentes navegadores


### Fase 26: Atualização Completa da Landing Page
- [x] Corrigir altura do card 2 (Geração Automática de Documentos)
- [x] Gerar imagem de fundo de prédios governamentais de Brasília
- [x] Gerar imagens mockup para 4 novas funcionalidades
- [x] Adicionar funcionalidade "Contratação Direta"
- [x] Adicionar funcionalidade "Gestão de Contratos"
- [x] Adicionar funcionalidade "Parecer Jurídico com IA"
- [x] Adicionar funcionalidade "Gestão do Departamento"
- [x] Aplicar background no hero section com parallax
- [x] Ajustar grid para acomodar 10 cards (3 colunas)
- [x] Testar responsividade e legibilidade


### Fase 27: Melhorias Visuais Hero e Seção Benefícios
- [x] Gerar novo mockup do laptop com fundo azul gradiente (integrado ao hero)
- [x] Substituir imagem hero-dashboard-mockup.png
- [x] Adicionar gradientes nos ícones de check da seção "Por que escolher"
- [x] Testar integração visual e contraste


### Fase 30: Atualizar Meta Tags com Domínio Personalizado
- [x] Substituir licigov-pro.manus.space por licigovpro.com.br nas meta tags OG
- [x] Atualizar og:url para https://licigovpro.com.br
- [x] Atualizar og:image para https://licigovpro.com.br/og-image.png
- [x] Testar preview em redes sociais


### Fase 31: Redesign Completo do Dashboard + Painel Admin
- [x] Gerar 5 imagens mockup realistas para cards do dashboard
- [x] Redesenhar ModuleSelectionDashboard.tsx com estilo profissional azul (matching landing page)
- [x] Substituir cores chapadas por gradientes sutis
- [x] Adicionar estatísticas/números em cada card
- [x] Implementar botão de alternância de tema (dark/light) no header
- [x] Painel administrativo já existe em /admin
- [x] Redesenhar Admin.tsx com visual profissional e estatísticas
- [x] Gestão de propostas comerciais já implementada
- [x] Gestão de documentos do sistema já implementada
- [x] Verificação de role admin já implementada
- [x] Botão "Painel Admin" no header (visível apenas para owner/admin)
- [x] Testar todas as funcionalidades


### Fase 32: Correções e Melhorias de UX
- [x] Corrigir erro no formulário "Novo Processo" (Select.Item sem value prop)
- [x] Pesquisar referências de dark mode em sites consolidados (GitHub, Vercel, Linear, Stripe)
- [x] Analisar paletas de cores dark mode de alta qualidade
- [x] Apresentar sugestões de dark mode para aprovação do usuário
- [x] Implementar modo dark aprovado com paleta profissional (Opção 3 - Híbrido Personalizado)
- [x] Adicionar botão "Voltar ao Dashboard" em todas as páginas internas
- [x] Testar navegação e dark mode em todas as páginas

### Fase 33: Correção do Dark Mode no Background Principal
- [x] Corrigir ModuleSelectionDashboard para usar bg-background ao invés de cores fixas
- [x] Substituir todas as cores fixas (gray-*, blue-*, white) por variáveis CSS do tema
- [x] Testar dark mode em todas as páginas principais (Home, Dashboard, Admin)
- [x] Verificar contraste e legibilidade em dark mode

### Fase 34: Melhorias de Tema e Correções de Navegação
- [x] Investigar e corrigir erro ao acessar card "Gestão de Contratos" (faltava import useAuth)
- [x] Adicionar campo `theme` (enum: 'light', 'dark', 'system') na tabela users
- [x] Criar procedures tRPC para salvar/carregar preferência de tema (auth.updateTheme)
- [x] Implementar sincronização de tema com banco de dados (ThemeContext atualizado)
- [x] Adicionar transição suave (300ms ease-in-out) no ThemeContext
- [x] Implementar atalho de teclado (Ctrl/Cmd + Shift + D) para alternar tema
- [x] Identificar páginas sem botão voltar e adicionar BackToDashboard
- [x] Testar navegação em todas as páginas principais
- [x] Testar alternância de tema e sincronização entre dispositivos

### Fase 35: Correção da Navegação do Botão Voltar
- [x] Atualizar BackToDashboard para usar window.history.back() ao invés de navigate("/dashboard")
- [x] Implementar lógica inteligente: voltar histórico se houver, senão ir para dashboard
- [x] Testar fluxo: Dashboard → Módulo → Funcionalidade → Voltar (deve ir para Módulo)
- [x] Verificar que não quebra navegação em páginas sem histórico
- [x] Alterar texto do botão de "Voltar ao Dashboard" para "Voltar"

### Fase 36: Breadcrumbs, Atalhos de Teclado e Indicadores de Navegação
- [x] Criar componente Breadcrumbs reutilizável com suporte a rotas dinâmicas
- [x] Implementar atalho ESC para voltar à página anterior
- [x] Implementar atalho Ctrl+Home para ir ao dashboard
- [x] Criar hook useKeyboardNavigation para atalhos globais
- [x] Integrar useKeyboardNavigation no App.tsx
- [x] Integrar breadcrumbs em NewProcess.tsx
- [x] Adicionar imports de Breadcrumbs em 6 páginas principais
- [x] Verificar acessibilidade dos breadcrumbs (aria-label="Breadcrumb")

### Fase 37: Breadcrumbs JSX, Tooltip de Atalhos e Histórico de Navegação
- [x] Adicionar breadcrumbs JSX em Contracts.tsx
- [x] Adicionar breadcrumbs JSX em NewContract.tsx
- [x] Adicionar breadcrumbs JSX em ContractDetails.tsx
- [x] Adicionar breadcrumbs JSX em DirectContracts.tsx
- [x] Adicionar breadcrumbs JSX em NewDirectContract.tsx
- [x] Adicionar breadcrumbs JSX em ProcessDetails.tsx
- [x] Adicionar breadcrumbs JSX em NewProcess.tsx (já estava pronto)
- [x] Criar componente KeyboardShortcutsTooltip com lista de atalhos
- [x] Implementar lógica de exibição no primeiro acesso (localStorage)
- [x] Integrar KeyboardShortcutsTooltip no App.tsx
- [x] Criar hook useNavigationHistory para rastrear últimas 5 páginas
- [x] Adicionar menu dropdown de histórico no header do ModuleSelectionDashboard
- [x] Testar breadcrumbs em todas as páginas
- [x] Testar tooltip e histórico de navegação

### Fase 38: Módulo Parecer Jurídico com IA
- [ ] Criar tabela legalOpinions no schema.ts
- [ ] Aplicar migração no banco (pnpm db:push)
- [ ] Criar funções de DB em db.ts (createLegalOpinion, getLegalOpinions, etc)
- [ ] Criar router legalOpinions em routers.ts com procedures CRUD
- [ ] Implementar geração de parecer com IA usando invokeLLM
- [ ] Criar página LegalOpinions.tsx (listagem com filtros)
- [ ] Criar página NewLegalOpinion.tsx (formulário de solicitação)
- [ ] Criar página LegalOpinionDetails.tsx (visualização e edição)
- [ ] Adicionar rotas no App.tsx
- [ ] Atualizar card do módulo no ModuleSelectionDashboard
- [ ] Testar geração de parecer e CRUD completo

### Fase 38: Módulo Parecer Jurídico com IA (Implementação Completa)
- [x] Criar tabela legalOpinions no schema.ts
- [x] Aplicar migração no banco (pnpm db:push)
- [x] Criar funções de DB em db.ts (createLegalOpinion, getLegalOpinions, etc)
- [x] Criar router legalOpinionsRouter.ts com procedures CRUD
- [x] Registrar legalOpinionsRouter no appRouter
- [x] Implementar geração de parecer com IA usando invokeLLM (legalOpinionService.ts)
- [x] Criar página LegalOpinions.tsx (listagem com filtros)
- [x] Criar página NewLegalOpinion.tsx (formulário de solicitação)
- [x] Criar página LegalOpinionDetails.tsx (visualização e edição)
- [x] Adicionar rotas no App.tsx (/parecer-juridico, /parecer-juridico/novo, /parecer-juridico/:id)
- [x] Atualizar card do módulo no ModuleSelectionDashboard (available: true)
- [x] Testar geração de parecer e CRUD completo

### Fase 39: Integração e Melhorias do Módulo Parecer Jurídico
- [x] Adicionar botão "Solicitar Parecer" em ProcessDetails.tsx
- [x] Adicionar botão "Solicitar Parecer" em DirectContractDetails.tsx
- [x] Atualizar NewLegalOpinion para pré-preencher contexto via query params
- [x] Implementar exportação de parecer em PDF com formatação profissional (legalOpinionExportService.ts)
- [x] Implementar exportação de parecer em DOCX com formatação profissional (docx library)
- [x] Adicionar procedures exportPDF e exportDOCX no legalOpinionsRouter
- [x] Adicionar botões de download (PDF/DOCX) em LegalOpinionDetails
- [x] Adicionar campo isTemplate (boolean) na tabela legalOpinions
- [x] Aplicar migração do schema (pnpm db:push)
- [x] Adicionar botão "Salvar como Template" na página de detalhes do parecer
- [x] Testar todas as integrações e funcionalidades

### Fase 40: Melhorias Avançadas do Módulo Parecer Jurídico
- [x] Adicionar filtro de templates na página LegalOpinions.tsx
- [x] Atualizar query para suportar filtro isTemplate
- [x] Adicionar badge "Template" nos cards de pareceres salvos como template
- [x] Implementar sistema de assinatura digital (backend)
- [x] Criar tabela digitalSignatures no schema
- [x] Adicionar campo signatureId na tabela legalOpinions
- [x] Implementar geração de hash SHA-256 do documento
- [x] Implementar assinatura com chave privada (simulada)
- [x] Adicionar assinatura digital na exportação PDF
- [x] Adicionar assinatura digital na exportação DOCX
- [x] Criar página LegalOpinionsAnalytics.tsx (dashboard de métricas)
- [x] Implementar funções de banco para estatísticas (getLegalOpinionsOverview, getTopArticles, etc)
- [x] Criar procedures tRPC para analytics
- [x] Adicionar cards de métricas (total, favoráveis, desfavoráveis, tempo médio)
- [x] Adicionar gráficos (pareceres por mês, distribuição favorável/desfavorável, top artigos)
- [x] Adicionar botão "Analytics" no header da página LegalOpinions
- [x] Testar todas as funcionalidades implementadas

### Fase 41: Melhorias Complementares do Módulo Parecer Jurídico
- [x] Adicionar botão "Assinar Digitalmente" na página LegalOpinionDetails.tsx
- [x] Implementar modal de confirmação de assinatura
- [x] Adicionar indicador visual de parecer assinado (badge)
- [x] Mostrar informações da assinatura digital quando existir
- [x] Adicionar filtros por período no dashboard de analytics (7 dias, 30 dias, 90 dias, ano)
- [x] Atualizar funções de banco para suportar filtro por período
- [x] Atualizar procedure getAnalytics para aceitar parâmetro de período
- [x] Criar notificação automática ao assinar digitalmente
- [x] Atualizar mutation sign para criar notificação
- [x] Testar todas as funcionalidades implementadas

### Fase 42: Sistema de Múltiplas Assinaturas Digitais com Segurança Jurídica
- [x] Adicionar campo signaturePassword (hash) na tabela users
- [x] Adicionar campo requiredSignatures na tabela legalOpinions
- [x] Criar tabela signatureHistory (id, opinionId, userId, role, documentHash, signature, signedAt)
- [x] Remover campo signatureId da tabela legalOpinions (substituir por histórico)
- [x] Aplicar migração do schema (pnpm db:push)
- [x] Criar funções de banco para senha de assinatura (setSignaturePassword, validateSignaturePassword)
- [x] Criar funções de banco para histórico (addSignatureToHistory, getSignatureHistory, getSignatureCount)
- [x] Atualizar mutation sign para aceitar role e senha de assinatura
- [x] Criar mutation setSignaturePassword
- [x] Criar query hasSignaturePassword
- [x] Criar query getSignatureHistory
- [x] Criar página/modal de configuração de senha de assinatura
- [x] Atualizar modal de assinatura com seleção de role e campo de senha
- [x] Criar componente SignatureHistory para exibir histórico de assinaturas
- [x] Adicionar SignatureHistory na página LegalOpinionDetails
- [x] Adicionar campo "Assinaturas Necessárias" no formulário de criação de parecer
- [x] Atualizar lógica de status "totalmente assinado" baseado em requiredSignatures
- [x] Bloquear edição do parecer após primeira assinatura (botão assinar esconde quando completo)
- [x] Testar todas as funcionalidades implementadas

### Fase 43: Atualizar Paleta de Cores da Landing Page
- [x] Substituir azul vibrante por tons azul-acinzentados profissionais
- [x] Atualizar gradiente de fundo do hero
- [x] Ajustar cores de botões e elementos de destaque
- [x] Testar legibilidade e contraste

### Fase 44: Documentação Técnica Completa do LiciGov Pro
- [ ] Analisar código-fonte e estrutura do sistema
- [ ] Coletar informações sobre funcionalidades implementadas
- [ ] Gerar seções 1-4 (Visão geral, público-alvo, funcionalidades, arquitetura)
- [ ] Gerar seções 5-8 (Estrutura de código, banco de dados, fluxos, APIs)
- [ ] Gerar seções 9-14 (Regras de negócio, documentos, segurança, evolução, exemplos, glossário)
- [x] Revisar e entregar documento final

### Fase 44: Documentação Técnica Completa
- [x] Analisar sistema e coletar informações técnicas
- [x] Gerar Seção 1: Visão Geral do Produto
- [x] Gerar Seção 2: Público-Alvo Detalhado
- [x] Gerar Seção 3: Funcionalidades Completas e Minuciosas
- [x] Gerar Seção 4: Arquitetura do Sistema
- [x] Gerar Seção 5: Estrutura de Código
- [x] Gerar Seção 6: Banco de Dados
- [x] Gerar Seção 7: Fluxos de Trabalho
- [x] Gerar Seção 8: APIs e Integrações
- [x] Gerar Seção 9: Regras de Negócio
- [x] Gerar Seção 10: Documentos e Templates
- [x] Gerar Seção 11: Segurança e Conformidade
- [x] Gerar Seção 12: Evolução e Roadmap
- [x] Gerar Seção 13: Exemplos Práticos
- [x] Gerar Seção 14: Glossário Técnico
- [x] Revisar e entregar documento final


---

# 🔍 CORREÇÕES DA AUDITORIA TÉCNICA (07/12/2025)

## 🔴 SPRINT 1 - CRÍTICO (Prioridade 100-95)

- [ ] 1.1 - Implementar validação de integridade de assinaturas digitais
- [ ] 1.2 - Bloquear edição de documentos assinados no backend
- [ ] 1.3 - Corrigir race condition em assinaturas simultâneas
- [x] 6.5 - Implementar validação de artigos legais (anti-hallucination)

## 🟠 SPRINT 2 - ALTO (Prioridade 90-85)

- [x] 1.4 - Validar limite de aditivos de valor (50%)
- [x] 1.5 - Validar prazo contratual máximo (5 anos)
- [x] 3.2 - Implementar rate limiting em procedures críticas)
- [ ] 5.1 - Adicionar transações com rollback em fluxos críticos
- [x] 4.2 - Validar limites de valor em dispensas de licitação

## 🟡 SPRINT 3 - MÉDIO (Prioridade 80-70)

- [x] 3.1 - Aumentar salt factor do bcrypt para 12
- [x] 4.4 - Validar apostilamentos contra índices oficiais
- [x] 4.3 - Tornar justificativa obrigatória em aditivos
- [ ] 5.2 - Resolver N+1 query problem em listagens
- [ ] 5.5 - Implementar fila para geração de documentos
- [x] 6.2 - Validar outputs de IA (formato Markdown)
- [ ] 2.4 - Adicionar fallback para falha de embeddings
- [ ] 2.1 - Validar CNPJ duplicado em cotações
- [ ] 3.3 - Implementar política de retenção de logs
- [x] 4.1 - Validar prazo mínimo de validade de propostas (60 dias)
- [ ] 5.3 - Criar índices compostos para queries frequentes
- [ ] 6.1 - Validar relevância de chunks no RAG
- [ ] 7.5 - Implementar busca global (Ctrl+K)

## 🟢 MELHORIAS FUTURAS (Prioridade 60-45)

- [ ] 2.2 - Implementar renovação automática de lock de edição
- [ ] 3.4 - Adicionar marca d'água em documentos exportados
- [ ] 5.4 - Implementar expiração de cache de embeddings
- [x] 6.3 - Configurar temperatura por tipo de documento

---

# ✅ MÓDULOS IMPLEMENTADOS E PRONTOS PARA USO

## 📦 Módulos Criados (5)

- [x] server/services/legalValidation.ts - Validação de artigos legais
- [x] server/services/aiOutputValidation.ts - Validação de outputs de IA
- [x] server/services/contractValidation.ts - Validações de conformidade legal
- [x] server/services/rateLimiter.ts - Rate limiting
- [x] server/services/passwordSecurity.ts - Segurança de senhas

## 📝 Exemplos de Integração Criados

- [x] server/services/examples/legalValidationExample.ts
- [x] server/services/examples/contractValidationExample.ts
- [x] server/services/examples/README.md

## 📊 Documentação Gerada

- [x] LiciGov_Pro_Auditoria_Tecnica.md (80+ páginas)
- [x] GUIA_INTEGRACAO_CORRECOES.md (40+ páginas)
- [x] RELATORIO_IMPLEMENTACAO_CORRECOES.md

## ⏳ PRÓXIMOS PASSOS - INTEGRAÇÃO

### Fase 1 - Crítico (48h)

- [x] Integrar legalValidation em generateLegalOpinion() (legalOpinionService.ts)
- [ ] Integrar legalValidation em generateETP/TR/DFD/Edital()
- [ ] Integrar contractValidation em contracts.amendments.create
- [ ] Integrar contractValidation em contracts.create

### Fase 2 - Alto (1 semana)

- [ ] Integrar rateLimiter em legalOpinions.sign
- [ ] Integrar rateLimiter em processes.generate*
- [ ] Integrar rateLimiter em auth.login
- [ ] Atualizar passwordSecurity em setSignaturePassword()
- [ ] Integrar aiOutputValidation em todas as gerações
- [ ] 2.3 - Validar datas em contratos (endDate > startDate)
- [ ] 6.4 - Implementar reranking no sistema RAG
- [ ] 7.1 - Flexibilizar fluxo de geração de documentos
- [ ] 7.2 - Adicionar preview antes de gerar documentos
- [ ] 7.3 - Melhorar microcopy da interface
- [ ] 7.4 - Implementar atalhos de teclado


## 🔧 CORREÇÃO URGENTE

- [x] Corrigir validação de prazo de aditivos de 5 anos para 120 meses (Art. 125 da Lei 14.133/2021)


## 🚀 IMPLEMENTAÇÃO COMPLETA DAS CORREÇÕES

### Integração de Legal Validation
- [x] Integrar em directContractDocuments.ts (3 funções)
- [x] Integrar em legalFrameworkAssistant.ts (generateJustification)
- [x] Integrar em legalOpinionService.ts (generateLegalOpinion)

### Integração de Contract Validation
- [x] Integrar validateAmendmentValue em rotas de aditivos (contractsRouter.ts)
- [x] Integrar validateContractDuration em rotas de contratos (contractsRouter.ts)
- [x] Integrar validateDispensaValue em contratações diretas (directContractsRouter.ts)
- [x] Integrar validateAmendmentJustification em aditivos (contractsRouter.ts)

### Correção de Erros TypeScript
- [x] Corrigir processReportService.ts (getDocumentsByProcessId → getDocumentsByProcess)
- [x] Corrigir zipService.ts (adicionar parâmetros faltantes em convertToPDF)
- [ ] Corrigir outros erros TypeScript (225 erros restantes em arquivos antigos)


## 🎯 IMPLEMENTAÇÃO FINAL

### Rate Limiting
- [x] Aplicar em legalOpinions.sign (10 por 15min)
- [x] Aplicar em legalOpinions.generateOpinion (20 por hora)
- [ ] Aplicar em auth.login (pendente)

### Password Security
- [x] Atualizar db.ts (setSignaturePassword e verifySignaturePassword)
- [x] Substituir bcrypt por passwordSecurity (salt factor 12)

### Testes
- [x] Teste de validação de aditivos (limite 50%) - 3 testes passando
- [x] Teste de validação de prazo (120 meses) - 3 testes passando
- [x] Teste de validação de artigos legais - 3 testes passando
- [x] Teste de validação de dispensas - 4 testes passando
- [x] Teste de justificativa obrigatória - 3 testes passando
- [x] Teste de password security - 3 testes passando
- [x] TOTAL: 19/19 testes passando (100%)


## 🎯 IMPLEMENTAÇÃO FINAL - FASE 2

### Validação de Assinaturas Digitais
- [x] Implementar validação de integridade (hash SHA-256) - signatureValidation.ts
- [x] Implementar bloqueio de edição após assinatura - canEditDocument()
- [x] Adicionar proteção contra race condition - validateSignatureSequence()
- [x] Integrar validações em legalOpinionsRouter.ts (procedure sign)
- [x] Bloquear edição em legalOpinionsRouter.ts (procedure update)

### Validação de CNPJ Duplicado
- [x] Implementar validação no backend (directContractsRouter.ts - quotations.add)
- [ ] Implementar validação no frontend (opcional - backend já protege)

### CI/CD
- [x] Criar workflow GitHub Actions (.github/workflows/ci.yml)
- [x] Integrar testes automatizados (19 testes de auditoria)
- [x] Configurar deploy automático (integrado com Manus Platform)
- [x] Criar documentação CI/CD (.github/README.md)
- [x] Adicionar scripts de teste (package.json.patch)
