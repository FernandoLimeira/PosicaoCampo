POSIÇÃO DE CAMPO - VERSÃO MULTIUSUÁRIO

REQUISITO
- Python 3.10 ou superior.
- Não há dependências externas obrigatórias.

INICIAR NO CODESPACES / LINUX
cd "/workspaces/PosicaoCampo/TROCA DE TURNO"
source .venv/bin/activate
python server.py

Se o ambiente virtual não estiver disponível:
python3 server.py

PRIMEIRA CONFIGURAÇÃO NO WINDOWS
1. Extraia a pasta do projeto.
2. Execute criar-admin.bat.
3. Informe o nome do Administrador e uma senha com pelo menos 8 caracteres.
4. Execute iniciar-servidor.bat.
5. Abra http://localhost:8000.

SEGURANÇA
- Cadastro público desativado.
- Senhas com PBKDF2-SHA256 + salt; nunca armazenadas em texto puro.
- Senha mínima de 8 caracteres na criação e redefinição.
- Sessões armazenadas no servidor; cookie HttpOnly e SameSite=Strict.
- Em HTTPS (inclusive atrás de proxy com X-Forwarded-Proto=https), o cookie recebe Secure.
- Proteção contra tentativas repetidas de login por usuário/IP e também por IP agregado.
- Operações de gravação passam por verificação de origem.
- CSP restritiva sem unsafe-inline, bloqueio de frames e MIME sniffing.
- Importações Excel/CSV têm limites de tamanho, linhas, colunas e tamanho expandido do XLSX.
- CSV exportado neutraliza valores que poderiam ser interpretados como fórmulas pelo Excel.
- Controle de versão evita sobrescrita silenciosa em edição concorrente, inclusive na Sacarose.

RECURSOS PRINCIPAIS
- PPT, NRD, RBR e PST.
- Posição de Campo com frentes, setor, status, produção, observações, mudanças e chuva.
- Base de Setores com importação XLSX/XLSM e cadastro manual.
- Sacarose nas quatro unidades, selecionada pela navbar.
- Sincronização bidirecional entre Sacarose e Posição de Campo.
- Checkbox "Não exibir" afeta somente a imagem da Sacarose; o dado continua sincronizado.
- Exportação Sacarose por polo: NRD/PPT = Polo SP; RBR/PST = Polo MS.
- Imagens em alta definição usando recursos em assets/.
- Histórico de alterações, usuários e backups.
- Relatório operacional por CSV/XLSX.

BASE DE SETORES
A importação reconhece preferencialmente uma aba BASE_DADOS e os cabeçalhos:
- SETOR
- SEÇÃO
- DESCRIÇÃO SETOR
Também aceita variações de Fazenda/Descrição da Fazenda.

SACAROSE
- A unidade a preencher é definida pela unidade selecionada na navbar.
- Ao salvar, somente a unidade ativa é enviada ao servidor; as demais não são sobrescritas.
- O salvamento usa a versão atual da unidade para detectar conflito de edição.
- A imagem respeita imediatamente o checkbox "Não exibir".

BACKUP
- Banco principal: data/posicao_campo.db
- Backups: data/backups/posicao_campo-AAAA-MM-DD-HHMMSS.db
- Backup automático periódico: a cada 4 horas quando houver atividade.
- Retenção automática: 30 dias.
- Backup manual: exclusivo do Administrador.

ESTRUTURA ATUAL
- server.py                    servidor WSGI
- backend/app.py               rotas HTTP/API e segurança de requisição
- backend/database.py          SQLite, usuários, histórico, Sacarose e backups
- backend/security.py          hash de senha e tokens
- backend/config.py            configurações
- backend/excel_reports.py     análise CSV/XLSX
- backend/sector_base_import.py importação da Base de Setores
- index.html                   painel operacional
- login.html                   login
- css/                         estilos
- js/                          frontend
- assets/                      imagens usadas pelo frontend/exportação
- tests/                       testes automatizados
- data/                        banco e backups (não substitua ao atualizar código)

ROTAS PRINCIPAIS
- /login
- /
- /api/auth/login
- /api/auth/logout
- /api/auth/me
- /api/units
- /api/units/{codigo}
- /api/sacarose
- /api/sector-base
- /api/sector-base/import
- /api/reports/excel/analyze
- /api/history

ROTAS EXCLUSIVAS DO ADMINISTRADOR
- GET/POST /api/users
- DELETE /api/users/{id}
- PUT /api/users/{id}/active
- PUT /api/users/{id}/password
- POST /api/backup

TESTES AUTOMATIZADOS
Na pasta do projeto:
python -m unittest discover -s tests -v

A suíte cobre senha mínima, concorrência da Posição de Campo, backups, gravação parcial da Sacarose, conflito de versão e preservação do checkbox de imagem na sincronização inversa.

LIMPEZA DE ARQUIVOS LEGADOS
Codespaces/Linux:
bash limpar-legados.sh

Windows:
limpar-legados.bat

Os scripts removem somente duplicatas/arquivos antigos que não são usados pelo servidor atual. Não removem data/posicao_campo.db, backups ou .venv.

REDE / INTERNET
O servidor de desenvolvimento escuta em 0.0.0.0:8000 por padrão. Para uso fora de rede controlada, use HTTPS e um proxy/servidor de produção apropriado. O wsgiref é adequado para desenvolvimento/rede local, não para exposição direta à internet.
