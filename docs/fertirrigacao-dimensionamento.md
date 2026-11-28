# Fertirrigação: dimensionamento de frentes e alocação de CVs

Levantamento da planilha **"Logística Fertirrigação - NRD-2026.xlsx"** (análise de 27/11/2026),
para levar o dimensionamento das frentes de fertirrigação e a alocação de caminhões (CVs) para a
Produção Agrícola. Os números de exemplo são os da própria planilha (frentes FT.54, FT.56, FT.57 e
FT.59 de NRD).

## 1. Abas da planilha

| Aba | Papel | Usada no cálculo atual? |
|---|---|---|
| **PLANEJAMENTO NRD** | Dimensionamento diário por frente (a aba principal) | Sim |
| **BASE GERAL** | Tabelas: vazão → velocidade de aplicação; metros lineares por hectare; bases de carregamento | Sim (velocidade) |
| **Ordens** | Resultado do SELECT de O.S. (operações 509 e 524): O.S., setor, talhão, tratos, produto, quantidade e unidade | Sim |
| **Select OS** | Texto do SELECT que gera a aba Ordens | Referência |
| **RAIO** | Setor → fazenda, município, base de carregamento e raio (km) | Sim (fazenda) |
| **PLANEJAMENTO - SEMANAL** | Sequência de setores por frente nos próximos dias, equipamentos, vazão e raio planejado × orçado | Parcial (blocos finais quebrados) |
| **PLAN - DIARIO** | Versão anterior do dimensionamento diário | Não (substituída) |
| **RAIO OK / PLANEJADO** | Cadastro de talhões com dose e total de vinhaça e raio ponderado | Fonte de consulta |
| **Eficiência Colheitabilidade** | Velocidade × TCH (colheita) | Não |
| **Rampa** | Plano de produção de safras antigas | Não |
| **ID RADIO** | Rádios das bases e gestores por turno | Não |

## 2. Entradas por frente (PLANEJAMENTO NRD)

Digitadas pelo planejador, uma coluna por frente:

| Entrada | Exemplo FT.54 | Observação |
|---|---|---|
| Setor | 3335 | |
| Ordem de serviço | 332553 | |
| Base de carregamento | BASE STA CRUZ | Sta Cruz, Bié, Casa Branca, Usina, Raposo |
| Status | SOLO ÚMIDO / EM ATIVIDADE | |
| Espaçamento | SIMPLES | Simples 1,5 m ou combinado 2,4 m |
| Tratores da equipe | `846 - 847 - 1056` | Lista de prefixos; a contagem dá o nº de tratores |
| Tratores na oficina | `1054` | Só informativo |
| Hora trabalhada (plano) | 3,7 h | |
| ha/hora (plano) | 6,19 | |
| Vazão | 35 m³/ha | Recomendação da O.S. (produto em m³) |
| Raio médio | 42 km | Digitado (não vem da aba RAIO) |
| Consumo biometano % | 0,39 | Só informativo |
| Velocidade carregado / vazio | 29,7 / 35,4 km/h | |
| Tempo auxiliar | 0,8 h | |
| Tempo de carregamento | 0,3 h | |
| Bate/volta | SIM / NÃO | Muda o tempo de descarregamento |
| Caminhões alocados (LOTS) | `612 - 615` | Lista de prefixos; a contagem dá os CVs alocados |
| Caminhões na oficina | | Só informativo |

Da O.S. (aba Ordens, pela O.S. + setor):

- **Tratos culturais** = `CCUSTO_TRATOS` (ex.: TRATOS SOQUEIRA).
- **Recomendação de vazão** = produto com unidade `M3` (ex.: FERTILIZANTE LIQUEFERTIL = 35 m³).
- **Produtos** = produto com unidade `L` (ex.: FERTILIZANTE FEVL 10.00.06+MIX = 670 L) e com unidade `TO`.
- **Talhões** = talhões distintos da O.S. no setor.
- **Fazenda** = aba RAIO pelo setor.

## 3. Cálculo (por frente)

