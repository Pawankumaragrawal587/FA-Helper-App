import { getExchangeRateOnOrBefore } from './exchangeRates'
import type {
  ExchangeRateRow,
  HistoricalPriceRow,
  IbkrCashLedgerRecord,
  NormalizedTransaction,
} from '../types'

export interface ScheduleFaA2Context {
  calendarStart: string
  calendarEnd: string
}

export interface ScheduleFaA2Row {
  accountType: string
  calendarStart: string
  calendarEnd: string
  maxValueDate: string | null
  maxFxRate: number | null
  maxSecuritiesValueUsd: number | null
  maxCashBalanceUsd: number | null
  maxAccountValueUsd: number | null
  maxAccountValueInr: number | null
  closingValueDate: string
  closingFxRate: number | null
  closingFxRateDate: string | null
  closingSecuritiesValueUsd: number | null
  closingCashBalanceUsd: number | null
  closingAccountValueUsd: number | null
  closingAccountValueInr: number | null
}

interface ShareBalance {
  stockSymbol: string
  shares: number
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

function sortByDateAndRow(
  left: { tradeDate: string; sourceRowNumber: number },
  right: { tradeDate: string; sourceRowNumber: number },
): number {
  if (left.tradeDate !== right.tradeDate) {
    return left.tradeDate.localeCompare(right.tradeDate)
  }

  return left.sourceRowNumber - right.sourceRowNumber
}

function getShareBalancesOnDate(
  transactions: NormalizedTransaction[],
  valuationDate: string,
): ShareBalance[] {
  const balancesBySymbol = new Map<string, number>()

  ;[...transactions].sort(sortByDateAndRow).forEach((transaction) => {
    if (transaction.tradeDate > valuationDate) {
      return
    }

    const currentShares = balancesBySymbol.get(transaction.stockSymbol) ?? 0

    if (transaction.transactionType === 'ACQUIRE') {
      balancesBySymbol.set(transaction.stockSymbol, currentShares + transaction.shares)
      return
    }

    if (transaction.transactionType === 'SELL') {
      balancesBySymbol.set(transaction.stockSymbol, currentShares - transaction.shares)
    }
  })

  return [...balancesBySymbol.entries()]
    .map(([stockSymbol, shares]) => ({
      stockSymbol,
      shares: Number(shares.toFixed(8)),
    }))
    .filter((balance) => balance.shares > 0)
}

function getCashBalanceOnDate(cashLedgerRows: IbkrCashLedgerRecord[], valuationDate: string): number {
  return roundCurrency(
    cashLedgerRows
      .filter((row) => row.tradeDate <= valuationDate)
      .reduce((total, row) => total + row.netAmountUsd, 0),
  )
}

function getHistoricalPriceByDate(
  historicalPrices: HistoricalPriceRow[],
  stockSymbol: string,
  valuationDate: string,
): HistoricalPriceRow | null {
  return (
    historicalPrices.find((row) => row.stockSymbol === stockSymbol && row.date === valuationDate) ?? null
  )
}

function getHistoricalPriceOnOrBefore(
  historicalPrices: HistoricalPriceRow[],
  stockSymbol: string,
  valuationDate: string,
): HistoricalPriceRow | null {
  return (
    historicalPrices
      .filter((row) => row.stockSymbol === stockSymbol && row.date <= valuationDate)
      .sort((left, right) => left.date.localeCompare(right.date))
      .at(-1) ?? null
  )
}

function getSecuritiesValueUsdForMaxDate(
  transactions: NormalizedTransaction[],
  historicalPrices: HistoricalPriceRow[],
  valuationDate: string,
): number | null {
  const shareBalances = getShareBalancesOnDate(transactions, valuationDate)

  if (shareBalances.length === 0) {
    return 0
  }

  let valueUsd = 0

  for (const balance of shareBalances) {
    const priceRow = getHistoricalPriceByDate(
      historicalPrices,
      balance.stockSymbol,
      valuationDate,
    )

    if (!priceRow) {
      return null
    }

    valueUsd += balance.shares * priceRow.highPriceUsd
  }

  return roundCurrency(valueUsd)
}

function getSecuritiesValueUsdForClosingDate(
  transactions: NormalizedTransaction[],
  historicalPrices: HistoricalPriceRow[],
  valuationDate: string,
): number | null {
  const shareBalances = getShareBalancesOnDate(transactions, valuationDate)

  if (shareBalances.length === 0) {
    return 0
  }

  let valueUsd = 0

  for (const balance of shareBalances) {
    const priceRow = getHistoricalPriceOnOrBefore(
      historicalPrices,
      balance.stockSymbol,
      valuationDate,
    )

    if (!priceRow) {
      return null
    }

    valueUsd += balance.shares * priceRow.closePriceUsd
  }

  return roundCurrency(valueUsd)
}

export function buildScheduleFaA2Rows({
  transactions,
  cashLedgerRows,
  historicalPrices,
  exchangeRates,
  includeCash,
  context,
}: {
  transactions: NormalizedTransaction[]
  cashLedgerRows: IbkrCashLedgerRecord[]
  historicalPrices: HistoricalPriceRow[]
  exchangeRates: ExchangeRateRow[]
  includeCash: boolean
  context: ScheduleFaA2Context
}): ScheduleFaA2Row[] {
  type MaxAccountValueRow = {
    date: string
    fxRate: number
    securitiesValueUsd: number
    cashBalanceUsd: number
    accountValueUsd: number
    accountValueInr: number
  }

  let maxRow: MaxAccountValueRow | null = null

  for (const exchangeRateRow of exchangeRates.filter(
    (row) => row.ttBuyInr > 0 && row.date >= context.calendarStart && row.date <= context.calendarEnd,
  )) {
    const securitiesValueUsd = getSecuritiesValueUsdForMaxDate(
      transactions,
      historicalPrices,
      exchangeRateRow.date,
    )

    if (securitiesValueUsd === null) {
      continue
    }

    const cashBalanceUsd = includeCash ? getCashBalanceOnDate(cashLedgerRows, exchangeRateRow.date) : 0
    const accountValueUsd = roundCurrency(securitiesValueUsd + cashBalanceUsd)
    const accountValueInr = roundCurrency(accountValueUsd * exchangeRateRow.ttBuyInr)

    if (!maxRow || accountValueInr > maxRow.accountValueInr) {
      maxRow = {
        date: exchangeRateRow.date,
        fxRate: exchangeRateRow.ttBuyInr,
        securitiesValueUsd,
        cashBalanceUsd,
        accountValueUsd,
        accountValueInr,
      }
    }
  }

  const closingSecuritiesValueUsd = getSecuritiesValueUsdForClosingDate(
    transactions,
    historicalPrices,
    context.calendarEnd,
  )
  const closingCashBalanceUsd = includeCash ? getCashBalanceOnDate(cashLedgerRows, context.calendarEnd) : 0
  const closingFxLookup = getExchangeRateOnOrBefore(exchangeRates, context.calendarEnd)
  const closingAccountValueUsd =
    closingSecuritiesValueUsd !== null
      ? roundCurrency(closingSecuritiesValueUsd + closingCashBalanceUsd)
      : null

  return [
    {
      accountType: includeCash ? 'Securities plus cash' : 'Securities only',
      calendarStart: context.calendarStart,
      calendarEnd: context.calendarEnd,
      maxValueDate: maxRow?.date ?? null,
      maxFxRate: maxRow?.fxRate ?? null,
      maxSecuritiesValueUsd: maxRow?.securitiesValueUsd ?? null,
      maxCashBalanceUsd: includeCash ? (maxRow?.cashBalanceUsd ?? null) : 0,
      maxAccountValueUsd: maxRow?.accountValueUsd ?? null,
      maxAccountValueInr: maxRow?.accountValueInr ?? null,
      closingValueDate: context.calendarEnd,
      closingFxRate: closingFxLookup?.rate ?? null,
      closingFxRateDate: closingFxLookup?.rateDate ?? null,
      closingSecuritiesValueUsd,
      closingCashBalanceUsd: includeCash ? closingCashBalanceUsd : 0,
      closingAccountValueUsd,
      closingAccountValueInr:
        closingAccountValueUsd !== null && closingFxLookup !== null
          ? roundCurrency(closingAccountValueUsd * closingFxLookup.rate)
          : null,
    },
  ]
}
