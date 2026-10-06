# Separação dos bancos

| Arquivo | Responsabilidade | Tabelas de negócio |
| --- | --- | --- |
| `data/usuarios.db` | Autenticação e permissões | `users`, `sessions` |
| `data/dados.db` | Dados operacionais e suporte aos processamentos | `units`, `unit_history`, `sector_base`, `sacarose_positions`, `return_analysis_fronts`, `return_analysis_equipment` |

Os níveis são representados em `users.role`: `admin` (Administrador),
`coordinator` (Coordenador) e `analyst` (Analista). Contas antigas com `user`
continuam como Usuário padrão. Somente `admin` gerencia contas; os demais
níveis têm o mesmo acesso padrão às quatro unidades. As sessões ficam junto
das contas, com sua chave estrangeira interna e exclusão automática quando
a conta é removida.

`users.email` armazena o e-mail opcional, validado quanto ao formato, mas não
verificado nem utilizado para login ou envio de mensagens. `users.base_unit`
define PPT, NRD, RBR ou PST como unidade inicial, sem restringir acesso às
demais. Ao iniciar a versão atual, a migração aditiva acrescenta os dois
campos ausentes com valores padrão (e-mail vazio e PPT), mantendo IDs,
senhas, perfis e sessões. É transacional e pode ser executada novamente.

O cadastro permite contas ativas ou desativadas. Na listagem, cada administrador
vê somente a própria conta administrativa e as contas não administrativas.
Outros administradores, ativos ou desativados, não são retornados pela API.
Administradores podem ativar/desativar contas não administrativas. Desativar
revoga as sessões e impede novos logins; reativar exige novo login. A própria
conta e todas as outras contas administrativas são protegidas contra alteração,
redefinição de senha e exclusão pelas rotas de gerenciamento, mesmo por ID direto.
Consequentemente, o último administrador ativo também não pode ser desativado.
O utilitário local
`python -m backend.create_admin` recupera a conta indicada sem rebaixar
outros administradores ou sobrescrever seus dados de perfil.

Novos administradores não podem ser criados pelo cadastro web nem pelo
`POST /api/users`. O formulário permite apenas Coordenador e Analista,
enquanto a criação administrativa permanece restrita ao utilitário local.

Os serviços de análise de Excel e retornos continuam processando uploads em
memória e retornando seus resultados, como antes. Esta alteração separa a
persistência existente; não passa a arquivar planilhas ou resultados que
antes não eram armazenados.

## Sistema de backup removido

Foram removidos a rotina automática, o intervalo e a retenção configurados,
as chamadas antes de salvar dados e ao iniciar, a rota de backup manual,
o botão do Histórico e sua lógica JavaScript. O Histórico de alterações
continua existindo: ele não é uma cópia de segurança do banco.

A pasta antiga `data/backups`, se já existir, e seus arquivos não são
excluídos. Eles deixam de ser utilizados ou limpos pelo sistema. Também não
é criada uma nova rotina de cópias como parte da divisão dos bancos.

## Migração inicial

1. Encerre as instâncias da versão antiga antes de iniciar a nova.
2. Na primeira inicialização, os schemas novos são criados e o arquivo
   `data/posicao_campo.db`, se existir, é aberto somente para leitura.
3. Os registros são transferidos para os arquivos correspondentes mantendo
   IDs, hashes de senha, perfis, sessões e versões dos dados.
4. A migração confere os registros de cada tabela, os contadores de IDs,
   a integridade SQLite, as chaves estrangeiras internas e os IDs de autoria.
5. Os dois arquivos recebem a mesma identificação de migração e só são
   confirmados juntos depois das verificações. Uma falha desfaz as gravações
   da migração; o arquivo original não é apagado nem atualizado.

Reinicializações posteriores não importam novamente o legado e não
ressuscitam contas excluídas ou sobrescrevem dados novos. O arquivo antigo
permanece apenas para retenção, sem receber as próximas alterações.

Uma base legada com tabelas/colunas desconhecidas ou integridade inválida
interrompe a migração, em vez de descartar dados silenciosamente. Um par
incompleto ou de origens diferentes também impede a inicialização: nunca
se cria uma base de usuários vazia para substituir uma base perdida.

## Autoria e transações

SQLite não permite chaves estrangeiras entre arquivos diferentes. Os
campos `updated_by` e `user_id` permanecem nos dados, sem copiar usuários
ou hashes de senha para `dados.db`. As consultas de autoria utilizam
`ATTACH` de `usuarios.db` como schema `auth` e joins explícitos.

As gravações com autoria validam a existência do usuário na mesma transação.
Ao excluir uma conta, o sistema limpa suas referências de autoria nos dados
e remove a conta e suas sessões em uma transação conjunta, preservando os
registros operacionais. Isso mantém o comportamento do antigo `ON DELETE
SET NULL`, sem chaves estrangeiras falsas apontando para tabelas ausentes.

Os dois bancos usam journal `DELETE` e sincronização `FULL`, permitindo
confirmação conjunta dos arquivos anexados. Não configure WAL nesses bancos
sem redesenhar as transações entre arquivos. Essa escolha segue a garantia
de atomicidade documentada pelo [SQLite](https://www.sqlite.org/lang_attach.html).

Não manipule referências ou contas diretamente com ferramentas externas:
as referências entre arquivos são mantidas pela camada de persistência.
Preserve os dois arquivos juntos e não substitua apenas um deles por uma
cópia de outra data, mesmo quando pertençam à mesma identificação inicial.

## Execução e hospedagem

O comando de inicialização e o import WSGI não mudam. No PythonAnywhere,
as alterações também ficam no diretório `data` da aplicação hospedada,
independentemente dos bancos utilizados no Windows local. A atualização
deve impedir que processos da versão antiga continuem usando o banco único
enquanto processos novos passam a usar os dois arquivos.

Os caminhos estão em `backend/config.py`. Cada arquivo deve ter um caminho
diferente, e o processo Python precisa de permissão de escrita na pasta
para as transações SQLite. Os bancos não são arquivos estáticos públicos.

## Testes

```powershell
# Executar na raiz PosicaoCampo
& '.\.venv\Scripts\python.exe' -m unittest discover -s tests -v
```

A suíte utiliza diretórios temporários. Ela valida separação física,
migração sem alteração do legado, IDs e sessões preservados, idempotência,
recusa de migrações incompletas, autenticação, mutações operacionais,
revogação de sessões, exclusão de usuários, rollback entre arquivos e
remoção da API e da interface de backup.