```
Nº tratores            = quantidade de prefixos em "Tratores da equipe"
Rendimento (ha/dia)    = horas × nº tratores × ha/hora
                         ÷ 3 quando os tratos são TRATOS RUA MÃE, TRATOS PLANTIO ou TRATOS MEIOSI
Velocidade aplicação   = tabela BASE GERAL pela vazão (12 m³/ha → 9 km/h … 50 m³/ha → 2 km/h)
Necessidade (m³/h)     = ha/hora × vazão × nº tratores
Necessidade (m³/dia)   = necessidade (m³/h) × horas
Capacidade por viagem  = 53 m³ (26 m³, ou 22 m³ em parte das colunas, quando a O.S. é de "PR")
Tempo carregado (h)    = raio ÷ velocidade carregado
Tempo vazio (h)        = raio ÷ velocidade vazio
Tempo descarregamento  = 0,1 h com bate/volta, 0,3 h sem
Ciclo (h)              = tempo carregado + tempo vazio + auxiliar + carregamento + descarregamento
Viagens por dia        = 24 ÷ ciclo
Necessidade (CV/hora)  = vazão × rendimento ÷ capacidade ÷ 24
Intervalo de saída     = 60 ÷ necessidade (CV/hora)   (minutos entre caminhões)
Caminhões necessários  = ARREDONDAR.PARA.CIMA(necessidade CV/hora × ciclo)
Caminhões alocados     = quantidade de prefixos em "Caminhões LOTS"  ("REPROGRAMADO")
```

Totais (coluna Geral): soma de tratores, rendimento, m³ e caminhões. A vazão e o raio do total são
médias ponderadas pelo rendimento de cada frente.

### Exemplo (FT.54)

- Rendimento = 3,7 × 3 × 6,19 = **68,71 ha/dia**
- Necessidade = 35 × 68,71 ÷ 53 ÷ 24 = **1,89 CV/h** (intervalo de saída de **31,7 min**)
- Ciclo = 42 ÷ 29,7 + 42 ÷ 35,4 + 0,8 + 0,3 = **3,70 h** (ver problema 1)
- Caminhões necessários = ⌈1,89 × 3,70⌉ = **7**. Alocados: **2**.

Resultado do dia na planilha: **24 caminhões necessários** para as 4 frentes, **17 alocados**.

### Planejamento semanal

- **Sequência**: setor de cada frente por dia (fazenda pela aba RAIO).
- **Equipamentos** (tratores por frente/dia), **vazão** e **velocidade** (BASE GERAL pela vazão).
- **ha/dia** = tratores × 6 ha/h × 3,2 h/d.
- **Raio do dia** = aba RAIO pelo setor. **Raio planejado** = média dos raios ponderada pela vazão;
  comparado com o **raio orçado** (30 km).

## 4. Problemas encontrados na planilha

1. **O descarregamento não entra no ciclo.** "Tempo de descarregamento" é gerado como texto
   (`"0,3"` / `"0,1"`), e a SOMA do ciclo ignora texto. Com 0,3 h somado, a FT.54 passa de
   7 para **8 caminhões** (ciclo de 3,70 h → 4,00 h).
2. **A regra de capacidade "PR" nunca dispara.** Ela procura "PR" na coluna ESTADO da O.S., que só
   tem SP e MS. Além disso, metade das colunas usa 26 m³ e a outra metade 22 m³.
3. **Produtos em "TO" nunca aparecem:** a O.S. traz KG, não TO.
4. **Raio por setor ignora a base.** 87 dos 1.053 setores da aba RAIO têm raio para mais de uma base
   (ex.: setor 870: Bié 55,8 km, Sta Cruz 45,0 km). O PROCV pega a primeira linha. Na aba
   principal o raio é digitado, então cada frente depende de quem digita.
5. **Totais com referência circular:** tempo auxiliar e de carregamento da coluna Geral fazem média
   incluindo a própria célula (resultado 0), e o ciclo total fica 0.
6. **Semanal:** o raio da FT.57 consulta o setor da FT.56; o bloco "caminhão hora / tempo de ciclo /
   nº de caminhões" está com #REF!/#VALOR!.
7. **Contagem de tratores e caminhões pelo texto** (contar hífens): um espaço ou hífen a mais muda
   o número.
