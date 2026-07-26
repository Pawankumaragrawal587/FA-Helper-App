import Papa from 'papaparse'

import type {
  IgnoredRowDetail,
  NormalizedTransaction,
  ParsedShareworksReleasesFile,
  ShareworksReleaseRecord,
} from '../types'

const TITLE_ROW_INDEX = 0
const HEADER_ROW_INDEX = 1
const FIRST_DATA_ROW_INDEX = 2
const EXPECTED_MIN_COLUMNS = 23

const MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

function getCell(row: string[], index: number): string {
  return row[index]?.trim() ?? ''
}

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

function parseShares(value: string): number {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unable to parse shares value "${value}".`)
  }

  return parsed
}

function parseShareworksDate(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)

  if (!match) {
    throw new Error(`Unable to parse Shareworks date "${value}".`)
  }

  const [, dayString, monthString, yearString] = match
  const monthIndex = MONTH_INDEX[monthString]

  if (monthIndex === undefined) {
    throw new Error(`Unknown Shareworks month "${monthString}".`)
  }

  const date = new Date(Date.UTC(Number(yearString), monthIndex, Number(dayString)))
  return date.toISOString().slice(0, 10)
}

function buildPreview(row: string[]): string {
  const preview = row
    .map((cell) => cell.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' | ')

  return preview || '(empty row)'
}

function isTotalsRow(row: string[]): boolean {
  return getCell(row, 7) === '' && getCell(row, 8) !== ''
}

function isDataRow(row: string[]): boolean {
  return getCell(row, 7) !== '' && getCell(row, 8) !== '' && getCell(row, 10) !== ''
}

function buildIgnoredRowDetail(row: string[], sourceRowNumber: number): IgnoredRowDetail {
  if (isTotalsRow(row)) {
    return {
      sourceRowNumber,
      reason: 'Summary totals row',
      preview: buildPreview(row),
    }
  }

  return {
    sourceRowNumber,
    reason: 'Incomplete or unsupported row',
    preview: buildPreview(row),
  }
}

function validateHeaderRow(headerRow: string[]): void {
  const releaseDateHeader = getCell(headerRow, 7)
  const vestedHeader = getCell(headerRow, 8)
  const heldHeader = getCell(headerRow, 10)

  if (
    releaseDateHeader !== 'Release Date' ||
    vestedHeader !== 'Shares Vested' ||
    heldHeader !== 'Shares Held'
  ) {
    throw new Error('The uploaded file does not match the expected Shareworks releases format.')
  }
}

function mapRowToReleaseRecord(row: string[], sourceRowNumber: number): ShareworksReleaseRecord {
  return {
    broker: 'shareworks',
    stockSymbol: 'TEAM',
    sourceRowNumber,
    periodStartDate: parseShareworksDate(getCell(row, 0)),
    periodEndDate: parseShareworksDate(getCell(row, 1)),
    grantDate: parseShareworksDate(getCell(row, 2)),
    grantNumber: getCell(row, 3),
    grantType: getCell(row, 4),
    grantName: getCell(row, 5),
    grantReason: getCell(row, 6),
    releaseDate: parseShareworksDate(getCell(row, 7)),
    sharesVested: parseShares(getCell(row, 8)),
    sharesSoldToCover: parseShares(getCell(row, 9)),
    sharesHeld: parseShares(getCell(row, 10)),
    valueUsd: parseUsdAmount(getCell(row, 11)),
    fairMarketValuePerShareUsd: parseUsdAmount(getCell(row, 13)),
    sellToCoverSaleDate: parseShareworksDate(getCell(row, 15)),
    sellToCoverSalePricePerShareUsd: parseUsdAmount(getCell(row, 16)),
    sellToCoverSaleProceedsUsd: parseUsdAmount(getCell(row, 18)),
    sellToCoverAmountUsd: parseUsdAmount(getCell(row, 20)),
    releaseReferenceNumber: getCell(row, 22),
  }
}

export function parseShareworksReleasesCsv(csvText: string): ParsedShareworksReleasesFile {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  })

  if (result.errors.length > 0) {
    const firstError = result.errors[0]
    throw new Error(`CSV parsing failed near row ${firstError.row}: ${firstError.message}`)
  }

  const rows = result.data

  if (rows.length < FIRST_DATA_ROW_INDEX + 1) {
    throw new Error('The uploaded CSV is missing the required Shareworks header rows.')
  }

  const reportName = getCell(rows[TITLE_ROW_INDEX], 0)
  const headerRow = rows[HEADER_ROW_INDEX]

  if (headerRow.length < EXPECTED_MIN_COLUMNS) {
    throw new Error('The uploaded CSV does not contain the expected Shareworks columns.')
  }

  validateHeaderRow(headerRow)

  const parsedRows: ShareworksReleaseRecord[] = []
  const ignoredRows: IgnoredRowDetail[] = []
  let ignoredRowCount = 0

  rows.slice(FIRST_DATA_ROW_INDEX).forEach((row, index) => {
    const sourceRowNumber = index + FIRST_DATA_ROW_INDEX + 1

    if (isTotalsRow(row)) {
      ignoredRowCount += 1
      ignoredRows.push(buildIgnoredRowDetail(row, sourceRowNumber))
      return
    }

    if (!isDataRow(row)) {
      ignoredRowCount += 1
      ignoredRows.push(buildIgnoredRowDetail(row, sourceRowNumber))
      return
    }

    parsedRows.push(mapRowToReleaseRecord(row, sourceRowNumber))
  })

  if (parsedRows.length === 0) {
    throw new Error('No Shareworks release rows were found in the uploaded CSV.')
  }

  return {
    reportName,
    rows: parsedRows,
    ignoredRowCount,
    ignoredRows,
  }
}

export function deriveReleaseTransactions(
  rows: ShareworksReleaseRecord[],
): NormalizedTransaction[] {
  return rows.flatMap((row) => {
    const transactions: NormalizedTransaction[] = []

    if (row.sharesHeld > 0) {
      transactions.push({
        id: `${row.releaseReferenceNumber}-${row.sourceRowNumber}-held`,
        broker: row.broker,
        stockSymbol: row.stockSymbol,
        transactionType: 'ACQUIRE',
        grantName: row.grantName,
        grantNumber: row.grantNumber,
        withdrawalReferenceNumber: row.releaseReferenceNumber,
        originatingReleaseReferenceNumber: row.releaseReferenceNumber,
        lotNumber: 'held',
        tradeDate: row.releaseDate,
        acquisitionDate: row.releaseDate,
        shares: row.sharesHeld,
        pricePerShareUsd: row.fairMarketValuePerShareUsd,
        grossAmountUsd: Number((row.sharesHeld * row.fairMarketValuePerShareUsd).toFixed(2)),
        feeUsd: 0,
        sourceRowNumber: row.sourceRowNumber,
      })
    }

    if (row.sharesSoldToCover > 0) {
      transactions.push({
        id: `${row.releaseReferenceNumber}-${row.sourceRowNumber}-cover`,
        broker: row.broker,
        stockSymbol: row.stockSymbol,
        transactionType: 'SELL_TO_COVER',
        grantName: row.grantName,
        grantNumber: row.grantNumber,
        withdrawalReferenceNumber: row.releaseReferenceNumber,
        originatingReleaseReferenceNumber: row.releaseReferenceNumber,
        lotNumber: 'cover',
        tradeDate: row.sellToCoverSaleDate,
        acquisitionDate: row.releaseDate,
        shares: row.sharesSoldToCover,
        pricePerShareUsd: row.sellToCoverSalePricePerShareUsd,
        grossAmountUsd: row.sellToCoverSaleProceedsUsd,
        feeUsd: Number((row.sellToCoverSaleProceedsUsd - row.sellToCoverAmountUsd).toFixed(2)),
        sourceRowNumber: row.sourceRowNumber,
      })
    }

    return transactions
  })
}
