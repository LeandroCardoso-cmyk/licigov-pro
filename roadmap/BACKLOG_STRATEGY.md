# Backlog Strategy

## Critérios de Priorização

### Critérios Técnicos (peso 40%)
1. **Fundação**: bloqueia sprints futuras? → Alta prioridade
2. **Dívida técnica**: degrada progressivamente sem atenção? → Média-alta
3. **Performance**: afeta experiência com >100 tenants? → Média
4. **Segurança**: expõe dados ou cria vulnerabilidade? → Crítica

### Critérios de Produto (peso 40%)
1. **Conformidade legal**: obrigatório pela Lei 14.133/2021? → Crítica
2. **Viabilidade de uso**: sem isso o sistema não serve ao propósito? → Alta
3. **Diferencial competitivo**: nos separa de concorrentes? → Média
4. **Pedido de cliente** (quando houver): → Contextual

### Critérios de Risco (peso 20%)
1. **Data breach risk**: pode expor dados sensíveis? → Crítico
2. **Data loss risk**: pode perder dados de licitação? → Crítico
3. **Compliance risk**: pode gerar autuação/irregularidade? → Alto

## Itens de Backlog Priorizados

### Críticos (próximas 2 sprints)
- [ ] Interface de revisão humana de staging items
- [ ] Extração real PDF/DOCX (sprint 3)
- [ ] Matching CATMAT baseline
- [ ] Queue persistente Redis/BullMQ

### Altos (próximas 4 sprints)
- [ ] IA assistente de normalização
- [ ] Dashboard de KPIs por organização
- [ ] Relatório de conformidade Lei 14.133/2021
- [ ] Assinatura eletrônica de documentos

### Médios (roadmap)
- [ ] Integração PNCP
- [ ] Notificações de prazo
- [ ] App mobile
- [ ] Modo offline

### Baixos (backlog aberto)
- [ ] Temas customizados por organização
- [ ] Exportação para Excel customizado
- [ ] Widgets embedded
