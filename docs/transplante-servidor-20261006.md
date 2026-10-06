# Banco do servidor transplantado para o projeto local

## Resultado

A origem foi o arquivo `posicao_campo.db` enviado em 06/10/2026. Ele foi
aberto somente para leitura, conferido e convertido para o formato atual
da aplicação. O arquivo original em Downloads não foi modificado.

| Conteúdo | Banco atual | Quantidade |
| --- | --- | ---: |
| Usuários (incluindo o administrador local acrescentado) | `data/usuarios.db` | 10 |
| Sessões ainda válidas na migração | `data/usuarios.db` | 2 |
| Unidades | `data/dados.db` | 4 |
| Histórico de alterações | `data/dados.db` | 269 |
| Cadastro de setores | `data/dados.db` | 1.096 |
| Registros de sacarose | `data/dados.db` | 30 |

As contas, os hashes das senhas, IDs, autores, datas e versões dos dados
foram preservados. O banco enviado possui um administrador e oito usuários
padrão. Não foram atribuídos níveis de coordenador ou analista sem uma
definição do administrador.

Após o transplante, foi acrescentado o login `zordnarog`, administrador
ativo com unidade base PPT e e-mail ainda não informado. A senha fornecida
foi armazenada somente como hash; não consta neste documento. As nove
contas do servidor e o administrador original foram mantidos. O ZIP para
publicação foi atualizado para incluir a nova conta.

Os novos campos de perfil foram acrescentados: e-mail vazio e unidade base
PPT para as contas existentes, pois esses dados não constavam na origem.
Os três novos níveis de cadastro já são suportados pelo banco atualizado.

Das cinco sessões na origem, três já estavam expiradas e foram descartadas
pela limpeza normal da aplicação. A cópia integral da origem mantém todas.
Nenhuma senha foi redefinida: o acesso usa as contas e senhas do servidor.

O banco antigo não possuía tabelas de layouts da análise de mudanças de
área. Foi aplicada a carga inicial normal do projeto: seis frentes e vinte
equipamentos em PPT. Os nomes canônicos das quatro unidades foram
normalizados, incluindo a grafia de Paraguaçu Paulista, sem alterar os
apontamentos, datas ou versões. O histórico original foi preservado.

## Arquivos para publicar

Os arquivos em uso local são:

- `data/usuarios.db`
- `data/dados.db`

O ZIP `data/transplantes/servidor-20261006-100634/bancos-ajustados.zip`
contém somente `usuarios.db` e `dados.db`, prontos para extrair na pasta
`data` da aplicação hospedada. Esse ZIP é um retrato da transferência;
alterações locais posteriores não atualizam automaticamente seu conteúdo.

1. Atualize o código do projeto junto com os dois bancos.
2. Interrompa gravações e processos da aplicação hospedada antes de trocar
   os bancos; não publique os arquivos enquanto houver gravações em curso.
3. Preserve uma cópia recuperável dos arquivos que estiverem no servidor.
4. Extraia os dois arquivos do ZIP na pasta `data` da raiz do projeto,
   substituindo **ambos** os bancos anteriores. Não publique apenas um:
   eles possuem a mesma identificação de migração e precisam formar um par.
5. Reinicie/recarregue a aplicação e confira login, as quatro unidades,
   cadastro de setores, sacarose e histórico.

O ponto WSGI continua `from backend.app import application`. O diretório
adicionado ao `sys.path` deve ser a raiz atual do projeto, que contém
`backend`, `templates`, `static` e `data`.

Não substitua os bancos ajustados pelo antigo `posicao_campo.db`. O legado
pode ser mantido para retenção, mas o sistema atual utiliza o par já
migrado. Não publique a pasta de recuperação, `.venv`, `.git` ou arquivos
locais de diagnóstico, e nunca exponha `data` como diretório estático.

O conjunto representa o arquivo enviado, não alterações que tenham
acontecido no servidor depois da extração desse arquivo. Antes da
publicação definitiva, evite descartar registros mais recentes do servidor.

## Recuperação local

O estado local anterior está preservado em:

`data/transplantes/servidor-20261006-100634/local-anterior/`

Essa pasta contém os dois bancos locais anteriores, com suas contas,
senhas, sessões e dados. Para restaurá-los, encerre a aplicação e restaure
os dois arquivos juntos na pasta `data`. O banco legado local anterior
e os arquivos antigos de backup também não foram apagados.

Esta é uma cópia manual pontual para a transferência, não a reativação de
um sistema de backups automáticos. A pasta `data/transplantes` está
ignorada pelo Git para não versionar dados e credenciais.

## Validação realizada

- Integridade SQLite e chaves estrangeiras na origem e nos destinos.
- Conferência dos registros de cada tabela, IDs, autoria e sequências de IDs.
- Preservação dos hashes de senha e dos perfis existentes.
- Aplicação local transacional nos dois bancos, com rollback em caso de erro.
- Conferência exata dos bancos locais após a confirmação da transação.
- Páginas e APIs do projeto testadas com uma cópia temporária dos dados,
  incluindo controle administrativo de acesso.

SHA-256 do arquivo original recebido:

`c1687266dc99470cebc7fc5fcc6f4cb885170f30cfbfa075db6a2a522233104c`
