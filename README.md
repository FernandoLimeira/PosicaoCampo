# Posição de Campo

Projeto web interno para acompanhamento da posição operacional das unidades.

## Estrutura

O backend segue uma separação MVC adaptada a uma aplicação WSGI:

- `backend/app.py`: composição e ponto de entrada WSGI;
- `backend/controllers/`: requisições, respostas e rotas HTTP;
- `backend/models/`: persistência SQLite e autenticação;
- `backend/services/`: importações e análises de domínio;
- `backend/views/`: renderização dos templates Jinja2;
- `templates/`: views HTML organizadas por página;
- `static/`: CSS, JavaScript e imagens.

A aplicação está diretamente na raiz `PosicaoCampo`, junto de `run.py`,
`requirements.txt`, `data/` e `tests/`. Não há pasta intermediária.

O layout comum fica em `templates/base.html`: menu, usuário, rodapé e
blocos de conteúdo. O tema e a estrutura visual ficam em `static/css/base.css`.
Posição de Campo, Sacarose, Cadastro de setores, Relatórios, Análise de mudanças
de área, Emissão global, Histórico e Usuários têm
templates, CSS e JavaScript próprios. Todas essas páginas herdam o layout base;
o login também o utiliza, sem exibir o menu autenticado.

Consulte a [análise e organização do frontend](docs/frontend.md)
para entender a separação, as rotas e como adicionar novas páginas.

## Bancos de dados

- `data/usuarios.db`: contas, perfis de permissão e sessões. Os níveis são
  Administrador (`admin`), Coordenador (`coordinator`) e Analista (`analyst`);
  o perfil legado Usuário (`user`) permanece compatível.
- `data/dados.db`: unidades, Sacarose, setores, layouts e histórico operacional.

O sistema de backups automáticos/manuais foi removido. A primeira inicialização
migra o antigo `data/posicao_campo.db` sem apagar ou modificar o arquivo original.
Pare as instâncias antigas antes dessa inicialização. Detalhes e cuidados estão
em [docs/databases.md](docs/databases.md).

## Execução local

Abra `C:\Develop\PosicaoCampo` no VS Code e execute no terminal PowerShell:

```powershell
python -m venv .venv # Somente se o ambiente ainda não existir.
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
& '.\.venv\Scripts\python.exe' run.py --host 127.0.0.1 --port 8000
```

Acesse `http://127.0.0.1:8000`. Se ainda não tiver uma conta de administrador,
execute `& '.\.venv\Scripts\python.exe' -m backend.create_admin`.

O login valida usuários ativos no banco, com senhas protegidas por hash e sessões
revogáveis no servidor. Sem “Lembrar de mim”, a sessão dura no máximo 12 horas,
com cookie de sessão. Com a opção marcada, o acesso pode ser mantido por até
30 dias neste dispositivo. “Sair”, desativar a conta ou redefinir a senha revoga
o acesso correspondente. Não são salvas senhas no navegador pelo aplicativo.
O botão de olho permite mostrar ou ocultar a senha antes de enviar o formulário.
Detalhes da autenticação e dos testes estão em [docs/authentication.md](docs/authentication.md).

O cadastro administrativo permite Coordenador e Analista, email opcional,
unidade base e conta ativa ou desativada. A unidade base é aberta após o login,
sem impedir consultas às outras unidades. Novos administradores são criados
somente pelo utilitário local `python -m backend.create_admin`; a API web bloqueia
sua criação. Cada administrador vê a própria conta e usuários não administradores,
mas não pode visualizar nem gerenciar outras contas administrativas nessa tela.

## Navegação e relatórios

O menu lateral mantém os quatro botões de unidade e submenus que abrem à direita.
Relatórios reúne Posição de Campo, Sacarose, produtividade por frota e operador,
e Análise de mudanças de área. A unidade selecionada filtra os relatórios e sua
emissão individual. “Emitir posição global” é uma opção independente que gera
uma imagem HD consolidando PPT, NRD, RBR e PST. A saudação, data e relógio ficam
no rodapé do menu.

## Verificação e versionamento

```powershell
& '.\.venv\Scripts\python.exe' -m unittest discover -s tests -v
node tests/test_login.js
node tests/test_reports.js
node tests/test_users.js
& '.\.venv\Scripts\python.exe' -m pip check
```

Os testes utilizam bancos temporários e não alteram os bancos locais. Node.js é
necessário apenas para os testes JavaScript, não para executar a aplicação.
`requirements.txt` contém Jinja2 para templates e xlrd para importar arquivos
`.xls` na análise de mudanças de área; os demais módulos usam a biblioteca padrão.

Os bancos, sessões, ambientes virtuais e cópias do transplante ficam fora do Git.
O commit contém código e documentação, não as contas ou dados do servidor.
Os cuidados e resultados do transplante realizado estão registrados em
[docs/transplante-servidor-20261006.md](docs/transplante-servidor-20261006.md).

## PythonAnywhere

No WSGI, inclua a raiz do projeto no caminho de importação:

```python
import sys

path = '/home/appposicaocampo/PosicaoCampo'
if path not in sys.path:
    sys.path.insert(0, path)

from backend.app import application
```

Atualize também os mapeamentos estáticos, caso configurados, para
`/home/appposicaocampo/PosicaoCampo/static/css`, `static/js` e `static/assets`.
As URLs públicas `/css/`, `/js/` e `/assets/` continuam iguais.

Na publicação, mova a pasta `data` existente junto da aplicação; não a
substitua por uma pasta vazia. Encerre a versão antiga antes de iniciar a nova.

Os antigos caminhos de importação do backend continuam disponíveis como módulos
de compatibilidade. O ponto WSGI permanece:

```python
from backend.app import application
```

Consulte [README.txt](README.txt) para
instalação, execução e publicação.
