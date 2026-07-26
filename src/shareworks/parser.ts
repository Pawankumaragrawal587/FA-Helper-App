import Papa from 'papaparse'

import type { IgnoredRowDetail, ParsedShareworksFile, ShareworksSaleRecord } from '../types'

const TITLE_ROW_INDEX = 0
const HEADER_ROW_INDEX = 1
const FIRST_DATA_ROW_INDEX = 2
const EXPECTED_MIN_COLUMNS = 24

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

function isTotalsRow(row: string[]): boolean {
  return getCell(row, 8) === '' && getCell(row, 15) !== ''
}

function isDataRow(row: string[]): boolean {
  return getCell(row, 8) !== '' && getCell(row, 9) !== '' && getCell(row, 15) !== ''
}

function buildPreview(row: string[]): string {
  const preview = row
    .map((cell) => cell.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' | ')

  return preview || '(empty row)'
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
  const saleDateHeader = getCell(headerRow, 8)
  const acquisitionDateHeader = getCell(headerRow, 9)
  const sharesHeader = getCell(headerRow, 15)

  if (
    saleDateHeader !== 'Sale Date' ||
    acquisitionDateHeader !== 'Original Acquisition Date' ||
    sharesHeader !== 'Shares Sold'
  ) {
    throw new Error('The uploaded file does not match the expected Shareworks sales format.')
  }
}

function mapRowToSaleRecord(row: string[], sourceRowNumber: number): ShareworksSaleRecord {
  return {
    broker: 'shareworks',
    sourceRowNumber,
    periodStartDate: parseShareworksDate(getCell(row, 0)),
    periodEndDate: parseShareworksDate(getCell(row, 1)),
    withdrawalReferenceNumber: getCell(row, 2),
    originatingReleaseReferenceNumber: getCell(row, 3),
    employeeGrantNumber: getCell(row, 4),
    grantName: getCell(row, 5),
    lotNumber: getCell(row, 6),
    saleType: getCell(row, 7),
    saleDate: parseShareworksDate(getCell(row, 8)),
    originalAcquisitionDate: parseShareworksDate(getCell(row, 9)),
    soldWithinThirtyDaysOfVest: getCell(row, 10).toUpperCase() === 'YES',
    originalCostBasisPerShareUsd: parseUsdAmount(getCell(row, 11)),
    originalCostBasisUsd: parseUsdAmount(getCell(row, 13)),
    sharesSold: parseShares(getCell(row, 15)),
    saleProceedsUsd: parseUsdAmount(getCell(row, 16)),
    salePricePerShareUsd: parseUsdAmount(getCell(row, 18)),
    brokerageCommissionUsd: parseUsdAmount(getCell(row, 20)),
    supplementalTransactionFeeUsd: parseUsdAmount(getCell(row, 22)),
  }
}

export function parseShareworksCsv(csvText: string): ParsedShareworksFile {
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

  const parsedRows: ShareworksSaleRecord[] = []
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

    parsedRows.push(mapRowToSaleRecord(row, sourceRowNumber))
  })

  if (parsedRows.length === 0) {
    throw new Error('No Shareworks sale rows were found in the uploaded CSV.')
  }

  return {
    reportName,
    rows: parsedRows,
    ignoredRowCount,
    ignoredRows,
  }
}
