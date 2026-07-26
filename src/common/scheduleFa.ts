import {
  getCapitalGainsExchangeRate,
  getExchangeRateOnOrBefore,
  getMaxInrAmountForRange,
} from './exchangeRates'
import type {
  ExchangeRateRow,
  FifoMatchedLot,
  HistoricalPriceRow,
  IbkrDividendRecord,
  OpenHolding,
} from '../types'

export interface ScheduleFaSellToCoverRow {
  id: string
  stockSymbol: string
  buyDate: string
  sellDate: string
  grantName: string
  sharesMatched: number
  buyPricePerShareUsd: number
  sellPricePerShareUsd: number
  buyAmountUsd: number
  sellAmountUsd: number
  gainOrLossUsd: number
}

export interface ScheduleFaContext {
  assessmentYearLabel: string
  assessmentYearStart: number
  calendarStart: string
  calendarEnd: string
  financialStart: string
  financialEnd: string
}

export interface ScheduleFaRow {
  id: string
  stockSymbol: string
  holdingType: string
  buyDate: string
  sellDate: string | null
  grantName: string
  shares: number
  buyPricePerShareUsd: number
  sellPricePerShareUsd: number | null
  buyAmountUsd: number
  sellAmountUsd: number | null
  buyFxRate: number | null
  buyFxRateDate: string | null
  buyAmountInr: number | null
  sellFxRate: number | null
  sellFxRateDate: string | null
  sellAmountInr: number | null
  dividendReceivedUsd: number
  dividendFxRate: string | null
  dividendFxDate: string | null
  dividendReceivedInr: number
  maxPricePerShareUsd: number | null
  maxPriceDate: string | null
  maxFxRate: number | null
  maxFxRateDate: string | null
  maxAmountInrDate: string | null
  maxAmountInr: number | null
  maxAmountUsd: number | null
  closingPricePerShareUsd: number | null
  closingFxRate: number | null
  closingFxRateDate: string | null
  closingAmountInr: number | null
  closingAmountUsd: number | null
}

function sortBySymbolBuyDateThenSellDate(left: ScheduleFaRow, right: ScheduleFaRow): number {
  if (left.stockSymbol !== right.stockSymbol) {
    return left.stockSymbol.localeCompare(right.stockSymbol)
  }

  if (left.buyDate !== right.buyDate) {
    return left.buyDate.localeCompare(right.buyDate)
  }

  if (left.sellDate !== right.sellDate) {
    return (left.sellDate ?? '9999-12-31').localeCompare(right.sellDate ?? '9999-12-31')
  }

  return `${left.stockSymbol}-${left.grantName}`.localeCompare(`${right.stockSymbol}-${right.grantName}`)
}

function getMaxPriceForRange(
  historicalPrices: HistoricalPriceRow[],
  stockSymbol: string,
  startDate: string,
  endDate: string,
): { price: number; date: string } | null {
  const matchingRows = historicalPrices.filter(
    (row) => row.stockSymbol === stockSymbol && row.date >= startDate && row.date <= endDate,
  )

  if (matchingRows.length === 0) {
    return null
  }

  const bestRow = matchingRows.reduce((currentBest, row) => {
    if (row.highPriceUsd > currentBest.highPriceUsd) {
      return row
    }

    return currentBest
  })

  return {
    price: bestRow.highPriceUsd,
    date: bestRow.date,
  }
}

function getClosingPriceOnOrBefore(
  historicalPrices: HistoricalPriceRow[],
  stockSymbol: string,
  endDate: string,
): number | null {
  const matchingRows = historicalPrices.filter(
    (row) => row.stockSymbol === stockSymbol && row.date <= endDate,
  )
  const lastRow = matchingRows.at(-1)

  return lastRow ? lastRow.closePriceUsd : null
}

