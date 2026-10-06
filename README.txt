POSIÇÃO DE CAMPO
================

ARQUITETURA
-----------

A aplicação usa MVC adaptado ao protocolo WSGI:

- backend/app.py
  Ponto de entrada estável. Exporta somente a aplicação WSGI.

- backend/controllers/
  Camada Controller. Interpreta requisições HTTP, aplica autenticação e
  autorização, chama models/services e produz as respostas.

- backend/models/
  Camada Model. Contém a persistência SQLite, sessões, usuários e regras de
  consistência dos dados armazenados. storage.py gerencia dois arquivos:
  data/usuarios.db (contas, permissões e sessões) e data/dados.db (dados).

- backend/services/
  Regras de domínio que não pertencem ao transporte HTTP nem à persistência:
  análise de relatórios, análise de retornos e importação da base de setores.

- templates/
  Camada View. base.html centraliza a estrutura visual compartilhada.
  index.html, sacarose.html, setores.html, relatorios.html, retornos.html,
  historico.html, emissao.html, usuario_cadastro.html, usuarios.html e
  login.html herdam esse layout usando Jinja2.

- backend/views/
  Configura o renderizador Jinja2, com escape automático do conteúdo HTML.

- static/
  Recursos da apresentação separados em static/css, static/js e
  static/assets.

  base.css contém o tema, o menu e os componentes globais; common.js contém
  requisições HTTP, saída da sessão, diálogos e notificações. Cada módulo
  carrega apenas seus próprios recursos e os componentes compartilhados.
  Consulte docs/frontend.md para a análise e o mapa completo de páginas.

Os módulos database.py, security.py, excel_reports.py, return_analysis.py e
sector_base_import.py na raiz de backend/ são adaptadores de compatibilidade.
Código novo deve importar diretamente de models/ ou services/.

EXECUÇÃO LOCAL
--------------

Execute os comandos a partir da raiz do projeto. No PowerShell:

   Set-Location 'C:\Develop\PosicaoCampo'

1. Instale as dependências (incluindo Jinja2 para a herança dos templates):

   & '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt

2. Crie ou atualize a conta de Administrador:

   & '.\.venv\Scripts\python.exe' -m backend.create_admin

3. Inicie o servidor local:

   & '.\.venv\Scripts\python.exe' run.py --host 127.0.0.1 --port 8000

Os exemplos acima usam o ambiente virtual .venv na raiz do repositório.
Se ele ainda não existir, crie com: python -m venv .venv
Caso utilize outro ambiente Python, substitua o caminho pelo seu executável.
Não é necessário utilizar scripts .bat ou .sh.

LOGIN E SESSÕES
--------------

O login usa contas ativas em data/usuarios.db, hashes de senha e sessões
armazenadas no servidor. As contas existentes continuam funcionando.

Sem "Lembrar de mim": cookie de sessão e validade máxima de 12 horas.
Com "Lembrar de mim": cookie persistente e validade máxima de 30 dias.
Use a opção apenas em dispositivos pessoais. Nenhuma senha é salva pelo
aplicativo no armazenamento do navegador. O olho mostra ou oculta a senha.
O botão Sair revoga a sessão, inclusive a persistente. Desativar a conta ou
redefinir a senha revoga todas as sessões dessa conta. Os prazos estão em
backend/config.py. A restauração de sessões do navegador pode conservar
cookies de sessão; o limite de validade no servidor permanece aplicado.

O cadastro web permite Coordenador e Analista, email opcional, unidade base
e conta ativa/desativada. A unidade base é a abertura inicial, não uma restrição
de acesso às outras unidades. O perfil legado Usuário permanece compatível.
Administradores só são criados pelo utilitário local backend.create_admin;
a API web também bloqueia sua criação. Cada administrador pode ver a própria
conta e usuários não administradores, mas não outras contas administrativas.

run.py substitui o antigo iniciador local. No PythonAnywhere, continue
usando backend.app.application no WSGI, sem executar run.py nos workers.
Recarregue a aplicação na aba Web depois de publicar a atualização.

PYTHONANYWHERE
--------------

O arquivo WSGI deve continuar importando o mesmo ponto de entrada:

   import sys

   path = '/home/appposicaocampo/PosicaoCampo'
   if path not in sys.path:
       sys.path.insert(0, path)

   from backend.app import application

Instale requirements.txt no ambiente virtual configurado na aplicação antes
de recarregá-la: a renderização das páginas agora depende de Jinja2.

Se houver mapeamentos de arquivos estáticos na aba Web, os diretórios físicos
devem apontar para static/css, static/js e static/assets; as URLs continuam
/css/, /js/ e /assets/. Não publique templates/ como diretório estático.

Esses diretórios agora ficam diretamente em
/home/appposicaocampo/PosicaoCampo/static/, sem pasta intermediária.
Atualize o diretório de trabalho da aplicação para a raiz PosicaoCampo.
Na hospedagem, mova data/ com seus arquivos existentes para a nova raiz;
não crie uma pasta vazia em seu lugar. Encerre a versão antiga antes disso.

Depois de publicar uma atualização, recarregue a aplicação pela aba Web.

VERIFICAÇÃO
-----------

Na raiz C:\Develop\PosicaoCampo:

   & '.\.venv\Scripts\python.exe' -m unittest discover -s tests -v

Se Node.js estiver disponível, valide também os formulários e relatórios:

   node tests/test_login.js
   node tests/test_reports.js
   node tests/test_users.js
   & '.\.venv\Scripts\python.exe' -m pip check

Os testes usam bancos temporários e não alteram os dados do sistema.
Node.js não é necessário para iniciar a aplicação. requirements.txt contém
Jinja2 (templates) e xlrd (importação .xls na análise de mudanças de área).

DADOS E MIGRAÇÃO
---------------

data/usuarios.db contém usuários, perfis de acesso e sessões.
data/dados.db contém unidades, histórico, setores, Sacarose e layouts.

Não existe mais criação automática ou manual de backups no sistema.
Os arquivos antigos de backup já existentes não são apagados.

Na primeira inicialização da versão atual, data/posicao_campo.db é migrado
para os dois bancos, preservando IDs, hashes de senha e sessões válidas.
O banco original não é alterado nem removido. Depois da migração, ele não
recebe mais gravações e não é usado como alternativa aos bancos novos.

Antes de iniciar essa versão, encerre as instâncias do servidor antigo.
No PythonAnywhere, publique com a aplicação parada/manutenção e recarregue
os workers após a atualização. Não deixe versões antigas e novas gravarem
simultaneamente em bancos diferentes.

Não substitua apenas um dos bancos. Os dois arquivos fazem parte do mesmo
conjunto de dados. Consulte docs/databases.md para os cuidados de migração.

Bancos, sessões, arquivos de ambiente e cópias do transplante não são
versionados no Git. Consulte docs/transplante-servidor-20261006.md para os
resultados do transplante e a publicação do par de bancos ajustados.
