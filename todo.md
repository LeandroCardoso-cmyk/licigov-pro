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
