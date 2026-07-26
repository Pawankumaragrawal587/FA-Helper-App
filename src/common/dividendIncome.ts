import { getCapitalGainsExchangeRate } from './exchangeRates'
import type { ExchangeRateRow, IbkrDividendRecord } from '../types'

export interface DividendIncomeContext {
  financialStart: string
  financialEnd: string
}

export interface DividendIncomeRow {
  id: string
  stockSymbol: string
  dividendDate: string
  description: string
  dividendAmountUsd: number
  fxRate: number | null
  fxRateDate: string | null
  dividendAmountInr: number | null
}

function sortDividendIncomeRows(left: DividendIncomeRow, right: DividendIncomeRow): number {
  if (left.stockSymbol !== right.stockSymbol) {
    return left.stockSymbol.localeCompare(right.stockSymbol)
  }

  if (left.dividendDate !== right.dividendDate) {
    return left.dividendDate.localeCompare(right.dividendDate)
  }

  return left.description.localeCompare(right.description)
}

export function buildDividendIncomeRows(
  dividendRows: IbkrDividendRecord[],
  exchangeRates: ExchangeRateRow[],
  context: DividendIncomeContext,
): DividendIncomeRow[] {
  return dividendRows
    .filter(
      (row) => row.tradeDate >= context.financialStart && row.tradeDate <= context.financialEnd,
    )
    .map((row) => {
      const fxLookup = getCapitalGainsExchangeRate(exchangeRates, row.tradeDate)

      return {
        id: `dividend-${row.stockSymbol}-${row.sourceRowNumber}`,
        stockSymbol: row.stockSymbol,
        dividendDate: row.tradeDate,
        description: row.description,
        dividendAmountUsd: row.netAmountUsd,
        fxRate: fxLookup?.rate ?? null,
        fxRateDate: fxLookup?.rateDate ?? null,
        dividendAmountInr:
          fxLookup !== null ? Number((row.netAmountUsd * fxLookup.rate).toFixed(2)) : null,
      }
    })
    .sort(sortDividendIncomeRows)
}
