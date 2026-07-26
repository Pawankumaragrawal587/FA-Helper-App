import Papa from 'papaparse'

import type { HistoricalPriceRow, ParsedHistoricalPriceFile } from '../types'

function parseUsdAmount(value: string): number {
  const normalized = value.replaceAll(',', '').replaceAll('$', '').trim()
  if (!normalized) {
    return 0
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unable to parse USD amount "${value}".`)
  }

  return parsed
}

function parseUsDate(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)

  if (!match) {
    throw new Error(`Unable to parse historical price date "${value}".`)
  }

  const [, monthString, dayString, yearString] = match
  const date = new Date(
    Date.UTC(Number(yearString), Number(monthString) - 1, Number(dayString)),
  )
  return date.toISOString().slice(0, 10)
}

export function parseHistoricalPriceCsv(csvText: string): ParsedHistoricalPriceFile {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0) {
    const firstError = result.errors[0]
    throw new Error(`CSV parsing failed near row ${firstError.row}: ${firstError.message}`)
  }

  const rows: HistoricalPriceRow[] = result.data
    .filter((row) => row.Date && row['Close/Last'] && row.High)
    .map((row) => ({
      date: parseUsDate(row.Date),
      closePriceUsd: parseUsdAmount(row['Close/Last']),
      highPriceUsd: parseUsdAmount(row.High),
    }))
    .sort((left, right) => left.date.localeCompare(right.date))

  if (rows.length === 0) {
    throw new Error('No historical price rows were found in the uploaded CSV.')
  }

  return {
    reportName: 'Historical Prices',
    rows,
  }
}
