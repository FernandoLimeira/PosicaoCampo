-- SELECT da pesagem (balança) importado pela Posição de Campo → "Importar pesagem".
-- Guardar também em Entrega CTT → Consultas SQL. O sistema só lê o Excel gerado.
--
-- ATR_REALIZADO pelo Consecana, como o relatório do PIMS:
--   LPb = 0,99897 × QT_POL_LEIT + 0,464            (leitura convertida; conversão obtida do
--         relatório do PIMS de 23/11/2026, NRD: pol do caldo das 9 frentes com erro ≤ 0,006.
--         Confirmar com o laboratório/TI o parâmetro configurado no PIMS.)
--   S   = LPb × (0,2605 − 0,0009882 × Brix)        (pol do caldo)
--   C   = (1 − 0,01 × Fibra) × (1,0313 − 0,00575 × Fibra)
--   PC  = S × C ; ARC = (3,641 − 0,0343 × S ÷ Brix × 100) × C
--   ATR = 9,6316 × PC + 9,15 × ARC
-- QT_BRIX, QT_POL_LEIT e QT_FIBRA (só nas cargas analisadas) servem para conferir o ATR
-- com o PIMS; o importador ignora colunas que não usa.
SELECT A.INSTANCIA AS INSTANCIA_ORIGEM,
       TO_CHAR(A.DT_MOVIMENTO,'DD/MM/YYYY') AS DT_MOVIMENTO,
       A.NO_LIBERACAO,
       CM.CD_EQUIPTO AS CAMINHAO,
       CT.CD_EQUIPTO AS JULIETA,
       A.CD_UPNIVEL1,
       A.CD_UPNIVEL2,
       A.CD_FREN_TRAN,
       A.QT_LIQUIDO,
       CASE
           WHEN A.FG_ANALISE = 'S' AND NVL(A.QT_BRIX,0) > 0 THEN
               ROUND(
                   9.6316 * (
                       ((0.99897 * A.QT_POL_LEIT + 0.464) * (0.2605 - 0.0009882 * A.QT_BRIX))
                       * (1 - 0.01 * A.QT_FIBRA) * (1.0313 - 0.00575 * A.QT_FIBRA)
                   )
                   + 9.15 * (
                       (3.641 - 0.0343 * (
                           ((0.99897 * A.QT_POL_LEIT + 0.464) * (0.2605 - 0.0009882 * A.QT_BRIX))
                           / A.QT_BRIX * 100
                       ))
                       * (1 - 0.01 * A.QT_FIBRA) * (1.0313 - 0.00575 * A.QT_FIBRA)
                   ),
                   2
               )
           ELSE NULL
       END AS ATR_REALIZADO,
       CASE WHEN A.FG_ANALISE = 'S' THEN A.QT_BRIX END AS QT_BRIX,
       CASE WHEN A.FG_ANALISE = 'S' THEN A.QT_POL_LEIT END AS QT_POL_LEIT,
       CASE WHEN A.FG_ANALISE = 'S' THEN A.QT_FIBRA END AS QT_FIBRA,
       TO_CHAR(A.HR_GUARITA,'DD/MM/YYYY HH24:MI:SS') AS HR_ENTRADA_PATIO,
       TO_CHAR(A.HR_ENTRADA,'DD/MM/YYYY HH24:MI:SS') AS HR_ENTRADA_BALANCA,
       TO_CHAR(A.HR_SAIDA,'DD/MM/YYYY HH24:MI:SS') AS HR_SAIDA_BALANCA,
       TO_CHAR(A.HR_GUARITA,'DD/MM/YYYY HH24:MI:SS') AS DT_REG_GUARITA,
       TO_CHAR(SYSDATE,'DD/MM/YYYY HH24:MI:SS') AS DT_EXTRACAO
FROM APT_CARGAS A
LEFT JOIN APT_CARGAS_REC CM
    ON CM.INSTANCIA = A.INSTANCIA
    AND CM.NO_LIBERACAO = A.NO_LIBERACAO
    AND CM.CD_TP_RECURSO = 'CM'
LEFT JOIN APT_CARGAS_REC CT
    ON CT.INSTANCIA = A.INSTANCIA
    AND CT.NO_LIBERACAO = A.NO_LIBERACAO
    AND CT.CD_TP_RECURSO = 'CT'
WHERE A.INSTANCIA IN ('401', '402', '201', '204')
  AND (
      (A.HR_GUARITA >= TRUNC(SYSDATE) AND A.HR_GUARITA < TRUNC(SYSDATE) + 1)
      OR
      (A.HR_SAIDA >= TRUNC(SYSDATE) AND A.HR_SAIDA < TRUNC(SYSDATE) + 1)
  )
ORDER BY A.HR_SAIDA ASC
