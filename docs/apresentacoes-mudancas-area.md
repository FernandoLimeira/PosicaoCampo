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
de até oito retornos por slide, as ocorrências de execução por outra frente no mesmo
setor, os períodos executados por outras frentes, as interrupções pendentes, as
conferências de cadastro/empate/equipamentos e os rastros escolhidos. O
encerramento original do CTT é sempre a última página. O sumário acompanha a
seleção: sem rastros, apresenta discussão dos resultados; sem retornos, informa
a ausência de ocorrências. Somente o conteúdo da análise é paginado; os slides
estruturais não são removidos.

O quarto slide reutiliza o layout CTT de dois blocos: retornos de setor e
execução de outra frente em área já iniciada. O bloco é executivo; todas as
ocorrências ficam em tabelas próprias, sem corte arbitrário. A identificação da
**frente executora** usa a classificação diária dos equipamentos pelo layout. A
**ordem de corte** vem da frente registrada explicitamente na planilha. Quando a
base informa a frente analisada e o layout identifica equipamentos de outra frente,
o sistema registra **execução por outra frente com a ordem de corte da frente que
deixou o setor**. Isso não é tratado como erro de cadastro. Dias consecutivos só
são agrupados quando continuam com a mesma frente executora e a mesma ordem de
corte, impedindo que uma troca de frente seja transformada em falso empate pela
união de frotas de vários dias.
As tabelas preservam as contagens diárias e os equipamentos usados na decisão.
Tabelas com contagem diária extensa usam até três períodos por slide para
evitar sobreposição de conteúdo.

Cada retorno aparece uma vez na tabela, incluindo repetições do mesmo setor,
com fazenda, data da última colheita, data do retorno e dias fora. Nomes muito
longos são abreviados apenas no slide; as notas conservam o cadastro integral.
Como evidência extra, a coluna **Talhões no retorno** distingue quatro casos:
**Mesmos talhões** quando os conjuntos são idênticos, **Já trabalhados** quando
o retorno usa apenas um subconjunto de talhões anteriores, **Comuns e
diferentes** quando há antigos e novos, e **Talhões diferentes** quando não há
interseção. Sem a coluna TALHÃO, mostra “Não informado”; com registros
incompletos, mostra “Dados parciais”. Essa informação não altera a regra nem a
quantidade de retornos.

Interrupções sem deslocamento continuam visíveis para conferência. Solo Úmido
é confirmado pela maioria dos equipamentos cadastrados da frente em todos os
dias completos do intervalo. O setor do apontamento é contexto e não requisito:
planilhas com Código da Zona vazio continuam válidas, preservando Fazenda e
Talhão quando disponíveis. Se houver maioria em todos os dias, a parada é
confirmada e não entra na contabilização de retornos. Se faltar comprovação em
apenas um dia, mantendo maioria na maior parte do intervalo, a ocorrência fica
como **Solo úmido provável · verificar**; caso contrário permanece como
interrupção sem causa comprovada. Paradas confirmadas continuam disponíveis na
tabela específica do sistema e nas notas, mas não são apresentadas como mudança
de área no resumo executivo.

As conferências de base também são visíveis na apresentação: setores não
cadastrados ou ambíguos, empates de maioria diária e equipamentos sem frente
cadastrada são paginados em vez de ficarem somente nas notas. O relatório
completo continua nas notas do apresentador como trilha de auditoria. O limite
global é de 150 slides; ao excedê-lo, processe um período menor.

## Rastros de colheita

Após processar, escolha no final da página quais retornos receberão um espaço
de rastro. Não há limite fixo de retornos selecionados; o limite global de 150
slides continua protegendo a geração de apresentações excessivamente grandes. Por
padrão, são selecionados os três maiores intervalos de setores distintos. Desmarque todos para baixar somente o resumo compacto.
Cada setor selecionado reúne suas passagens em ordem cronológica. O slide
mostra até três passagens lado a lado. Quando o total deixaria uma única
passagem isolada na última página, a distribuição é rebalanceada sem repetir
períodos: quatro passagens viram **2 + 2**, sete viram **3 + 2 + 2**, e assim
por diante. Cada imagem tem o período correspondente e a instrução para inserir
o rastro daquele setor e passagem. Selecionar mais de um retorno do mesmo setor
não duplica a comparação. Todas as passagens identificadas do setor escolhido
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
valida duplicações e existência dos índices na análise reprocessada; não há limite fixo de quantidade de rastros, além do limite global de slides.

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
