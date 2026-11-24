# AURIX AI — Guia de Produção, Segurança, Persistência e Recuperação

Este documento descreve os requisitos reais para executar o AURIX AI em produção de forma privada, resiliente e recuperável, distinguindo o que já é imposto pelo código e o que depende da infraestrutura de hospedagem.

---

## 1. Execução em Produção (Sem Vite / Sem HMR)

1. Gere o bundle estático do frontend:
   ```bash
   npm run build
   ```
2. Inicie o servidor exclusivamente com `NODE_ENV=production`:
   ```bash
   NODE_ENV=production node server.ts
   ```
   - Com `NODE_ENV=production`, o Vite middleware não é carregado e a porta de HMR (`24678`) não é aberta.
   - O servidor falha na inicialização caso `dist/index.html` não exista.

---

## 2. Variáveis de Ambiente Obrigatórias / Recomendadas

Configure exclusivamente no painel seguro de segredos da hospedagem (nunca em arquivos versionados):

| Variável | Obrigatória em produção | Função |
| --- | --- | --- |
| `NODE_ENV=production` | Sim | Desativa Vite/HMR, ativa `trust proxy`, exige HTTPS e emite `Strict-Transport-Security`. |
| `AURIX_SESSION_SECRET` | Sim (>= 32 chars) | Assinatura HMAC dos tokens Bearer administrativos (permite manter sessões entre reinícios e réplicas). |
| `AURIX_VAULT_DIR` | Sim quando houver volume montado | Aponta o cofre para um volume persistente montado (ex.: `/mnt/aurix-vault`). |
| `AURIX_VAULT_SECRET` | Opcional (>= 16 chars) | Desbloqueia automaticamente o cofre no boot; se omitida, exige desbloqueio manual via UI (`Segurança e Cofre`). |
| `AURIX_ALLOWED_ORIGINS` | Recomendada | Lista separada por vírgulas de origens `https://...` extras autorizadas (proibido `*`). |
| `AURIX_REDIS_URL` | Sim para múltiplas instâncias | URL `rediss://...` (ou `redis://...` em VPC privada) para revogação de sessões e rate limit compartilhados. |
| `AURIX_REQUIRE_SHARED_STORE` | `true` em multi-instância | Faz o servidor falhar fechado (`HTTP 503`) se Redis não estiver configurado ou ficar indisponível. |
| `AURIX_REQUIRE_PERSISTENT_VOLUME` | `true` quando exigido | Aborta a inicialização se o cofre estiver sobre filesystem efêmero (`overlay`/`tmpfs`). |
| `AURIX_STRICT_PRODUCTION` | `true` em produção estrita | Aborta o boot se houver qualquer bloqueador em `evaluateProductionReadiness()`. |

---

## 3. Persistência Real do Cofre (`.aurix-vault/`)

- Sem um volume montado externo, containers Cloud Run gravam em `overlay` efêmero e perdem alterações em disco quando a revisão/instância é recriada.
- **Configuração recomendada na hospedagem**:
  1. Monte um volume persistente (Cloud Storage FUSE dedicado com permissões restritas ou Filestore NFS/PV) em `/mnt/aurix-vault`.
  2. Defina `AURIX_VAULT_DIR=/mnt/aurix-vault` e `AURIX_REQUIRE_PERSISTENT_VOLUME=true`.
  3. O servidor impõe automaticamente permissão `0700` no diretório, `0600` nos arquivos, rejeição de symlinks e escrita atômica com `O_EXCL` + `fsyncSync`.

---

## 4. Proteções de Rede na Hospedagem (WAF, Ingress e Egress)

O código já restringe chamadas de provedores (`httpClient.ts`) exclusivamente via `https://` aos domínios oficiais (`generativelanguage.googleapis.com`, `api.groq.com`, `api.cloudflare.com`, `openrouter.ai`, `api.mistral.ai`), bloqueando redirects (`redirect: 'error'`) e resolução DNS para IPs privados/loopback.

Como o container gerenciado não possui `iptables`/`nftables`, aplique na borda da nuvem:
1. **Ingress / WAF**: Cloud Load Balancer + Cloud Armor (rate limit L7, bloqueio de bots/scanners e HTTPS obrigatório com TLS 1.2+).
2. **Acesso privado**: se o console for restrito à equipe interna, configure Cloud Run Ingress privado / Identity-Aware Proxy (IAP) ou VPN/VPC.
3. **Egress Firewall**: roteie saída por Serverless VPC Access + Cloud NAT com política permitindo HTTPS (`443`) apenas para os 5 domínios de provedores de IA e para o endpoint TLS do Redis (`AURIX_REDIS_URL`).

---

## 5. Procedimento de Backup e Recuperação de Desastres

### Backup Preventivo
1. Acesse **Segurança e Cofre** com o cofre desbloqueado.
2. Em **Backup e restauração cifrados**, informe uma senha forte dedicada (>= 16 caracteres) e clique em **Exportar JSON**.
3. Armazene o arquivo `.json` (`aurix-vault-backup-v1`) e a senha de backup em cofres separados e offline.

### Recuperação após Falha, Corrupção ou Perda de Container
1. **Caso haja corrupção em `keys-vault.enc.json`**:
   - O sistema entra automaticamente em modo **fail-closed**, preservando os bytes originais em disco sem sobrescrever.
   - Copie o arquivo corrompido para diagnóstico se necessário antes de restaurar.
2. **Restaurando em nova instância ou sobre arquivo corrompido**:
   - Suba a instância com as variáveis de produção e autentique-se no painel administrativo.
   - Em **Segurança e Cofre**, desbloqueie o cofre com a chave mestra ativa (ou defina a nova chave mestra caso seja uma instância limpa).
   - Selecione o arquivo `.json` do backup (`aurix-vault-backup-v1`), informe a senha do backup e execute **Restaurar**.
   - O backend valida a tag GCM e o AAD do backup, valida cada registro e re-cifra todas as credenciais com AES-256-GCM + AAD sob a chave mestra ativa.
3. **Verificação pós-recuperação**:
   - Confirme `IntegridadStatus = ok`, permissões `0700`/`0600` e execute um teste HTTP em **Provedores IA** ou **Cofre de Chaves**.
