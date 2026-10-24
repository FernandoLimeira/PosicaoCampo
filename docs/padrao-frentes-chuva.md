# Identificação das frentes na chuva

O cadastro de chuva das quatro unidades usa `FT 02`, `FT 06`, `FT 16` etc.
Nomes anteriores como `F-06`, `FT06`, `Eq. 06` e `Frente 06` continuam aceitos
e são normalizados na gravação e leitura, sem alterar os valores de chuva.

No informativo da Posição de Campo, o título permanece **FRENTE** e as linhas
mostram somente `02`, `03`, `06`, `13`, `15`, `16` etc. A normalização não
renumera as frentes de campo nem modifica as chaves de seus acontecimentos.

O cadastro legado de Narandiba com EQ 3–12 é convertido para FT 13–22 quando
identificado pelo conjunto de frentes. FT 08 continua sendo a frente 08.
Rótulos FT já normalizados não recebem esse deslocamento novamente.

Na inicialização, o servidor atualiza somente os rótulos de chuva legados,
preservando valores, frentes, observações e autoria. A versão da unidade
avança quando houver mudança, invalidando formulários abertos anteriormente.
A operação é transacional e idempotente e não altera contas ou senhas.
