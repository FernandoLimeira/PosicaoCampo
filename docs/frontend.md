# Organização do frontend

## Análise do antigo monólito

O `index.html` reunia painel, relatórios e retornos, além dos formulários de
setores, histórico, usuários e sacarose em modais. O `app.js` combinava seus
estados, eventos, consultas HTTP e geração de imagens; a folha `style.css`
também misturava todos os módulos. Mover apenas o arquivo HTML para
`templates/` não resolvia essa dependência entre as telas.

Isso aumentava o custo das alterações: uma mudança em um módulo podia afetar
outro, eventos dependiam de elementos de várias telas presentes no mesmo DOM
e todas as funcionalidades eram carregadas mesmo quando não eram utilizadas.
A primeira extração da Sacarose, com cabeçalho e tema próprios, ainda deixava
o layout duplicado.

A separação é adequada porque são áreas com formulários, estado e tarefas
independentes. O painel e seus diálogos de edição/exportação continuam juntos,
pois esses diálogos fazem parte da mesma operação. Da mesma forma, o detalhe
de produtividade fica em Relatórios e o editor de layouts fica em Retornos.
Não é necessário transformar cada diálogo em uma página.

## Layout centralizado

`templates/base.html` é o único documento que declara a estrutura global:
`html`, `head`, `body`, menu, identificação do usuário, área principal
e notificações. As páginas usam `{% extends "base.html" %}` e preenchem os
blocos `title`, `styles`, `content`, `modals` e `scripts`. O filtro fixo de
unidade e a navegação agrupada ficam no layout, sem rodapé institucional.
O login preenche `public_content`, sem mostrar a navegação autenticada.

Para alterar o menu ou a estrutura de todas as telas, edite `base.html`.
Para alterar cores, fonte, dimensões do menu, componentes e responsividade
globais, edite `static/css/base.css`. Não é necessário colocar CSS inline
dentro do HTML para centralizar o design.

Botões de ação e links com aparência de botão (`modal-button` e
`excel-page-back`) compartilham a centralização horizontal e vertical em
`base.css`. O alinhamento à esquerda dos itens da navegação lateral é preservado.

`static/js/common.js` concentra sessão, requisições HTTP, escape de texto,
diálogos e notificações. As páginas não precisam importar o JavaScript do
painel nem conter elementos de outros módulos.

## Mapa de páginas

| URL | Template | CSS específico | JavaScript específico |
| --- | --- | --- | --- |
| `/` | `index.html` | `dashboard.css` | `export.js`, `app.js` |
| `/sacarose` | `sacarose.html` | `sacarose.css` | `export.js`, `sacarose.js` |
| `/emitir-posicao-global` | `emissao.html` | `emissao.css` | `export.js`, `emissao.js` |
| `/setores` | `setores.html` | `setores.css` | `setores.js` |
| `/relatorios` | `relatorios.html` | `relatorios.css` | `relatorios.js` |
| `/retornos` | `retornos.html` | `retornos.css` | `return-analysis.js` |
| `/historico` | `historico.html` | `historico.css` | `historico.js` |
| `/usuarios` | `usuarios.html` | `usuarios.css` | `usuarios.js` |
| `/usuarios/cadastro` | `usuario_cadastro.html` | `usuarios.css` | `usuarios.js` |
| `/login` | `login.html` | `auth.css` | `login.js` |

Relatórios e Retornos também compartilham `reports-common.css`, que contém
seus componentes visuais reutilizados. Nenhum dos dois importa o CSS
exclusivo do outro. `style.css` é somente um agregador de compatibilidade:
os templates novos não o carregam.

Essa é uma aplicação de múltiplas páginas: navegar entre módulos faz uma
requisição de documento HTML, sem o antigo alternador de telas escondidas.
URLs podem ser abertas diretamente. Rascunhos em memória de um formulário
não são persistidos automaticamente ao sair de sua página.

## Relatórios e unidade

O grupo **Relatórios** contém Posição de Campo, Sacarose, Acontecimentos de
produtividade por frota e operador e Análise de mudanças de área. Cadastro
de setores, Histórico, Usuários (somente administrador) e Emitir posição
global ficam fora desse grupo. Relatórios inicia sempre fechado e abre um
submenu flutuante à direita ao clicar. Não tem botão X: fecha no segundo
clique em Relatórios, ao clicar fora ou pressionar Escape. Não expande os itens da barra
lateral. Em telas sem espaço à direita, o submenu é ajustado para permanecer
dentro da tela. As URLs existentes foram preservadas.

Usuários também abre um submenu à direita, fechado por padrão, com
**Cadastrar usuário** e **Usuários cadastrados**. A primeira opção abre
um formulário próprio em `/usuarios/cadastro`; a segunda mantém a busca,
listagem e ações de gerenciamento em `/usuarios`. Apenas um submenu fica
aberto por vez. O grupo inteiro é exclusivo do administrador.

O cadastro pela tela inclui somente Coordenador e Analista, unidade base,
e-mail opcional e situação (ativo/desativado). A listagem exibe esses dados
e permite ativar/desativar outras contas. Coordenadores e analistas têm o
mesmo acesso padrão do antigo perfil Usuário; só administradores gerenciam
contas. Não há envio de e-mails nem recuperação de senha por e-mail nesta versão.

A opção Administrador não está disponível no formulário e o `POST /api/users`
rejeita `role=admin`, inclusive para administradores autenticados. Novos
administradores só são criados pelo utilitário local `python -m backend.create_admin`.

