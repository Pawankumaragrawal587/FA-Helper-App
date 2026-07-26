export type BrokerType = 'shareworks'

export type TransactionType = 'ACQUIRE' | 'SELL' | 'SELL_TO_COVER'

export interface ShareworksSaleRecord {
  broker: BrokerType
  sourceRowNumber: number
  periodStartDate: string
  periodEndDate: string
  withdrawalReferenceNumber: string
  originatingReleaseReferenceNumber: string
  employeeGrantNumber: string
  grantName: string
  lotNumber: string
  saleType: string
  saleDate: string
  originalAcquisitionDate: string
  soldWithinThirtyDaysOfVest: boolean
  originalCostBasisPerShareUsd: number
  originalCostBasisUsd: number
  sharesSold: number
  saleProceedsUsd: number
  salePricePerShareUsd: number
  brokerageCommissionUsd: number
  supplementalTransactionFeeUsd: number
}

export interface ParsedShareworksFile {
  reportName: string
  rows: ShareworksSaleRecord[]
  ignoredRowCount: number
  ignoredRows: IgnoredRowDetail[]
}

export interface ShareworksReleaseRecord {
  broker: BrokerType
  sourceRowNumber: number
  periodStartDate: string
  periodEndDate: string
  grantDate: string
  grantNumber: string
  grantType: string
  grantName: string
  grantReason: string
  releaseDate: string
  sharesVested: number
  sharesSoldToCover: number
  sharesHeld: number
  valueUsd: number
  fairMarketValuePerShareUsd: number
  sellToCoverSaleDate: string
  sellToCoverSalePricePerShareUsd: number
  sellToCoverSaleProceedsUsd: number
  sellToCoverAmountUsd: number
  releaseReferenceNumber: string
}

export interface ParsedShareworksReleasesFile {
  reportName: string
  rows: ShareworksReleaseRecord[]
  ignoredRowCount: number
  ignoredRows: IgnoredRowDetail[]
}

export interface HistoricalPriceRow {
  date: string
  closePriceUsd: number
  highPriceUsd: number
}

export interface ParsedHistoricalPriceFile {
  reportName: string
  rows: HistoricalPriceRow[]
}

export interface ExchangeRateRow {
  date: string
  ttBuyInr: number
}

export interface ParsedExchangeRateFile {
  reportName: string
  rows: ExchangeRateRow[]
}

export interface IgnoredRowDetail {
  sourceRowNumber: number
  reason: string
  preview: string
}

export interface NormalizedTransaction {
  id: string
  broker: BrokerType
  transactionType: TransactionType
  grantName: string
  grantNumber: string
  withdrawalReferenceNumber: string
  originatingReleaseReferenceNumber: string
  lotNumber: string
  tradeDate: string
  acquisitionDate: string
  shares: number
  pricePerShareUsd: number
  grossAmountUsd: number
  feeUsd: number
  sourceRowNumber: number
}

export interface FifoMatchedLot {
  id: string
  acquisitionTransactionId: string
  sellTransactionId: string
  grantName: string
  grantNumber: string
  buyDate: string
  sellDate: string
  acquisitionSourceRowNumber: number
  sellSourceRowNumber: number
  sharesMatched: number
  buyPricePerShareUsd: number
  sellPricePerShareUsd: number
  buyAmountUsd: number
  sellAmountUsd: number
  allocatedFeeUsd: number
  netProceedsUsd: number
  gainOrLossUsd: number
}

export interface OpenHolding {
  id: string
  grantName: string
  grantNumber: string
  buyDate: string
  sourceRowNumber: number
  sharesRemaining: number
  buyPricePerShareUsd: number
  costBasisUsd: number
}

export interface FifoReport {
  matchedLots: FifoMatchedLot[]
  openHoldings: OpenHolding[]
  unmatchedSellShares: number
}
