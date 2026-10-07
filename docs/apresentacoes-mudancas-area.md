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
fontes Calibri/Calibri Light seguem o modelo fornecido. A apresentação sempre
mantém a capa, a abertura de seção, o sumário com os itens a serem discutidos
e o encerramento do CTT, inclusive quando não há retornos ou rastros selecionados.
Os layouts adicionais de conteúdo continuam no modelo, sem gerar páginas vazias.

Após a capa, a abertura de seção e o sumário, vêm os indicadores, as tabelas
de até oito retornos por slide, os destaques/conferências e os espaços de
rastro escolhidos. O encerramento original do CTT é sempre a última página.
O sumário acompanha a seleção: sem rastros, apresenta discussão dos resultados;
sem retornos, informa a ausência de ocorrências, sem prometer uma tabela vazia.
Somente o conteúdo da análise é compactado; os slides estruturais não são removidos.
O quarto slide reutiliza o layout CTT de dois blocos: retornos de setor e
presença de outra frente em área já iniciada. Essa presença considera a atuação
no mesmo setor durante a ausência da frente analisada, não o total genérico
de períodos de outras frentes. Paradas/interrupções e empates não aparecem
nesse slide; as evidências completas permanecem no relatório e nas notas.
O slide **Destaques e conferências** contém somente o tópico **Retornos e
ocupação**, com os três menores intervalos e evidências de outra frente no
mesmo setor durante a ausência. O tópico de paradas/qualidade dos dados foi
removido desse slide, sem remover as evidências das notas.
Quando a frente informada na base corresponde à frente analisada, mas o
equipamento pertence ao layout de outra frente, o destaque informa esse
cruzamento. As notas e o relatório conservam datas, valores originais da
coluna de frente e equipamentos correspondentes. A comprovação usa somente
equipamentos da frente que recebeu a atribuição diária, sem incluir frotas
desconhecidas ou de outra frente por engano. Sem frente informada ou com
referência ambígua, não presume a frente da entrada de cana. Esses registros
não comprovam autorização de colheita nem conclusão da área.
Cada retorno aparece uma vez na tabela, incluindo repetições do mesmo setor,
com fazenda, data da última colheita, data do retorno e dias fora. Nomes muito
longos são abreviados apenas no slide; as notas conservam o cadastro integral.
Como evidência extra, a coluna **Talhões no retorno** informa se a frente
trabalhou somente talhões da sua última permanência, talhões diferentes ou
talhões em comum e diferentes. A comparação considera os registros da frente
selecionada nos dois períodos do mesmo setor, respeitando a atribuição diária.
Não usa talhões de outra frente para comprovar a recorrência da frente analisada.
Sem a coluna TALHÃO, mostra “Não informado”; com registros incompletos, mostra
“Dados parciais”, sem concluir que os talhões eram diferentes. As listas
completas, os talhões em comum e os períodos comparados ficam no relatório
e nas notas. Essa informação não altera a regra nem a quantidade de retornos.
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
Cada setor selecionado reúne suas passagens em ordem cronológica. O slide
mostra a **Primeira passagem** e a **Segunda passagem** em dois espaços de
imagem lado a lado. Quando existe uma terceira passagem, usa três espaços
lado a lado. Cada imagem tem o período correspondente e a instrução para
inserir o rastro daquele setor e passagem. Selecionar mais de um retorno do
mesmo setor não duplica a comparação. Havendo mais de três passagens, gera
continuações com até três imagens por slide; uma passagem isolada compara
com a passagem anterior. Todas as passagens identificadas do setor escolhido
aparecem, independentemente de qual retorno desse setor foi selecionado.
A primeira passagem é a primeira encontrada no histórico importado, não
uma afirmação sobre o início da safra. Retornos reais separam as passagens;
interrupções sem trabalho em outro setor não criam novas passagens. Os
períodos vêm dos registros da frente analisada, não de imagens presumidas.

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

O modelo e o preenchimento não usam `horzOverflow="wrap"`, que é inválido
no OOXML e fazia o PowerPoint pedir reparo. O gerador também normaliza esse
valor em modelos antigos, preservando a quebra de texto em `bodyPr.wrap`.
Antes do download, verifica XML, referências internas, identificadores
duplicados e valores de overflow. Uma inconsistência detectada bloqueia a
exportação, em vez de entregar um arquivo estruturalmente inválido. Esse
controle não substitui a validação completa de esquema pelo SDK Microsoft.

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
