# Integração dos arquivos de análise de mudanças de área

Os oito arquivos de `ARQUIVOS_ALTERADOS_RETORNOS.zip` foram conciliados com a
versão local, mantendo a geração de apresentações no modelo CTT. Não foi
realizado merge remoto ou push. O ZIP fornecido não foi alterado.

## Alterações incorporadas

- Botão **Atualizar apontamentos** aceita XLSX, XLSM e XLS de solo úmido.
- Apontamentos ficam no banco operacional `dados.db`, separados por unidade.
  Importações repetidas atualizam registros existentes, sem duplicação pela chave.
- A frente é determinada pelos equipamentos de seus layouts, não pelo texto
  do grupo na planilha. Uma unidade identificada divergente é rejeitada.
- A linha do tempo diária identifica retornos mesmo quando outras frentes
  mantiveram a colheita contínua do setor. Empates não viram atribuições exclusivas.
- As tabelas mostram seção/fazenda e quem trabalhou no setor durante a ausência.
  Cadastros ausentes ou ambíguos são sinalizados sem escolha automática.
- Pela regra fornecida, a confirmação de solo úmido exige maioria estrita dos
  equipamentos cadastrados com duração positiva de apontamento em cada dia
  da interrupção. Pode haver apontamentos em outros setores, exibidos como
  evidência. Isso não significa comprovação de uma parada de 24 horas.
- As horas são somadas por equipamento; não representam o tempo corrido de
  parada de toda a frente. Registros que atravessam meia-noite permanecem
  associados à data operacional de início, conforme a base importada.
- Casos confirmados ficam fora do resumo de mudanças, mas permanecem na tabela
  de auditoria e na apresentação. Mudanças reais de área não são removidas
  por apontamentos de solo úmido.

## Compatibilidade e publicação

A inicialização cria a nova tabela e seus índices de forma aditiva e
idempotente. Preserva contas, senhas, sessões, layouts, históricos e dados
anteriores; não recria nem substitui os bancos. Os bancos locais não foram
alterados para executar os testes: a migração foi validada em bancos temporários.

Publique os arquivos atualizados, incluindo `backend/services/soil_wet_import.py`
e os modelos existentes em `templates/presentations/`. Preserve os dois bancos
do servidor. Depois recarregue a aplicação no PythonAnywhere e atualize o
navegador com Ctrl+F5. Não há nova dependência no `requirements.txt`.

A apresentação reprocessa a mesma planilha com as bases atuais. Se o resultado
mudou, retorna HTTP 409 e solicita nova análise. A interface bloqueia operações
simultâneas de importação, análise e apresentação e descarta respostas de uma
unidade anterior.

## Validação

```powershell
python -m unittest discover -s tests -v
node tests/test_return_presentation.js
node tests/test_reports.js
node tests/test_users.js
node tests/test_login.js
```

Os testes cobrem migração, preservação de dados/sessões, isolamento de unidades,
importação real XLSX, reimportação, rollback, maioria diária, empates, cadastro
ambíguo, autenticação/origem, tabelas e consistência da apresentação.