8. **Velocidade de aplicação não é usada no rendimento:** o rendimento usa ha/hora digitado (6,19);
   a velocidade pela vazão só aparece numa linha sem uso ("Necessidade hora" = vazão × velocidade ×
   horas). PROCV exato na tabela de vazão falha (#N/D) para vazões fora de 12–50 ou com decimais.
9. **Necessidade por hora dividida por 24 h** enquanto o rendimento é de 3,7 h trabalhadas: a
   necessidade de CV/h é uma média do dia. Confirmar com a operação se é essa a intenção.

## 5. Como encaixa na Produção Agrícola

O que **já existe** no sistema:

| Planilha | Sistema |
|---|---|
| Frente (FT.54…) | Frente/serviço do cadastro (grupo Fertirrigação), por unidade |
| Setor, seção, fazenda, status | Lançamento diário da frente (base de setores e status) |
| O.S. e operação 509/524 | Base de O.S. importada (conferência por setor e operação) |
| Talhões da O.S. | Já vêm na O.S. |
| Tratos (CCUSTO_TRATOS) | Já é lido na importação |
| Produtos e vazão (CD_COMPO, DE_COMPO, QT_RECURSO, CD_UNIMED) | Ficam guardados nas linhas da O.S. quando o SELECT traz essas colunas; falta ler |

O que **falta criar**:

1. **Cadastro de equipamentos**: tratores e caminhões (CVs) com prefixo, tipo (diesel/gás),
   capacidade (m³) e situação (operando, oficina, sem motorista, apoio).
2. **Alocação diária**: quais tratores e CVs estão em cada frente (selecionados da lista, não texto
   livre), com o histórico por dia e turno.
3. **Parâmetros da frente**: base de carregamento, horas planejadas, ha/hora, velocidades
   carregado/vazio, tempos auxiliar/carregamento/descarregamento, bate/volta.
4. **Raio setor × base**: importação da aba RAIO (setor, base, raio) com escolha pela base da frente.
5. **Tabela vazão → velocidade** e **metros lineares por espaçamento** (BASE GERAL), editáveis na página
   Cadastros.
6. **Painel de dimensionamento**: por frente, rendimento, m³/dia, ciclo, viagens, intervalo de saída,
   CVs necessários × alocados (falta/sobra), e o total da unidade.
7. **Planejamento semanal** (fase 2): sequência de setores por frente e raio planejado × orçado.

### Proposta de fases

- **Fase 1 — dimensionamento diário:** cadastros (equipamentos, raio, tabelas), parâmetros por frente,
  leitura da vazão e dos produtos da O.S., cálculo e painel "necessário × alocado". Corrige os
  problemas 1, 4, 5 e 7.
- **Fase 2 — alocação de CVs:** atribuir caminhões às frentes no painel, com sugestão automática
  (preenche primeiro a frente com maior falta) e avisos de frente descoberta.
- **Fase 3 — planejamento semanal:** sequência de setores, raio planejado × orçado e projeção de CVs
  por dia.

### Decisões a confirmar com a operação

- Descarregamento entra no ciclo (problema 1)? Muda o número de caminhões.
- Regra de capacidade reduzida (26 ou 22 m³) e em que caso se aplica.
- "Necessidade por hora" sobre 24 h ou sobre as horas trabalhadas.
- Rendimento por ha/hora digitado ou calculado pela velocidade e espaçamento.
- O SELECT de O.S. da Produção passa a trazer produtos e quantidades (CD_COMPO, DE_COMPO, QT_RECURSO,
  CD_UNIMED), como o da planilha.

## 6. Implementado (Fase 1, Polo SP)

Página **Produção Agrícola → Fertirrigação** (`/producao/fertirrigacao`), para PPT e NRD.

- **Frentes**: as frentes com operação 509 ou 524 no lançamento do dia.
- **Vazão**: produto em m³ da O.S. mais recente do setor (colunas `CD_UNIMED`, `QT_RECURSO`,
  `DE_COMPO` do SELECT de O.S.); pode ser corrigida no plano. Tratos (`CCUSTO_TRATOS`) e produtos
  em L/KG também vêm da O.S.
- **Raio**: digitado na configuração da frente e guardado por setor × base (ver seção 9). Setor com
  mais de uma base com raio pede a base (não escolhe sozinho).
- **Plano do dia por frente**: base, correção de vazão e raio, tratores e CVs alocados (escolhidos
  da frota, não digitados) e os parâmetros da conta (vazio = padrão da planilha). Sem plano no dia,
  vale o último plano salvo. Um equipamento fica em uma frente só por dia; equipamento na oficina
  ou inativo não conta.
- **Conta**: a da planilha, com o descarregamento somado ao ciclo (problema 1). Conferida casa a
  casa com a planilha em `tests/test_fert_dimensioning.py` (servidor) e
  `tests/test_production_fert.js` (prévia do popup).
- **Permissões**: módulo próprio **Fertirrigação** na tela de Usuários (painel da Produção Agrícola):
  **Consultar** vê o painel e o quadro de alocação; **Editar** configura as frentes, aloca CVs, digita o
  raio, planeja a semana e cadastra a frota. Vale para as unidades do Polo SP (PPT e NRD) liberadas na
  Produção Agrícola. Módulo novo começa negado para todas as contas (o administrador libera); o
  administrador tem tudo. A barreira das rotas (`required_permission`) e o modelo (`fert_access`) conferem.

Código: `backend/services/fert_dimensioning.py` (conta), pacote `backend/models/production/fert/` e
`static/js/producao/production-fert*.js` (painel, semana, configuração da frente, frota e quadro de
alocação).

## 7. Gestão dos CVs e recomendação (painel único)

- **Situação de cada CV e trator**: Operando (em frente), Disponível, Oficina, Sem motorista, Apoio
  e Inativo. Só Operando/Disponível vão para uma frente. Alocar põe em Operando; sair da frente
  volta para Disponível; ir para Oficina, Sem motorista, Apoio ou Inativo tira da frente no dia.
  A situação muda no quadro **Frota do dia** do painel, pelo analista.
- **Troca de frente feita pelo analista**: no plano da frente, um CV que está em outra frente
  pode ser trazido direto ("mover"), **só se a recomendação de produtos das duas frentes for a
  mesma** (o CV sai carregado da base com a mistura da recomendação). Com recomendação diferente,
  ou sem componentes na O.S., o CV aparece bloqueado. Tratores mudam de frente sem essa regra.
- **Recomendação**: componentes da O.S. mais recente do setor (PIMS): nome, dose e unidade de cada
  produto. A vazão é o componente em m³.
- **Histórico (Movimentações do dia)**: alocação, troca de frente, saída e mudança de situação, com
  quem fez e a hora.
- **Bases de carregamento**: as da unidade (PPT: Usina e Raposo; NRD: Santa Cruz, Bié e Casa Branca)
  e as que já têm raio para o setor; base sem raio pede o raio na configuração da frente.
- **SELECT do PIMS**: `docs/select-os-fertirrigacao.sql` é o SELECT de O.S. que o sistema já usa
  (mesmas instâncias, operações, data e talhão por safra/seção) com os componentes da planilha
  (CD_COMPO, DE_COMPO, QT_RECURSO, CD_UNIMED e RESERVA) por outer join (+) só nas operações 509 e 524;
  as demais O.S. vêm iguais. Um único arquivo alimenta a Produção e a Fertirrigação.
- **CV a gás (biometano)**: no cadastro, combustível Diesel ou Gás; o analista informa o % do
  tanque (quadro da frota ou ficha do CV). Consumo por viagem = raio × 0,85% do tanque (bate com a
  linha "CONSUMO BIOMETANO %" da planilha: FT.56 49,8 km → 42,3%), ou o valor informado no plano da
  frente. Viagens possíveis = % no tanque ÷ consumo por viagem (viagens completas).
- **Ciclo dos CVs agora**: posição estimada de cada CV (carregando, indo carregado, descarregando,
  voltando vazio) pelo ciclo planejado da frente, sem GPS; redesenha a cada minuto só na tela.
- **Ficha do CV** (clique no CV) e **resumo da frente** (topo do popup do plano).

## 8. BASE GERAL e planejamento semanal

- **Velocidade por vazão (BASE GERAL)**: tabela de 12 m³/ha (9 km/h) a 50 m³/ha (2 km/h), com a vazão
  arredondada ao m³ inteiro; fora da tabela não há velocidade (a planilha dava #N/D).
- **ha/hora pela velocidade (opcional por frente)**: velocidade × entrelinha × nº de seções ÷ 10, com o
  espaçamento da BASE GERAL (simples 1,5 m × 10 seções; combinado 2,4 m × 5 seções). Ex.: 35 m³/ha →
  5 km/h → 7,5 ha/h no simples. O padrão continua o ha/hora digitado (6,19, como a planilha); a planilha
  não tinha a fórmula, então este cálculo é a leitura da BASE GERAL e deve ser confirmado pela operação.
- **Planejamento da semana (aba PLANEJAMENTO - SEMANAL)**: setor de cada frente nos próximos 7 dias,
  com vazão (da O.S. do setor, ou informada) e tratores (os da frente, ou informados). Hoje vem do
  lançamento. Por dia: CVs necessários (mesma conta do dimensionamento, com o plano da frente), área,
  volume e **raio planejado** = média dos raios ponderada pela vazão (como a planilha), contra o **raio
  orçado** da unidade (padrão 30 km, editável). O raio do setor é o da base da frente (a planilha usava
  a primeira linha da aba RAIO e, na FT.57, o setor da FT.56).

## 9. Frentes da Posição de Campo e raio digitado

- **Frentes**: as mesmas da Posição de Campo da Produção (itens ativos da unidade, com o último
  lançamento até o dia). Entra a frente que lançou 509/524 ou que tem 509/524 como operação padrão no
  cadastro. O grupo "Fertirrigação" só puxa a frente sem nenhuma operação (lançada ou padrão): a Fert
  convencional (346/342) fica no mesmo grupo e não usa CVs, então fica fora. O analista só cadastra os
  equipamentos (tratores e CVs) e escolhe a base; setor, vazão e recomendação vêm do lançamento e da O.S.
- **O.S.**: a base de O.S. é uma só para todas as unidades (cada importação substitui a base inteira),
  como na conferência da Produção; a fert não filtra pela unidade da importação.
- **Raio**: digitado só na configuração da frente (etapa Local) e guardado por **setor + base** (não
  no plano). Volta sozinho quando a frente cair de novo no setor, vale para a semana e não segue a
  frente quando ela muda de setor. Não há importação da aba RAIO (um lugar só).

## 10. Quadro de alocação e configuração em etapas

- **Painel em abas**: Alocação (padrão), Ciclo dos CVs, Frentes, Semana, Frota e Movimentações.
- **Quadro de alocação**: coluna "Disponíveis" e uma coluna por frente, com a **receita** (frentes com a
  mesma recomendação de produtos têm a mesma etiqueta e trocam CVs), a meta de CVs (alocados × necessários)
  e cada CV na etapa do ciclo. Arrastar o CV aloca, troca de frente (só mesma receita) ou libera; a ficha
  do CV tem "Alocar em" (celular). O servidor (`PUT /api/production/fert/allocate`) confere a regra e muda
  só a equipe da frente.
- **Configuração da frente em 3 etapas**: Local (o que vem do sistema × base e raio digitados), Equipe
  (CVs e tratores, adicionar ou cadastrar) e Conferir (números e ajustes opcionais da conta).

## 11. O.S. em aplicação, edição simultânea e auditoria

- **O.S. em aplicação**: um setor pode ter várias O.S. de fertirrigação abertas, cada uma com seus talhões e
  sua receita (como na planilha, onde a O.S. é escolhida por frente). Na etapa Local o analista escolhe a O.S.
  (padrão: a mais recente da mesma operação); recomendação, vazão, talhões, tratos e a receita da troca de CV
  vêm só dela. O.S. escolhida que não está mais aberta gera aviso e a frente usa a mais recente.
- **Edição simultânea da mesma frente**: o popup envia a versão do plano que abriu; se outra pessoa gravou a
  frente depois (plano, arrastar CV, situação), o servidor recusa e pede para reabrir. Arrastar CV é
  incremental (tira/põe um equipamento) e não sobrescreve o resto do plano.
- **Gravações ao mesmo tempo (banco)**: cada gravação reserva o banco no início (`BEGIN IMMEDIATE`) e quem
  chega depois espera a vez (até `DB_BUSY_TIMEOUT_MS`, 10 s); passou disso, nada é gravado pela metade e a
  tela recebe "o sistema está ocupado, tente de novo" (503). Teste de carga: 8 pessoas × 60 gravações cada,
  sem erro e sem CV em duas frentes.
- **Auditoria (28/11/2026)**: aviso de O.S. escapado no quadro (XSS); tipo do equipamento fixo após o
  cadastro; excluir equipamento tira das frentes; o popup mostra os parâmetros como gravados (o ha/hora pela
  velocidade não vira digitado); raio só é regravado quando muda; campos e estilos sem uso removidos.
