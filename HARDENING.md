# Relatório de hardening de containers

## Escopo e ressalva de baseline

O repositório de origem foi inspecionado antes das alterações. Não foi possível executar o baseline: o ambiente desta sessão não possui o comando Docker (`docker: command not found`). Além disso, `app/package.json` e `app/server.js` estavam vazios, portanto não havia aplicação executável para iniciar. As evidências abaixo distinguem fatos verificados de validações não executáveis neste ambiente. A aplicação Node demonstrativa foi completada para que o resultado proposto tenha comportamento testável.

## 1. Problemas encontrados

| Local | Problema inicial | Risco |
|---|---|---|
| `Dockerfile` | `FROM ubuntu:latest` sem versão; sistema genérico como base de Node | Tag mutável dificulta reproduzir/auditar builds; imagem ampla contém componentes desnecessários e aumenta superfície de ataque. |
| `Dockerfile` | `apt-get update` e instalação de Node/npm em comandos separados, sem limpeza | Camadas/cache e pacotes não necessários permanecem na imagem; build menos previsível e maior. |
| `Dockerfile` | Não definia usuário não privilegiado; usuário padrão era root | Comprometimento da aplicação teria privilégios administrativos dentro do container, ampliando impacto sobre arquivos/processos do container. |
| `Dockerfile` | `ENV DB_PASSWORD=123456` | Credencial fraca e embutida na configuração/camadas da imagem, podendo ser recuperada de histórico, imagem ou registro. |
| `docker-compose.yml` | `mysql:latest` | Atualizações imprevisíveis e baixa reprodutibilidade/auditabilidade. |
| `docker-compose.yml` | Senhas fixas `root` e `123456` em variáveis de ambiente versionadas | Exposição de credenciais no Git e uso de credenciais triviais. |
| `docker-compose.yml` | Banco publicado em `3306:3306` | A porta ficava acessível no host sem necessidade; expõe o banco a clientes e ataques externos ao container. |
| `docker-compose.yml` | Sem rede segmentada, limites de recursos, healthcheck ou controles explícitos de privilégios | Maior superfície de comunicação e possibilidade de exaustão de recursos; prontidão e isolamento não eram verificados. |
| `app/` | `package.json` e `server.js` vazios | Não havia aplicação funcional a validar. |

## 2. Medidas aplicadas

- **Imagem da aplicação:** imagem Node Alpine com versão explícita `node:22-alpine3.21`, dependências de produção instaladas por `npm ci` e estágio final separado. Reduz componentes e evita incluir ferramentas de build no runtime.
- **Usuário:** `USER node` no estágio final; a aplicação não inicia como root.
- **Secrets:** credenciais removidas de Dockerfile e código. Compose recebe os valores por interpolação do `.env`; `.env` tem permissões locais restritas (`0600`), está no `.gitignore` e `.dockerignore`; `.env.example` contém somente nomes de variáveis.
- **Credenciais do banco:** aplicação usa usuário dedicado (`DB_USER`), em vez de conectar como root. As senhas locais foram geradas aleatoriamente para esta execução e não são incluídas no Git.
- **Rede:** MySQL não publica porta no host e só está ligado à rede `backend`, interna. A aplicação participa de `backend` e `frontend`; somente a aplicação publica HTTP, limitado ao loopback do host (`127.0.0.1:3000`).
- **Privilégios/isolamento:** aplicação com filesystem somente leitura, `/tmp` temporário com `noexec,nosuid`, todas as capabilities removidas, `no-new-privileges`, limite de PIDs e inicializador de processos. `no-new-privileges` também aplicado ao banco.
- **Recursos:** limites de CPU/memória e PIDs para ambos os serviços; healthchecks e dependência do banco saudável.
- **Build:** `.dockerignore` exclui `.env`, Git e dependências locais, impedindo que secrets entrem no contexto de build.
- **Aplicação:** incluído serviço HTTP com `/` e `/healthz`; a verificação de saúde consulta o banco e devolve indisponibilidade se a conexão falhar.

## Respostas das perguntas

### Imagem
Uma imagem menor contém menos bibliotecas, executáveis e serviços potencialmente vulneráveis. Isso reduz a quantidade de componentes a corrigir, a superfície disponível para exploração e o tamanho a analisar/transferir.

