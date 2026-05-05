# Integração Taglyze → Quackback: sincronização de usuários

## Objetivo

Criar uma integração para que usuários criados, atualizados ou desativados na Taglyze sejam refletidos automaticamente no Quackback, mantendo o mesmo usuário vinculado entre os dois sistemas.

A integração deve permitir que um usuário existente na Taglyze seja reconhecido no Quackback como a mesma pessoa, usando e-mail e um identificador externo estável da Taglyze.

## Resultado esperado

Quando um usuário for criado na Taglyze:

1. A Taglyze dispara um webhook ou chama uma API interna.
2. O Quackback recebe os dados do usuário.
3. O Quackback cria ou atualiza o usuário/principal correspondente.
4. O vínculo externo é salvo em uma tabela de relacionamento.
5. Feedbacks, votos, comentários e inscrições podem ser associados corretamente ao usuário.

## Escopo desta integração

Esta integração não é SSO/login automático. Ela sincroniza identidade cadastral.

Inclui:

- Criar usuário no Quackback quando ele existir na Taglyze.
- Atualizar nome, e-mail e status do usuário.
- Vincular `taglyze_user_id` ao usuário/principal do Quackback.
- Evitar duplicidade por e-mail.
- Registrar origem externa do usuário.
- Permitir auditoria e reprocessamento.

Não inclui:

- Login automático sem senha.
- Troca de sessão entre sistemas.
- Permissão administrativa automática.
- Sincronização de empresas/tenants, a menos que seja implementada em fase posterior.

## Arquitetura recomendada

```txt
Taglyze
  └── Webhook user.created / user.updated / user.deleted
        ↓
Quackback API
  └── /api/integrations/taglyze/users
        ↓
Integration Service
  ├── valida assinatura do webhook
  ├── normaliza payload
  ├── upsert de usuário/principal
  ├── grava vínculo externo
  └── registra log/auditoria
```

## Dados mínimos necessários vindos da Taglyze

A Taglyze deve enviar ao Quackback, no mínimo:

```json
{
  "event": "user.created",
  "user": {
    "id": "taglyze_user_123",
    "email": "cliente@empresa.com.br",
    "name": "Cliente Exemplo",
    "avatar_url": "https://...",
    "status": "active",
    "created_at": "2026-05-05T12:00:00Z",
    "updated_at": "2026-05-05T12:00:00Z"
  },
  "workspace": {
    "id": "taglyze_workspace_123",
    "name": "Empresa Exemplo"
  }
}
```

## Eventos recomendados

A Taglyze deve disponibilizar estes eventos:

- `user.created`
- `user.updated`
- `user.deleted`
- `user.disabled`
- `user.enabled`
- `user.email_changed`

Para o MVP, os eventos essenciais são:

- `user.created`
- `user.updated`
- `user.disabled`

## Segurança do webhook

A Taglyze deve assinar cada requisição com HMAC SHA-256 usando um segredo compartilhado.

Headers recomendados:

```txt
X-Taglyze-Event: user.created
X-Taglyze-Timestamp: 2026-05-05T12:00:00Z
X-Taglyze-Signature: sha256=<assinatura>
X-Taglyze-Delivery-Id: <uuid>
```

A assinatura deve ser calculada sobre:

```txt
timestamp + "." + raw_body
```

O Quackback deve:

- rejeitar requisições sem assinatura;
- rejeitar timestamps antigos;
- validar a assinatura com comparação segura;
- registrar `delivery_id` para idempotência;
- retornar 2xx apenas quando o evento for processado ou já tiver sido processado antes.

## Variáveis de ambiente no Quackback

```env
TAGLYZE_WEBHOOK_SECRET=
TAGLYZE_INTEGRATION_ENABLED=true
TAGLYZE_DEFAULT_ROLE=user
TAGLYZE_DEFAULT_SOURCE=taglyze
```

Opcional:

```env
TAGLYZE_API_BASE_URL=
TAGLYZE_API_TOKEN=
```

Estas variáveis opcionais servem para fallback, reconciliação ou busca ativa na Taglyze.

## Banco de dados: tabela de vínculo externo

Criar uma tabela para mapear usuários externos para entidades internas do Quackback.

Nome sugerido:

```txt
external_user_links
```

Campos sugeridos:

```txt
id
provider                 -- taglyze
external_user_id         -- ID do usuário na Taglyze
external_workspace_id    -- ID da empresa/workspace na Taglyze, se aplicável
user_id                  -- usuário interno do Quackback
principal_id             -- principal interno do Quackback
email
name
status                   -- active, disabled, deleted
last_synced_at
created_at
updated_at
```

Índices recomendados:

```txt
unique(provider, external_user_id)
unique(provider, external_workspace_id, external_user_id)
index(email)
index(user_id)
index(principal_id)
```

## Regras de matching

Ordem recomendada para localizar usuário existente:

1. Buscar por `provider = taglyze` + `external_user_id`.
2. Se não existir, buscar usuário interno pelo e-mail normalizado.
3. Se existir usuário por e-mail, criar apenas o vínculo externo.
4. Se não existir usuário, criar novo usuário/principal.

O e-mail deve ser normalizado com:

- trim;
- lowercase;
- validação de formato;
- bloqueio de e-mails vazios ou inválidos.

## Regras de criação no Quackback

Ao receber `user.created`:

1. Validar assinatura.
2. Validar payload.
3. Normalizar e-mail.
4. Procurar vínculo externo.
5. Procurar usuário por e-mail.
6. Criar usuário se necessário.
7. Criar ou atualizar principal.
8. Gravar vínculo externo.
9. Registrar log do evento.

