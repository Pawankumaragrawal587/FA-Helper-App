import { getExchangeRateOnOrBefore, getMaxInrAmountForRange } from './exchangeRates'
import type {
  ExchangeRateRow,
  FifoMatchedLot,
  HistoricalPriceRow,
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

export function buildScheduleFaRows(
  lifetimeMatchedLots: FifoMatchedLot[],
  sellToCoverRows: ScheduleFaSellToCoverRow[],
  openHoldings: OpenHolding[],
  historicalPrices: HistoricalPriceRow[],
  exchangeRates: ExchangeRateRow[],
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

  return [...matchedRows, ...coverRows, ...openRows].sort(sortBySymbolBuyDateThenSellDate)
}