function allocateDividendsToScheduleFaRows(
  rows: ScheduleFaRow[],
  dividendRows: IbkrDividendRecord[],
  exchangeRates: ExchangeRateRow[],
  context: ScheduleFaContext,
): ScheduleFaRow[] {
  if (rows.length === 0 || dividendRows.length === 0) {
    return rows.map((row) => ({
      ...row,
      dividendReceivedUsd: row.dividendReceivedUsd ?? 0,
      dividendFxRate: row.dividendFxRate ?? null,
      dividendFxDate: row.dividendFxDate ?? null,
      dividendReceivedInr: row.dividendReceivedInr ?? 0,
    }))
  }

  const dividendTotalsByRowId = new Map<
    string,
    {
      usd: number
      inr: number
      fxEntries: Array<{ rate: number; date: string }>
    }
  >()
  const sortedDividends = [...dividendRows].sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) || left.sourceRowNumber - right.sourceRowNumber,
  )

  sortedDividends.forEach((dividendRow) => {
    if (dividendRow.tradeDate < context.calendarStart || dividendRow.tradeDate > context.calendarEnd) {
      return
    }

    const activeRows = rows.filter((row) => {
      if (row.stockSymbol !== dividendRow.stockSymbol) {
        return false
      }

      const rowEndDate = row.sellDate ?? context.calendarEnd
      return row.buyDate <= dividendRow.tradeDate && rowEndDate >= dividendRow.tradeDate
    })

    const totalSharesHeld = activeRows.reduce((total, row) => total + row.shares, 0)
    if (totalSharesHeld <= 0) {
      return
    }

    const dividendFxLookup = getCapitalGainsExchangeRate(exchangeRates, dividendRow.tradeDate)

    activeRows.forEach((row) => {
      const allocatedDividend = dividendRow.netAmountUsd * (row.shares / totalSharesHeld)
      const currentTotals = dividendTotalsByRowId.get(row.id) ?? {
        usd: 0,
        inr: 0,
        fxEntries: [],
      }

      currentTotals.usd += allocatedDividend

      if (dividendFxLookup) {
        currentTotals.inr += allocatedDividend * dividendFxLookup.rate
        currentTotals.fxEntries.push({
          rate: dividendFxLookup.rate,
          date: dividendFxLookup.rateDate,
        })
      }

      dividendTotalsByRowId.set(row.id, currentTotals)
    })
  })

  return rows.map((row) => ({
    ...row,
    dividendReceivedUsd: Number((dividendTotalsByRowId.get(row.id)?.usd ?? 0).toFixed(2)),
    dividendFxRate: (() => {
      const fxEntries = dividendTotalsByRowId.get(row.id)?.fxEntries ?? []
      if (fxEntries.length === 0) {
        return null
      }

      const uniqueRates = [...new Set(fxEntries.map((entry) => entry.rate.toFixed(2)))]
      return uniqueRates.join('; ')
    })(),
    dividendFxDate: (() => {
      const fxEntries = dividendTotalsByRowId.get(row.id)?.fxEntries ?? []
      if (fxEntries.length === 0) {
        return null
      }

      const uniqueDates = [...new Set(fxEntries.map((entry) => entry.date))]
      return uniqueDates.join('; ')
    })(),
    dividendReceivedInr: Number((dividendTotalsByRowId.get(row.id)?.inr ?? 0).toFixed(2)),
  }))
}

