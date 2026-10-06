# Apresentações da análise de mudanças de área

O botão **Gerar apresentação**, no final de `/retornos`, baixa um PowerPoint
editável usando a análise atual da unidade e frente selecionadas. Fica
desabilitado até o processamento concluir. Trocar unidade, frente, arquivo
ou dias mínimos invalida o resultado e exige novo processamento. Atualizar
os apontamentos de solo úmido também invalida a análise anterior.

## Modelo padrão

- `templates/presentations/apresentacao_ctt.pptx`: cópia integral do modelo
  **Apresentacao CTT.pptx** fornecido, sem alterar o arquivo em Downloads.
- `templates/presentations/ctt_analise_template.pptx`: variante preparada com
  campos editáveis nomeados `ctt:...`, conservada como referência anterior.
- `templates/presentations/ctt_compact_template.pptx`: modelo padrão atual,
  com tabelas nativas e espaços de imagem editáveis. Os campos e layouts foram
  preparados e conferidos com Artifact Tool.

O formato é 16:9, 12192000 × 6858000 EMU. O design, logos, fundos, tema e
fontes Calibri/Calibri Light seguem o modelo fornecido. O gerador utiliza
os layouts de três indicadores, tabela, dois blocos e rastros.
Os outros layouts permanecem disponíveis no modelo, mas não são incluídos
na apresentação baixada como slides vazios.

O arquivo é objetivo: um resumo com indicadores, tabelas de até oito retornos
por slide, um slide de destaques/conferências e os espaços de rastro escolhidos.
Cada retorno aparece uma vez na tabela, incluindo repetições do mesmo setor,
com fazenda, data da última colheita, data do retorno e dias fora. Nomes muito
longos são abreviados apenas no slide; as notas conservam o cadastro integral.
O relatório completo continua na página e nas notas do apresentador. Os detalhes
dos retornos, interrupções e evidências de solo úmido também ficam nas notas.
Assim não se criam dezenas de slides de texto ou de continuação.

Sem apontamentos suficientes, a interrupção permanece pendente, sem confirmar
sua causa. Paradas confirmadas não entram como mudanças de área. Os dias fora
são intervalos entre colheitas, não uma afirmação de parada integral da frente.
O limite é 150 slides; ao excedê-lo, processe um período menor.

## Rastros de colheita

Após processar, escolha no final da página quais retornos receberão um espaço
de rastro (até seis). Por padrão, são selecionados os três maiores intervalos
de setores distintos. Desmarque todos para baixar somente o resumo compacto.
Cada espaço mostra setor, fazenda, última colheita e data do retorno, com a
instrução “Inserir rastro do setor … em … aqui”. A data sugerida é a do retorno
selecionado, não uma data extraída ou presumida de uma imagem.

Insira a imagem original no PowerPoint, no espaço de imagem do slide, mantendo
a proporção, legenda, escala e período do mapa. A instrução é editável caso o
rastro cubra outro intervalo. O sistema não recebe nem armazena as imagens;
elas são incluídas manualmente na apresentação baixada. Não são gerados rastros
fictícios nem atribuídas capturas genéricas a um setor.

## API e consistência

`POST /api/return-analysis/analyze` retorna `report` e `report_digest`.
`POST /api/return-analysis/presentation` recebe o mesmo multipart `file` e
os parâmetros `unit`, `front`, `min_gap` e `digest` da análise concluída.
`traces=none` omite os espaços; `traces=0,2,5` seleciona índices de ocorrências
na lista `report.returns`. Sem esse parâmetro, vale a seleção padrão. O servidor
valida quantidade, duplicações e existência dos índices na análise reprocessada.

A exportação exige sessão ativa e respeita a verificação de origem. Todos
os perfis autorizados a analisar podem exportar. O servidor reprocessa o
arquivo com os layouts, a base de setores e os apontamentos da unidade e compara o SHA-256 do resultado com o
da análise exibida. Diferenças retornam HTTP 409, pedindo nova análise.
O digest é um controle de consistência, não uma assinatura/autorização.
O cliente não envia totais ou conclusões para montar slides.

O download retorna o MIME de PPTX, `Content-Disposition: attachment` e
`Cache-Control: no-store`. Arquivos, resultados e apresentações permanecem
em memória. A exportação não altera bancos nem implementa armazenamento
ou backups. Modelos ficam fora dos diretórios estáticos públicos.

## Execução e publicação

Não há nova dependência em `requirements.txt`: o preenchimento e a montagem
do pacote usam apenas a biblioteca padrão Python. Não exige Node, PowerPoint,
LibreOffice ou um serviço externo no PythonAnywhere.

Publique **também `templates/presentations/`**, junto do serviço, controller,
template HTML, CSS e JavaScript atualizados, e recarregue a aplicação Web.
Atualize a página com Ctrl+F5. Não substitua os bancos por causa desta função.

## Verificação

```powershell
python -m unittest discover -s tests -v
node tests/test_return_presentation.js
```

Os testes usam resultados sintéticos/bancos temporários e verificam conteúdo,
todas as ocorrências nas tabelas, notas completas, editabilidade, seleção de
rastros, preservação das imagens, relações internas
do PPTX, tamanho, autenticação, origem, consistência e estados do botão.
As amostras também foram renderizadas e comparadas ao modelo. Renderização
e validação de pacote não substituem um teste de abertura no PowerPoint.