Na consulta, cada administrador vê a própria conta e os usuários não
administradores; os demais administradores ficam ocultos. A filtragem ocorre
na consulta ao banco, antes da resposta HTTP, e as rotas de alteração também
bloqueiam outros administradores por ID. O frontend reforça a ocultação, sem
substituir a proteção no servidor. As contas e os registros de autoria não
são excluídos para implementar essa regra.

O título estilizado Posição de Campo fica no topo, acima de Unidade.
A unidade é o primeiro controle lateral, seguida das opções de navegação
com ícones SVG brancos à esquerda. A saudação com o nome da conta, a data,
o relógio e Sair ficam no rodapé lateral. Usuário e Sair também têm ícones.
O rodapé institucional continua
removido. Os ícones são centralizados em `templates/partials/icons.html`.
O recuo e o espaçamento do menu são centralizados nas variáveis CSS
`--nav-item-inset` e `--nav-item-gap`. Unidade, primeiro botão, ícones,
saudação e Sair compartilham a mesma coluna de alinhamento.

`common.js` mantém a unidade em `?unit=PPT|NRD|RBR|PST` e no armazenamento
da aba. O parâmetro válido na URL prevalece. O filtro permanece visível no
menu com quatro botões (PPT, NRD, RBR e PST); mudar a unidade atualiza a tela sem recarregar, preservando rascunhos
de Sacarose em memória. A análise de mudanças de área limpa o resultado
anterior quando a unidade muda e não exibe uma resposta atrasada de outra
unidade. O Histórico também segue o filtro lateral.

O armazenamento de seleção é separado por ID da conta. Após login, o
sistema abre a unidade base cadastrada; abrir a página inicial sem unidade
explícita também começa nela (inclusive com sessão lembrada). Links internos
mantêm a unidade escolhida e as quatro opções continuam disponíveis.

O relatório de produtividade filtra indicadores, frotas, operadores e linha
do tempo pela unidade do arquivo (sigla ou nome). Registros sem unidade ou
sem correspondência não são atribuídos automaticamente à unidade selecionada.
O processamento não soma agrupamentos de unidades diferentes, e a regra de
equipe (dois dias na mesma frente e semana) considera a unidade também.

Posição de Campo emite um PNG HD somente da unidade selecionada, buscando
sua posição salva no servidor. Sacarose emite um PNG HD da unidade do
formulário, incluindo seu rascunho e respeitando **Não exibir**. A emissão
global tem página própria e busca a posição salva das quatro unidades,
independentemente do filtro. Nenhuma emissão salva ou altera dados.

A saudação usa o horário do navegador: Bom dia entre 05h e 11h59, Boa tarde
entre 12h e 17h59 e Boa noite entre 18h e 04h59. Relógio, data e saudação
atualizam a cada segundo usando o horário do navegador, sem recarregar.

## Renderização e acesso

`backend/views/templates.py` configura Jinja2 com escape automático e gera o
HTML completo no servidor. `PAGE_ROUTES`, no controller, associa as URLs aos
templates e ao item ativo do menu. Não há um segundo servidor de frontend e
o ponto WSGI continua sendo `from backend.app import application`.

Todas as páginas de módulos exigem sessão. `/usuarios` e `/usuarios/cadastro`
também verificam a permissão administrativa no servidor, além de ocultar seu submenu para usuários
comuns. Os arquivos-fonte dos templates não são servidos como conteúdo
estático. As APIs, as tabelas e o armazenamento existentes foram mantidos.

## Adicionar uma página

Crie um template com a herança e os blocos necessários:

```jinja2
{% extends "base.html" %}
{% block title %}Novo módulo · Posição de Campo{% endblock %}
{% block styles %}
  <link rel="stylesheet" href="/css/novo-modulo.css?v={{ asset_version }}" />
{% endblock %}
{% block content %}
  <section aria-labelledby="module-title">
    <h1 id="module-title">Novo módulo</h1>
  </section>
{% endblock %}
{% block scripts %}
  <script src="/js/novo-modulo.js?v={{ asset_version }}"></script>
{% endblock %}
```

Adicione sua URL em `PAGE_ROUTES`, seu link no menu de `base.html` e testes
de acesso e renderização. Recursos específicos ficam em `static/css` e
`static/js`. Para invalidar versões anteriores dos recursos no navegador,
atualize `ASSET_VERSION` em `backend/views/templates.py` ao publicar mudanças.

## Publicação e validação

Instale o `requirements.txt` atualizado, que inclui Jinja2, no ambiente Python
usado pelo servidor. O WSGI do PythonAnywhere não precisa mudar. Se o painel
de hospedagem possui mapeamentos estáticos próprios, atualize os destinos
para `static/css`, `static/js` e `static/assets`, mantendo suas URLs públicas.
Nunca publique `templates/` como arquivos estáticos nem substitua os bancos
`data/usuarios.db` e `data/dados.db` durante uma atualização. A divisão do
banco e a migração do formato antigo estão descritas em `databases.md`.

`tests/test_pages.py` verifica herança, assets, isolamento dos módulos, ordem
dos scripts, autenticação, acesso administrativo direto, escape de HTML e
proteção dos arquivos-fonte, usando um banco temporário. Essa validação de
estrutura não substitui testes completos das importações de planilhas ou
das regras de negócio de cada módulo.