export function buildScheduleFaRows(
  lifetimeMatchedLots: FifoMatchedLot[],
  sellToCoverRows: ScheduleFaSellToCoverRow[],
  openHoldings: OpenHolding[],
  historicalPrices: HistoricalPriceRow[],
  exchangeRates: ExchangeRateRow[],
  dividendRows: IbkrDividendRecord[],
  context: ScheduleFaContext,
): ScheduleFaRow[] {
  const matchedRows = lifetimeMatchedLots
    .filter(
      (row) =>
        row.buyDate <= context.calendarEnd &&
        row.sellDate >= context.calendarStart &&
        row.sellDate <= context.calendarEnd,
    )
    .map((row) => {
      const rangeStart = row.buyDate > context.calendarStart ? row.buyDate : context.calendarStart
      const rangeEnd = row.sellDate < context.calendarEnd ? row.sellDate : context.calendarEnd
      const maxPriceResult = getMaxPriceForRange(
        historicalPrices,
        row.stockSymbol,
        rangeStart,
        rangeEnd,
      )
      const buyFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.buyDate)
      const sellFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.sellDate)
      const maxInrResult = getMaxInrAmountForRange(
        historicalPrices,
        exchangeRates,
        row.stockSymbol,
        rangeStart,
        rangeEnd,
        row.sharesMatched,
      )
      const maxPricePerShareUsd = maxPriceResult?.price ?? null

      return {
        id: `${row.id}-fa-long`,
        stockSymbol: row.stockSymbol,
        holdingType: 'Long Shares Sold',
        buyDate: row.buyDate,
        sellDate: row.sellDate,
        grantName: row.grantName,
        shares: row.sharesMatched,
        buyPricePerShareUsd: row.buyPricePerShareUsd,
        sellPricePerShareUsd: row.sellPricePerShareUsd,
        buyAmountUsd: row.buyAmountUsd,
        sellAmountUsd: row.sellAmountUsd,
        buyFxRate: buyFxLookup?.rate ?? null,
        buyFxRateDate: buyFxLookup?.rateDate ?? null,
        buyAmountInr:
          buyFxLookup !== null ? Number((row.buyAmountUsd * buyFxLookup.rate).toFixed(2)) : null,
        sellFxRate: sellFxLookup?.rate ?? null,
        sellFxRateDate: sellFxLookup?.rateDate ?? null,
        sellAmountInr:
          sellFxLookup !== null ? Number((row.sellAmountUsd * sellFxLookup.rate).toFixed(2)) : null,
        dividendReceivedUsd: 0,
        dividendFxRate: null,
        dividendFxDate: null,
        dividendReceivedInr: 0,
        maxPricePerShareUsd,
        maxPriceDate: maxPriceResult?.date ?? null,
        maxFxRate: maxInrResult?.fxRate ?? null,
        maxFxRateDate: maxInrResult?.fxRateDate ?? null,
        maxAmountInrDate: maxInrResult?.priceDate ?? null,
        maxAmountInr: maxInrResult?.amountInr ?? null,
        maxAmountUsd:
          maxPricePerShareUsd !== null
            ? Number((maxPricePerShareUsd * row.sharesMatched).toFixed(2))
            : null,
        closingPricePerShareUsd: 0,
        closingFxRate: null,
        closingFxRateDate: null,
        closingAmountInr: 0,
        closingAmountUsd: 0,
      }
    })

  const coverRows = sellToCoverRows
    .filter(
      (row) =>
        row.buyDate <= context.calendarEnd &&
        row.sellDate >= context.calendarStart &&
        row.sellDate <= context.calendarEnd,
    )
    .map((row) => {
      const rangeStart = row.buyDate > context.calendarStart ? row.buyDate : context.calendarStart
      const rangeEnd = row.sellDate < context.calendarEnd ? row.sellDate : context.calendarEnd
      const maxPriceResult = getMaxPriceForRange(
        historicalPrices,
        row.stockSymbol,
        rangeStart,
        rangeEnd,
      )
      const buyFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.buyDate)
      const sellFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.sellDate)
      const maxInrResult = getMaxInrAmountForRange(
        historicalPrices,
        exchangeRates,
        row.stockSymbol,
        rangeStart,
        rangeEnd,
        row.sharesMatched,
      )
      const maxPricePerShareUsd = maxPriceResult?.price ?? null

      return {
        id: `${row.id}-fa-cover`,
        stockSymbol: row.stockSymbol,
        holdingType: 'Sell-To-Cover',
        buyDate: row.buyDate,
        sellDate: row.sellDate,
        grantName: row.grantName,
        shares: row.sharesMatched,
        buyPricePerShareUsd: row.buyPricePerShareUsd,
        sellPricePerShareUsd: row.sellPricePerShareUsd,
        buyAmountUsd: row.buyAmountUsd,
        sellAmountUsd: row.sellAmountUsd,
        buyFxRate: buyFxLookup?.rate ?? null,
        buyFxRateDate: buyFxLookup?.rateDate ?? null,
        buyAmountInr:
          buyFxLookup !== null ? Number((row.buyAmountUsd * buyFxLookup.rate).toFixed(2)) : null,
        sellFxRate: sellFxLookup?.rate ?? null,
        sellFxRateDate: sellFxLookup?.rateDate ?? null,
        sellAmountInr:
          sellFxLookup !== null ? Number((row.sellAmountUsd * sellFxLookup.rate).toFixed(2)) : null,
        dividendReceivedUsd: 0,
        dividendFxRate: null,
        dividendFxDate: null,
        dividendReceivedInr: 0,
        maxPricePerShareUsd,
        maxPriceDate: maxPriceResult?.date ?? null,
        maxFxRate: maxInrResult?.fxRate ?? null,
        maxFxRateDate: maxInrResult?.fxRateDate ?? null,
        maxAmountInrDate: maxInrResult?.priceDate ?? null,
        maxAmountInr: maxInrResult?.amountInr ?? null,
        maxAmountUsd:
          maxPricePerShareUsd !== null
            ? Number((maxPricePerShareUsd * row.sharesMatched).toFixed(2))
            : null,
        closingPricePerShareUsd: 0,
        closingFxRate: null,
        closingFxRateDate: null,
        closingAmountInr: 0,
        closingAmountUsd: 0,
      }
    })

  const openRows = openHoldings
    .filter((row) => row.buyDate <= context.calendarEnd)
    .map((row) => {
      const rangeStart = row.buyDate > context.calendarStart ? row.buyDate : context.calendarStart
      const maxPriceResult = getMaxPriceForRange(
        historicalPrices,
        row.stockSymbol,
        rangeStart,
        context.calendarEnd,
      )
      const buyFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.buyDate)
      const maxInrResult = getMaxInrAmountForRange(
        historicalPrices,
        exchangeRates,
        row.stockSymbol,
        rangeStart,
        context.calendarEnd,
        row.sharesRemaining,
      )
      const maxPricePerShareUsd = maxPriceResult?.price ?? null
      const closingPricePerShareUsd = getClosingPriceOnOrBefore(
        historicalPrices,
        row.stockSymbol,
        context.calendarEnd,
      )
      const closingAmountUsd =
        closingPricePerShareUsd !== null
          ? Number((closingPricePerShareUsd * row.sharesRemaining).toFixed(2))
          : null
      const closingFxLookup = getExchangeRateOnOrBefore(exchangeRates, context.calendarEnd)

      return {
        id: `${row.id}-fa-open`,
        stockSymbol: row.stockSymbol,
        holdingType: 'Still Holding',
        buyDate: row.buyDate,
        sellDate: null,
        grantName: row.grantName,
        shares: row.sharesRemaining,
        buyPricePerShareUsd: row.buyPricePerShareUsd,
        sellPricePerShareUsd: null,
        buyAmountUsd: row.costBasisUsd,
        sellAmountUsd: null,
        buyFxRate: buyFxLookup?.rate ?? null,
        buyFxRateDate: buyFxLookup?.rateDate ?? null,
        buyAmountInr:
          buyFxLookup !== null ? Number((row.costBasisUsd * buyFxLookup.rate).toFixed(2)) : null,
        sellFxRate: null,
        sellFxRateDate: null,
        sellAmountInr: null,
        dividendReceivedUsd: 0,
        dividendFxRate: null,
        dividendFxDate: null,
        dividendReceivedInr: 0,
        maxPricePerShareUsd,
        maxPriceDate: maxPriceResult?.date ?? null,
        maxFxRate: maxInrResult?.fxRate ?? null,
        maxFxRateDate: maxInrResult?.fxRateDate ?? null,
        maxAmountInrDate: maxInrResult?.priceDate ?? null,
        maxAmountInr: maxInrResult?.amountInr ?? null,
        maxAmountUsd:
          maxPricePerShareUsd !== null
            ? Number((maxPricePerShareUsd * row.sharesRemaining).toFixed(2))
            : null,
        closingPricePerShareUsd,
        closingFxRate: closingFxLookup?.rate ?? null,
        closingFxRateDate: closingFxLookup?.rateDate ?? null,
        closingAmountInr:
          closingAmountUsd !== null && closingFxLookup !== null
            ? Number((closingAmountUsd * closingFxLookup.rate).toFixed(2))
            : null,
        closingAmountUsd,
      }
    })

  return allocateDividendsToScheduleFaRows(
    [...matchedRows, ...coverRows, ...openRows].sort(sortBySymbolBuyDateThenSellDate),
    dividendRows,
    exchangeRates,
    context,
  )
}
