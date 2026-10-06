# Apresentações da análise de mudanças de área

O botão **Gerar apresentação**, no final de `/retornos`, baixa um PowerPoint
editável usando a análise atual da unidade e frente selecionadas. Fica
desabilitado até o processamento concluir. Trocar unidade, frente, arquivo
ou dias mínimos invalida o resultado e exige novo processamento.

## Modelo padrão

- `templates/presentations/apresentacao_ctt.pptx`: cópia integral do modelo
  **Apresentacao CTT.pptx** fornecido, sem alterar o arquivo em Downloads.
- `templates/presentations/ctt_analise_template.pptx`: variante preparada com
  campos editáveis nomeados `ctt:...`, usada pelo gerador. Os campos e layouts
  foram preparados e conferidos com Artifact Tool.

O formato é 16:9, 12192000 × 6858000 EMU. O design, logos, fundos, tema e
fontes Calibri/Calibri Light seguem o modelo fornecido. O gerador utiliza
os layouts de capa, três indicadores, conteúdo, dois blocos e encerramento.
Os outros layouts permanecem disponíveis no modelo, mas não são incluídos
na apresentação baixada como slides vazios.

O arquivo final contém capa com unidade, frente e período, indicadores,
resumo automático completo, detalhes datados dos retornos e dos casos de
possível solo úmido, e encerramento. O resumo conserva as conclusões do
processamento. Solo úmido permanece uma hipótese a verificar, não uma causa
confirmada. Outros períodos, empates e equipamentos sem cadastro aparecem
nos indicadores e no resumo conforme o resultado existente.

Resumos e listas longas ocupam slides adicionais, sem descartar texto nem
reduzir indefinidamente a fonte. O limite é 150 slides. Ao excedê-lo, o
sistema orienta processar uma planilha com período menor.

## API e consistência

`POST /api/return-analysis/analyze` retorna `report` e `report_digest`.
`POST /api/return-analysis/presentation` recebe o mesmo multipart `file` e
os parâmetros `unit`, `front`, `min_gap` e `digest` da análise concluída.

A exportação exige sessão ativa e respeita a verificação de origem. Todos
os perfis autorizados a analisar podem exportar. O servidor reprocessa o
arquivo com os layouts cadastrados e compara o SHA-256 do resultado com o
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
paginação sem perda, editabilidade, preservação das imagens, relações internas
do PPTX, tamanho, autenticação, origem, consistência e estados do botão.
As amostras também foram renderizadas e comparadas ao modelo. Renderização
e validação de pacote não substituem um teste de abertura no PowerPoint.
