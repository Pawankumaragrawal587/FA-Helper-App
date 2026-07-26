import type { FifoMatchedLot, FifoReport, NormalizedTransaction, OpenHolding } from '../types'

interface QueueLot {
  transaction: NormalizedTransaction
  remainingShares: number
}

function sortByDateAndRow(left: NormalizedTransaction, right: NormalizedTransaction): number {
  if (left.tradeDate !== right.tradeDate) {
    return left.tradeDate.localeCompare(right.tradeDate)
  }

  return left.sourceRowNumber - right.sourceRowNumber
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

export function buildFifoReport(transactions: NormalizedTransaction[]): FifoReport {
  const acquisitionQueue: QueueLot[] = transactions
    .filter((transaction) => transaction.transactionType === 'ACQUIRE')
    .sort(sortByDateAndRow)
    .map((transaction) => ({
      transaction,
      remainingShares: transaction.shares,
    }))

  const sellTransactions = transactions
    .filter((transaction) => transaction.transactionType === 'SELL')
    .sort(sortByDateAndRow)

  const matchedLots: FifoMatchedLot[] = []
  let unmatchedSellShares = 0

  sellTransactions.forEach((sellTransaction) => {
    let sharesRemainingToMatch = sellTransaction.shares

    while (sharesRemainingToMatch > 0 && acquisitionQueue.length > 0) {
      const acquisitionLot = acquisitionQueue[0]
      const matchedShares = Math.min(acquisitionLot.remainingShares, sharesRemainingToMatch)
      const matchRatio = matchedShares / sellTransaction.shares
      const allocatedFeeUsd = roundCurrency(sellTransaction.feeUsd * matchRatio)
      const buyAmountUsd = roundCurrency(matchedShares * acquisitionLot.transaction.pricePerShareUsd)
      const sellAmountUsd = roundCurrency(matchedShares * sellTransaction.pricePerShareUsd)
      const netProceedsUsd = roundCurrency(sellAmountUsd - allocatedFeeUsd)

      matchedLots.push({
        id: `${sellTransaction.id}-${acquisitionLot.transaction.id}-${matchedShares}`,
        acquisitionTransactionId: acquisitionLot.transaction.id,
        sellTransactionId: sellTransaction.id,
        stockSymbol: acquisitionLot.transaction.stockSymbol,
        grantName: acquisitionLot.transaction.grantName,
        grantNumber: acquisitionLot.transaction.grantNumber,
        buyDate: acquisitionLot.transaction.tradeDate,
        sellDate: sellTransaction.tradeDate,
        acquisitionSourceRowNumber: acquisitionLot.transaction.sourceRowNumber,
        sellSourceRowNumber: sellTransaction.sourceRowNumber,
        sharesMatched: matchedShares,
        buyPricePerShareUsd: acquisitionLot.transaction.pricePerShareUsd,
        sellPricePerShareUsd: sellTransaction.pricePerShareUsd,
        buyAmountUsd,
        sellAmountUsd,
        allocatedFeeUsd,
        netProceedsUsd,
        gainOrLossUsd: roundCurrency(sellAmountUsd - buyAmountUsd),
      })

      acquisitionLot.remainingShares -= matchedShares
      sharesRemainingToMatch -= matchedShares

      if (acquisitionLot.remainingShares === 0) {
        acquisitionQueue.shift()
      }
    }

    if (sharesRemainingToMatch > 0) {
      unmatchedSellShares = roundCurrency(unmatchedSellShares + sharesRemainingToMatch)
    }
  })

  const openHoldings: OpenHolding[] = acquisitionQueue
    .filter((lot) => lot.remainingShares > 0)
    .map((lot) => ({
      id: `${lot.transaction.id}-open`,
      stockSymbol: lot.transaction.stockSymbol,
      grantName: lot.transaction.grantName,
      grantNumber: lot.transaction.grantNumber,
      buyDate: lot.transaction.tradeDate,
      sourceRowNumber: lot.transaction.sourceRowNumber,
      sharesRemaining: lot.remainingShares,
      buyPricePerShareUsd: lot.transaction.pricePerShareUsd,
      costBasisUsd: roundCurrency(lot.remainingShares * lot.transaction.pricePerShareUsd),
    }))

  return {
    matchedLots,
    openHoldings,
    unmatchedSellShares,
  }
}
