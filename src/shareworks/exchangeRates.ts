import Papa from 'papaparse'

import type { ExchangeRateRow, HistoricalPriceRow, ParsedExchangeRateFile } from '../types'

export interface ExchangeRateLookupResult {
  rate: number
  targetDate: string
  rateDate: string
  usedFallback: boolean
}

export interface MaxInrAmountResult {
  amountInr: number
  priceDate: string
  fxRate: number
  fxRateDate: string
  usedFallback: boolean
}

function parseNumber(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) {
    return 0
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unable to parse exchange-rate value "${value}".`)
  }

  return parsed
}

function parseRateDate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Exchange-rate row is missing a DATE value.')
  }

  return trimmed.slice(0, 10)
}

export function parseExchangeRateCsv(csvText: string): ParsedExchangeRateFile {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0) {
    const firstError = result.errors[0]
    throw new Error(`CSV parsing failed near row ${firstError.row}: ${firstError.message}`)
  }

  const rowsByDate = new Map<string, ExchangeRateRow>()

  result.data
    .filter((row) => row.DATE)
    .forEach((row) => {
      const date = parseRateDate(row.DATE)
      rowsByDate.set(date, {
        date,
        ttBuyInr: parseNumber(row['TT BUY'] ?? '0'),
      })
    })

  const rows = [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date))

  if (rows.length === 0) {
    throw new Error('No exchange-rate rows were found in the uploaded CSV.')
  }

  return {
    reportName: 'SBI Reference Rates',
    rows,
  }
}

export function getExchangeRateOnOrBefore(
  exchangeRates: ExchangeRateRow[],
  targetDate: string,
): ExchangeRateLookupResult | null {
  for (let index = exchangeRates.length - 1; index >= 0; index -= 1) {
    const row = exchangeRates[index]
    if (row.date > targetDate) {
      continue
    }

    if (row.ttBuyInr > 0) {
      return {
        rate: row.ttBuyInr,
        targetDate,
        rateDate: row.date,
        usedFallback: row.date !== targetDate,
      }
    }
  }

  return null
}

export function getPreviousMonthEnd(date: string): string {
  const [yearString, monthString] = date.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthString) - 1
  const previousMonthEnd = new Date(Date.UTC(year, monthIndex, 0))

  return previousMonthEnd.toISOString().slice(0, 10)
}

export function getCapitalGainsExchangeRate(
  exchangeRates: ExchangeRateRow[],
  transactionDate: string,
): ExchangeRateLookupResult | null {
  return getExchangeRateOnOrBefore(exchangeRates, getPreviousMonthEnd(transactionDate))
}

export function getMaxInrAmountForRange(
  historicalPrices: HistoricalPriceRow[],
  exchangeRates: ExchangeRateRow[],
  startDate: string,
  endDate: string,
  shares: number,
): MaxInrAmountResult | null {
  const matchingPrices = historicalPrices.filter((row) => row.date >= startDate && row.date <= endDate)

  let bestResult: MaxInrAmountResult | null = null

  matchingPrices.forEach((priceRow) => {
    const fxLookup = getExchangeRateOnOrBefore(exchangeRates, priceRow.date)
    if (!fxLookup) {
      return
    }

    const amountInr = Number((priceRow.highPriceUsd * fxLookup.rate * shares).toFixed(2))

    if (!bestResult || amountInr > bestResult.amountInr) {
      bestResult = {
        amountInr,
        priceDate: priceRow.date,
        fxRate: fxLookup.rate,
        fxRateDate: fxLookup.rateDate,
        usedFallback: fxLookup.usedFallback,
      }
    }
  })

  return bestResult
}
