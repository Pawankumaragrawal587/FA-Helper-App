import type { NormalizedTransaction, ShareworksSaleRecord } from '../types'

function buildSellTransaction(row: ShareworksSaleRecord): NormalizedTransaction {
  return {
    id: `${row.withdrawalReferenceNumber}-${row.sourceRowNumber}-sell`,
    broker: row.broker,
    transactionType: 'SELL',
    grantName: row.grantName,
    grantNumber: row.employeeGrantNumber,
    withdrawalReferenceNumber: row.withdrawalReferenceNumber,
    originatingReleaseReferenceNumber: row.originatingReleaseReferenceNumber,
    lotNumber: row.lotNumber,
    tradeDate: row.saleDate,
    acquisitionDate: row.originalAcquisitionDate,
    shares: row.sharesSold,
    pricePerShareUsd: row.salePricePerShareUsd,
    grossAmountUsd: row.saleProceedsUsd,
    feeUsd: row.brokerageCommissionUsd + row.supplementalTransactionFeeUsd,
    sourceRowNumber: row.sourceRowNumber,
  }
}

export function deriveLongShareSaleTransactions(
  rows: ShareworksSaleRecord[],
): NormalizedTransaction[] {
  return rows.map((row) => buildSellTransaction(row))
}