## Regras de atualização

Ao receber `user.updated`:

- atualizar nome;
- atualizar avatar, se existir suporte;
- atualizar status;
- atualizar e-mail com cautela;
- preservar histórico se o e-mail mudar.

Para troca de e-mail, a regra recomendada é:

1. localizar pelo `external_user_id`;
2. atualizar e-mail interno se não houver conflito;
3. se houver conflito, registrar erro de sincronização e não sobrescrever automaticamente.

## Regras de desativação

Ao receber `user.disabled` ou `user.deleted`:

- marcar vínculo como desativado;
- opcionalmente impedir novas autenticações via Taglyze;
- não excluir posts, votos ou comentários históricos;
- manter autoria preservada.

Nunca apagar fisicamente o usuário no primeiro momento.

## Endpoints a implementar no Quackback

### Receber webhook

```txt
POST /api/integrations/taglyze/users/webhook
```

Responsabilidades:

- validar assinatura;
- validar schema;
- deduplicar delivery;
- chamar service de sincronização;
- retornar resposta idempotente.

### Reprocessar usuário manualmente

```txt
POST /api/admin/integrations/taglyze/users/sync
```

Payload:

```json
{
  "taglyze_user_id": "taglyze_user_123"
}
```

Uso:

- correção manual;
- suporte;
- reprocessamento de usuário específico.

### Healthcheck da integração

```txt
GET /api/admin/integrations/taglyze/health
```

Deve retornar:

- integração ativa/inativa;
- último evento recebido;
- últimos erros;
- quantidade de usuários vinculados.

## O que precisa existir na Taglyze

A Taglyze precisa fornecer pelo menos uma destas opções:

### Opção preferencial: Webhooks

- cadastro de URL de webhook;
- eventos de usuário;
- segredo por webhook;
- retry em falhas;
- delivery id;
- logs de entrega.

### Opção alternativa: API de leitura

Endpoints mínimos:

```txt
GET /api/users/:id
GET /api/users?updated_since=...
```

Isso permite jobs de reconciliação caso algum webhook falhe.

### Opção ideal: ambos

- webhook para tempo real;
- API para reconciliação.

## O que precisa existir no Quackback

- Migration da tabela `external_user_links`.
- Service `taglyze-user-sync.service.ts`.
- Validador de assinatura HMAC.
- Endpoint de webhook.
- Logs de processamento.
- Idempotência por `delivery_id`.
- Testes unitários do service.
- Testes do endpoint.
- Painel/admin opcional para status da integração.

## Estrutura de arquivos sugerida

```txt
apps/web/src/lib/server/integrations/taglyze/
  taglyze.types.ts
  taglyze-signature.ts
  taglyze-user-sync.service.ts
  taglyze-user-sync.test.ts

apps/web/src/routes/api/integrations/taglyze/users/webhook.ts
apps/web/src/routes/api/admin/integrations/taglyze/health.ts

packages/db/migrations/
  <timestamp>_external_user_links.sql
```

A estrutura exata deve respeitar o padrão atual do projeto.

## Observabilidade

Registrar:

- evento recebido;
- delivery id;
- usuário externo;
- usuário interno vinculado;
- status do processamento;
- erro, se houver;
- tempo de processamento.

Evitar logar dados sensíveis em excesso.

## Idempotência

Cada webhook deve ter `X-Taglyze-Delivery-Id`.

O Quackback deve registrar eventos processados para evitar duplicidade em retries.

Tabela sugerida:

```txt
integration_event_deliveries
```

Campos:

```txt
id
provider
external_delivery_id
event_type
status
processed_at
error_message
created_at
```

Índice:

```txt
unique(provider, external_delivery_id)
```

## Tratamento de erros

Erros 4xx:

- assinatura inválida;
- payload inválido;
- e-mail inválido;
- evento não suportado.

Erros 5xx:

- falha temporária de banco;
- erro interno inesperado.

Para erros 5xx, a Taglyze deve tentar reenviar.

## Plano de implementação

### Fase 1 — MVP

- Criar tabela de vínculo externo.
- Criar endpoint de webhook.
- Processar `user.created` e `user.updated`.
- Vincular por e-mail.
- Adicionar logs básicos.

### Fase 2 — Robustez

- Idempotência por delivery id.
- Reprocessamento manual.
- Healthcheck administrativo.
- Testes automatizados.

### Fase 3 — Operação avançada

- Reconciliação agendada via API da Taglyze.
- Tela admin de integração.
- Alertas de falha.
- Relatório de usuários não sincronizados.

## Critérios de aceite

- Usuário criado na Taglyze aparece no Quackback sem duplicidade.
- Usuário com e-mail já existente é vinculado, não duplicado.
- Evento repetido não cria duplicidade.
- Assinatura inválida é rejeitada.
- E-mail alterado é tratado sem sobrescrever outro usuário.
- Desativação não apaga histórico.
- Logs permitem auditoria.

## Dúvidas antes de implementar código

Antes de codificar, confirmar na Taglyze:

1. Existe webhook de usuário criado/atualizado/desativado?
2. Qual é o formato real do payload?
3. A Taglyze possui ID público e imutável do usuário?
4. Existe conceito de workspace/tenant?
5. A Taglyze permite retry de webhook?
6. Existe API para buscar usuário por ID?
7. Existe API para listar usuários alterados desde uma data?

## Recomendação final

Implementar primeiro esta sincronização cadastral antes do SSO. Ela cria a base de identidade compartilhada entre os sistemas e reduz risco de duplicidade quando o login via JWT for adicionado depois.
