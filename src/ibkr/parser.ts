import Papa from 'papaparse'

import type {
  IbkrDividendRecord,
  IbkrTransactionRecord,
  IgnoredRowDetail,
  NormalizedTransaction,
  ParsedIbkrFile,
} from '../types'

const SUPPORTED_TRADE_TRANSACTION_TYPES = new Set(['Buy', 'Sell'])
const DIVIDEND_TRANSACTION_TYPE = 'Dividend'

function getCell(row: string[], index: number): string {
  return row[index]?.trim() ?? ''
}

function parseNumber(value: string, label: string): number {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '-') {
    return 0
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unable to parse IBKR ${label} value "${value}".`)
  }

  return parsed
}

function parseTradeDate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new Error(`Unable to parse IBKR trade date "${value}".`)
  }

  return trimmed
}

function buildPreview(row: string[]): string {
  const preview = row
    .map((cell) => cell.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(' | ')

  return preview || '(empty row)'
}

function buildIgnoredRowDetail(row: string[], sourceRowNumber: number, reason: string): IgnoredRowDetail {
  return {
    sourceRowNumber,
    reason,
    preview: buildPreview(row),
  }
}

function validateHeaderRow(row: string[]): void {
  if (
    getCell(row, 2) !== 'Date' ||
    getCell(row, 5) !== 'Transaction Type' ||
    getCell(row, 6) !== 'Symbol' ||
    getCell(row, 7) !== 'Quantity' ||
    getCell(row, 8) !== 'Price'
  ) {
    throw new Error('The uploaded file does not match the expected IBKR transactions format.')
  }
}

function mapRowToIbkrRecord(row: string[], sourceRowNumber: number): IbkrTransactionRecord {
  return {
    broker: 'ibkr',
    stockSymbol: getCell(row, 6),
    sourceRowNumber,
    tradeDate: parseTradeDate(getCell(row, 2)),
    description: getCell(row, 4),
    transactionTypeLabel: getCell(row, 5),
    quantity: parseNumber(getCell(row, 7), 'quantity'),
    pricePerShareUsd: Math.abs(parseNumber(getCell(row, 8), 'price')),
    grossAmountUsd: Math.abs(parseNumber(getCell(row, 10), 'gross amount')),
    commissionUsd: Math.abs(parseNumber(getCell(row, 11), 'commission')),
    netAmountUsd: parseNumber(getCell(row, 12), 'net amount'),
  }
}

function mapRowToIbkrDividendRecord(row: string[], sourceRowNumber: number): IbkrDividendRecord {
  return {
    broker: 'ibkr',
    stockSymbol: getCell(row, 6),
    sourceRowNumber,
    tradeDate: parseTradeDate(getCell(row, 2)),
    description: getCell(row, 4),
    transactionTypeLabel: getCell(row, 5),
    netAmountUsd: parseNumber(getCell(row, 12), 'net amount'),
  }
}

export function parseIbkrTransactionsCsv(csvText: string): ParsedIbkrFile {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  })

  if (result.errors.length > 0) {
    const firstError = result.errors[0]
    throw new Error(`CSV parsing failed near row ${firstError.row}: ${firstError.message}`)
  }

  const rows = result.data
  const headerIndex = rows.findIndex(
    (row) => getCell(row, 0) === 'Transaction History' && getCell(row, 1) === 'Header',
  )

  if (headerIndex === -1) {
    throw new Error('The uploaded CSV is missing the IBKR transaction-history header row.')
  }

  validateHeaderRow(rows[headerIndex])

  const parsedRows: IbkrTransactionRecord[] = []
  const dividendRows: IbkrDividendRecord[] = []
  const ignoredRows: IgnoredRowDetail[] = []

  rows.slice(headerIndex + 1).forEach((row, index) => {
    const sourceRowNumber = headerIndex + index + 2

    if (getCell(row, 0) !== 'Transaction History' || getCell(row, 1) !== 'Data') {
      return
    }

    const transactionTypeLabel = getCell(row, 5)
    const symbol = getCell(row, 6)

    if (transactionTypeLabel === DIVIDEND_TRANSACTION_TYPE) {
      dividendRows.push(mapRowToIbkrDividendRecord(row, sourceRowNumber))
      return
    }

    if (!SUPPORTED_TRADE_TRANSACTION_TYPES.has(transactionTypeLabel)) {
      ignoredRows.push(
        buildIgnoredRowDetail(row, sourceRowNumber, 'Unsupported IBKR transaction type'),
      )
      return
    }

    if (!symbol || symbol === '-') {
      ignoredRows.push(buildIgnoredRowDetail(row, sourceRowNumber, 'Missing or unsupported symbol'))
      return
    }

    parsedRows.push(mapRowToIbkrRecord(row, sourceRowNumber))
  })

  if (parsedRows.length === 0) {
    throw new Error('No IBKR buy or sell rows were found in the uploaded CSV.')
  }

  const uniqueSymbols = [...new Set(parsedRows.map((row) => row.stockSymbol))].sort()

  return {
    reportName: 'IBKR Transaction History',
    rows: parsedRows,
    dividendRows,
    uniqueSymbols,
    ignoredRowCount: ignoredRows.length,
    ignoredRows,
  }
}

export function deriveIbkrTransactions(rows: IbkrTransactionRecord[]): NormalizedTransaction[] {
  return rows.map((row) => {
    const shares = Math.abs(row.quantity)
    const transactionType = row.transactionTypeLabel === 'Buy' ? 'ACQUIRE' : 'SELL'

    return {
      id: `ibkr-${row.stockSymbol}-${row.sourceRowNumber}-${transactionType.toLowerCase()}`,
      broker: row.broker,
      stockSymbol: row.stockSymbol,
      transactionType,
      grantName: row.stockSymbol,
      grantNumber: row.stockSymbol,
      withdrawalReferenceNumber: `ibkr-${row.sourceRowNumber}`,
      originatingReleaseReferenceNumber: `ibkr-${row.sourceRowNumber}`,
      lotNumber: `${row.sourceRowNumber}`,
      tradeDate: row.tradeDate,
      acquisitionDate: row.tradeDate,
      shares,
      pricePerShareUsd: row.pricePerShareUsd,
      grossAmountUsd: row.grossAmountUsd,
      feeUsd: row.commissionUsd,
      sourceRowNumber: row.sourceRowNumber,
    }
  })
}
