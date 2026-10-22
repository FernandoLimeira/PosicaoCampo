# Acompanhamento das frentes no dashboard

Na coluna **Observações**, clique em **Adicionar observação** ou nos pontos já
exibidos. O botão **Ver detalhes** abre o mesmo acompanhamento da frente.

- Registre ocorrências, ações necessárias e previsões em texto livre.
- Marque **Destacar este ponto na coluna Observações** para manter a informação
  visível na tabela. Desmarque para salvar somente no histórico.
- A tabela mostra os três pontos em aberto mais recentes e informa quantos
  outros existem. Os textos completos ficam nos detalhes.
- Use **Concluir ponto** quando a ação terminar. O registro continua no histórico
  e pode ser reaberto. O histórico permite carregar registros anteriores.
- A aba **Histórico** também reúne os acontecimentos das frentes com as
  atualizações da posição, em ordem de data. O nome do analista fica destacado,
  junto da unidade, frente, setor, horário e texto completo. Concluir um ponto
  não remove o acontecimento do histórico. O acesso à aba segue a permissão
  de consulta do módulo **Histórico**.
- Os analistas compartilham o acompanhamento da mesma unidade e frente. A
  tabela consulta atualizações a cada 30 segundos enquanto visível e ao voltar
  à janela, sem substituir o formulário em edição.

Os acessos seguem as permissões de consulta e edição do módulo **Posição de
Campo**, verificadas também no servidor. A chave do acompanhamento é unidade
e frente; o setor no momento do lançamento fica registrado no histórico,
inclusive quando a frente muda de setor. Uma tela com setor desatualizado não
pode registrar uma observação sem atualizar a posição.

Os apontamentos ficam na base operacional, com autor e data para consulta no
histórico. A coluna da tabela apresenta apenas os textos dos pontos. Esse
acompanhamento não modifica o status oficial ou os lançamentos da Produção
Agrícola. Para alimentar a observação da imagem, revise e salve no formulário
da unidade, conforme o fluxo abaixo.

## Revisão para a imagem e turnos

O servidor classifica os acontecimentos pelo horário de Brasília:

| Turno | Intervalo |
| --- | --- |
| A | 00:00 até antes de 07:20 |
| B | 07:20 até antes de 15:40 |
| C | 15:40 até antes de 00:00 do dia seguinte |

À meia-noite começa o turno A da nova data. Registros antigos recebem a data
e o turno correspondentes ao horário original, sem alterar o texto ou autor.

1. Abra **Preencher** e vá à etapa **Observações e mudanças**.
2. Consulte os **Acontecimentos do turno** da unidade. A primeira consulta usa
   o turno atual; é possível escolher uma data e um turno anteriores.
3. Revise a sugestão, organizada por frente e setor, sem nomes de analistas.
   Ela inclui os acontecimentos concluídos e os que ficaram só no histórico.
   Textos idênticos da mesma frente e setor aparecem uma vez na sugestão;
   todos os registros originais continuam no histórico.
4. Clique em **Usar texto revisado na observação**. Isso substitui o texto
   apenas no formulário, sem salvar ou modificar a imagem automaticamente.
5. Revise e salve a atualização. A emissão passa a usar essa observação
   oficial, e o histórico da atualização conserva o período consultado.

A consulta vazia ou com erro preserva a observação atual. Textos acima do
limite de 10.000 caracteres precisam de revisão antes da aplicação; não são
cortados. O layout da emissão permanece com a estrutura existente.

## Testes

```powershell
python -m unittest tests.test_front_notes tests.test_pages.PageTests.test_field_front_notes_http_flow_and_module_permissions
node tests/test_front_notes.js
node tests/test_history.js
python -m unittest tests.test_operational_shifts
node tests/test_shift_review.js
```