### Menor privilégio
Se um atacante controlar um processo root, poderá alterar arquivos e processos privilegiados no container e potencialmente explorar falhas de escape para ampliar o comprometimento ao host. Containers não são uma fronteira absoluta; executar como não-root reduz impacto, mas não elimina o risco.

### Secrets
1. Uma senha no Dockerfile pode permanecer no histórico e nas camadas da imagem, mesmo que uma camada posterior a remova; imagens podem ser compartilhadas e inspecionadas.
2. `.env` não deve ser versionado porque fornece credenciais a qualquer pessoa ou sistema com acesso ao histórico/clones do repositório; remover depois não apaga necessariamente o histórico.
3. `.env.example` documenta os nomes/estrutura exigidos e facilita configurar o ambiente sem distribuir valores reais.
4. Literal no Compose fica exposto em arquivo versionado e é difícil de rotacionar. Variáveis carregadas do `.env` separam configuração local do código e permitem manter esse arquivo fora do Git. Isso não transforma variáveis de ambiente em cofre: o runtime/administradores ainda podem inspecioná-las; em produção, prefira secrets do orquestrador/gerenciador dedicado.

### Rede
Se o banco só é consumido pela aplicação, não é necessário publicar sua porta no host. Serviços na mesma rede Docker conseguem comunicar-se por nome de serviço; manter o MySQL sem `ports` reduz exposição.

### Recursos
Consumo contínuo de CPU pode degradar ou paralisar outros serviços; falta de memória pode disparar OOM killer, encerrar processos e causar indisponibilidade em cascata. Limites ajudam a conter o impacto de um container.

## 3. Análise final

1. **Principal risco:** credenciais triviais codificadas (incluindo `DB_PASSWORD=123456` e senha root `root`), combinadas com execução potencial como root e exposição do MySQL.
2. **Alteração mais importante:** remoção das credenciais fixas, com senhas locais fortes, `.env` ignorado e conexão do app por usuário de banco dedicado. Isso reduz diretamente o risco de acesso não autorizado ao banco, embora `.env` seja apenas solução básica para desenvolvimento.
3. **Comprometimento da aplicação:** invasor poderia ler/alterar o banco com as permissões do usuário da aplicação e tentar explorar o container/host. Rede interna, usuário não-root, filesystem read-only, capabilities removidas e limites reduzem alcance e impacto; não garantem risco zero.
4. **Menor privilégio:** processo Node como `node`, conta de banco própria, app sem capabilities e sem escrita persistente, serviço MySQL sem porta host e redes separadas.
5. **`.env`:** não deve ser enviado porque contém segredos reutilizáveis e o histórico Git pode preservá-los.
6. **`.env.example`:** modelo sem valores reais que informa quais variáveis devem ser configuradas.
7. **CI/CD:** executar lint/testes, validação do Compose, `npm audit`, varredura de imagem e dependências (ex.: Trivy/Grype), análise de Dockerfile (Hadolint), detecção de secrets e políticas de assinatura/proveniência. Falhas críticas devem bloquear publicação; usar secrets protegidos do CI e nunca imprimir valores.
8. **Kubernetes:** executar como non-root (`runAsNonRoot`, `runAsUser`), `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, seccomp, requests/limits, probes, NetworkPolicies, RBAC mínimo, Pod Security Standards, Secrets integrados a cofre externo e criptografia etcd, imagens por digest e políticas de admissão/scan.

## Evidências e limitações

- Confirmado no ambiente: Docker/Compose não disponíveis; portanto não foi possível fazer `docker compose build/up`, inspecionar UID dentro de container nem demonstrar a comunicação real app-MySQL.
- Validação local executada: `npm ci --ignore-scripts` e `npm audit --omit=dev` (0 vulnerabilidades reportadas); `GET /` retornou HTTP 200; `GET /nada` retornou HTTP 404; `GET /healthz` retornou HTTP 503 esperado porque não há MySQL/Docker neste ambiente. A rota de saúde foi exercitada, mas a integração bem-sucedida com o banco precisa ser confirmada em host com Docker.
- Para executar localmente: `cp .env.example .env`, preencher valores fortes e únicos; depois `docker compose up --build`. Acesse `http://127.0.0.1:3000/` e `http://127.0.0.1:3000/healthz`. Confira `docker compose exec app id` (usuário deve ser `node`) e `docker compose ps` (MySQL sem porta publicada).
