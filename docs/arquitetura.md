# Arquitetura do backend

Aplicação WSGI pura (sem framework), com SQLite em dois arquivos
(`data/usuarios.db` e `data/dados.db`). O ponto de entrada permanece
`backend/app.py` (`from backend.app import application`), usado pelo
PythonAnywhere e pelo `run.py`.

## Direção das dependências

```
controllers  ──►  services  ──►  (biblioteca padrão)
     │                ▲
     ▼                │
   models  ───────────┘   (models usam serviços puros: turnos, status, frentes)
     │
     ▼
storage / security / constants
```

- `controllers` conhecem HTTP; `models` e `services` não conhecem HTTP.
- `models/constants.py` não importa nada do projeto e pode ser usado por
  qualquer camada.
- `services` são funções puras de leitura/análise (sem banco de dados).
- Imports locais restantes, documentados no código:
  `storage` → `front_notes` (criação da tabela de acompanhamentos) e
  `production` → `module_access` (validação de concessões delegadas).

## `backend/controllers/`

| Módulo | Responsabilidade |
|---|---|
| `application_controller.py` | `application(environ, start_response)`: despachante; chama `init_db()` na importação |
| `http.py` | respostas (`_respond`, `_json`, `_redirect`, `_page`, `_file`), cookies, corpo JSON, multipart, verificação de mesma origem e a classe `Request` |
| `auth.py` | sessão do usuário, cookie de autenticação e limite de tentativas de login |
| `routes/auth.py` | `/login`, `/register`, `/api/auth/*` |
| `routes/users.py` | `/api/users`, acessos por módulo e da Produção |
| `routes/production.py` | `/api/production/*` |
| `routes/field.py` | `/api/front-notes*`, `/api/units*`, `/api/history` |
| `routes/sacarose.py` | `/api/sacarose` |
| `routes/sectors.py` | `/api/sector-base*` |
| `routes/returns.py` | `/api/return-analysis/*` (layouts, solo úmido, análise, PPTX) |
| `routes/reports.py` | `/api/reports/excel/analyze` |
| `routes/pages.py` | `/sem-acesso`, páginas HTML, estáticos (`/css/`, `/js/`, `/assets/`, inclusive subpastas) e o 404 final |

Ordem de avaliação de uma requisição:

1. sessão (cookie) e bloqueio de `POST/PUT/PATCH/DELETE` de outra origem;
2. rotas de autenticação;
3. checagem global `required_permission` (para usuários autenticados);
4. handlers de API por domínio (`ROUTE_HANDLERS`); cada um devolve `None`
   quando a rota não é dele;
5. páginas, estáticos e `Rota não encontrada.` (404).

`Request.guarded()` concentra o padrão `PermissionError` → 403 e
`ValueError`/`TypeError` → 400 com a mensagem da exceção; cada rota informa
exatamente quais exceções trata, mantendo os códigos de status anteriores.

## `backend/models/`

| Módulo | Responsabilidade |
|---|---|
| `constants.py` | unidades, indicadores, perfis, `MAX_SECTOR_LENGTH` |
| `storage.py` | conexões, esquema, migrações e verificação de integridade |
| `security.py` | hash de senha e tokens de sessão |
| `users.py` | usuários, credenciais, sessões e administração de contas |
| `module_access.py` | catálogo de módulos e permissões |
| `production.py` | Produção Agrícola |
| `service_orders.py` | Ordens de Serviço da Produção (importação por unidade e situação OK / Sem O.S. dos lançamentos) e cadastro de operações |
| `units.py` | posição por unidade, versão, histórico e espelhamento na Sacarose |
| `sectors.py` | base de setores |
| `sacarose.py` | posições da Sacarose |
| `returns.py` | layouts de mudanças de área e apontamentos de solo úmido |
| `front_notes.py` | acompanhamentos por frente |
| `database.py` | fachada: `init_db()` e reexportação dos nomes acima |

Código novo deve importar do módulo de domínio. `backend.models.database`
(e o antigo `backend.database`) continuam reexportando os nomes para
compatibilidade com scripts e testes.

## `backend/services/`

| Módulo | Responsabilidade |
|---|---|
| `xlsx_reader.py` | leitura XLSX compartilhada, em streaming, com limites por chamador e erro amigável para arquivo corrompido |
| `excel_reports.py` | relatório de produtividade (CSV/XLSX) |
| `sector_base_import.py` | leitura da planilha da base de setores |
| `return_analysis.py` | análise de retornos (XLSX/XLS) |
| `soil_wet_import.py` | leitura dos apontamentos de solo úmido |
| `return_presentation.py` | geração do PPTX |
| `front_identifiers.py` | todas as normalizações de identificação de frente (tabela no docstring) |
| `field_status.py`, `operational_shifts.py` | status de campo e turnos |

## Compatibilidade mantida

- `backend/app.py`, `backend/database.py` e `backend/security.py` continuam
  como caminhos de importação estáveis.
- Os antigos atalhos `backend/excel_reports.py`, `backend/return_analysis.py`
  e `backend/sector_base_import.py` foram removidos (não eram importados);
  use `backend.services.<módulo>`.
