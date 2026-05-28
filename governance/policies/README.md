# Policies

Esta pasta contém políticas operacionais do LiciGov Pro.

Ver [../DOCUMENT_POLICY.md](../DOCUMENT_POLICY.md) para política documental completa.

## Políticas Ativas

### Política de Dados
- Isolamento total por `organizationId` em toda operação
- Dados de um tenant nunca visíveis para outro
- Activity logs imutáveis (LGPD Art. 37)

### Política de Retenção (LGPD + Lei 14.133/2021)
- `legal_permanent`: contratos, aditivos, editais — retenção permanente
- `legal_7years`: pareceres, atas — 7 anos
- `operational_3years`: TR, ETP, DFD — 3 anos
- `draft_7days`: rascunhos — 7 dias
- Purge bloqueado por `legalHold = true`

### Política de Segurança
- Senhas: bcrypt salt 12 obrigatório
- Tokens: expiração máxima 24h
- Upload de arquivo: scan de vírus antes de aceitar (scanStatus: pending → clean/infected)
- Limites: 50MB por arquivo

### Política de Import
- Extração bruta NUNCA persiste diretamente no domínio
- Staging TTL: 30 dias
- Revisão humana obrigatória antes de aprovação
- Confiança explícita: itens incertos são sinalizados, não descartados

### Política de Branch
- Nunca push direto para main
- Sempre resolver conflitos com main ANTES de criar PR
- 100% dos testes devem passar antes de qualquer PR
