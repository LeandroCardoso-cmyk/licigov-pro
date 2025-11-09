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
- [ ] Visualização em Quadro Kanban (padrão)
- [ ] Visualização em Lista
- [ ] Visualização em Calendário
- [ ] Campos: Nome da Tarefa, Responsável, Status, Prazo Final, Data da Licitação, Prioridade
- [ ] Status: Pendente, Em Andamento, Pausada, Atrasada, Aguardando Informação, Concluída
- [ ] Prioridades: Baixa, Média, Alta, Urgente (com cores)
- [ ] Anexar arquivos às tarefas (limite de 10MB)
- [ ] Tags personalizadas
- [ ] Relatório Resumido (Nome, Status, Prazo)
- [ ] Relatório Completo
- [ ] Calendário com datas de licitações
- [ ] Alertas de prazos

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
