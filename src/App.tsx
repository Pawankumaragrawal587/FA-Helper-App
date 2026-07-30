import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import exchangeRateSampleCsv from '../sample/SBI_REFERENCE_RATES_USD.sample.csv?raw'
import ibkrTransactionSampleCsv from '../sample/IBKR Transactions.sample.csv?raw'
import historicalPriceSampleCsv from '../sample/TEAM-HistoricalData.sample.csv?raw'
import releasesSampleCsv from '../sample/RSU Releases.sample.csv?raw'
import salesSampleCsv from '../sample/Sales - Long Shares.sample.csv?raw'

import './App.css'
import { buildDividendIncomeRows } from './common/dividendIncome'
import { buildFifoReport } from './common/fifo'
import {
  getCapitalGainsExchangeRate,
  parseExchangeRateCsv,
} from './common/exchangeRates'
import { parseHistoricalPriceCsv } from './common/historicalPrices'
import { buildScheduleFaA2Rows } from './common/scheduleFaA2'
import { buildScheduleFaRows } from './common/scheduleFa'
import { deriveIbkrTransactions, parseIbkrTransactionsCsv } from './ibkr/parser'
import { parseShareworksCsv } from './shareworks/parser'
import { deriveReleaseTransactions, parseShareworksReleasesCsv } from './shareworks/releases'
import { deriveLongShareSaleTransactions } from './shareworks/transform'
import type { DividendIncomeRow } from './common/dividendIncome'
import type { ScheduleFaA2Row } from './common/scheduleFaA2'
import type {
  BrokerType,
  ExchangeRateRow,
  FifoMatchedLot,
  FifoReport,
  ParsedIbkrFile,
  NormalizedTransaction,
  ParsedExchangeRateFile,
  OpenHolding,
  ParsedHistoricalPriceFile,
  ParsedShareworksFile,
  ParsedShareworksReleasesFile,
} from './types'

const BROKER_OPTIONS: Array<{ value: BrokerType; label: string }> = [
  { value: 'shareworks', label: 'Shareworks (Atlassian RSU)' },
  { value: 'ibkr', label: 'IBKR (Consolidated Transactions)' },
]

type LogLevel = 'info' | 'warning' | 'error'
type ReportTabId = 'overview' | 'faA2' | 'faA3' | 'capitalGains' | 'dividendIncome'
type AppPageId = 'landing' | 'builder' | 'samples'

interface CsvColumn<T> {
  header: string
  value: (row: T) => number | string | null | undefined
}

interface UiLogEntry {
  id: string
  level: LogLevel
  message: string
}

interface SellToCoverDisplayRow {
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

interface CapitalGainDisplayRow {
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
  buyFxRate: number | null
  buyFxTargetDate: string | null
  buyFxRateDate: string | null
  sellFxRate: number | null
  sellFxTargetDate: string | null
  sellFxRateDate: string | null
  buyAmountInr: number | null
  sellAmountInr: number | null
  gainOrLossInr: number | null
}

interface ScheduleFaRow {
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

interface AssessmentYearContext {
  assessmentYearLabel: string
  assessmentYearStart: number
  calendarStart: string
  calendarEnd: string
  financialStart: string
  financialEnd: string
}

type UploadStatus = 'pending' | 'ready' | 'locked'

interface SampleTableDefinition {
  id: string
  title: string
  description: string
  csvText: string
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function formatUiDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return Number(items.reduce((total, item) => total + getValue(item), 0).toFixed(2))
}

function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value)
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function downloadCsvFile<T>(fileName: string, columns: CsvColumn<T>[], rows: T[]): void {
  const csv = Papa.unparse(
    rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column.header, column.value(row) ?? ''])),
    ),
  )

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sanitizeFileName(fileName)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`
  }

  if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
}

function createLog(level: LogLevel, message: string): UiLogEntry {
  return {
    id: `${level}-${crypto.randomUUID()}`,
    level,
    message,
  }
}

function getHistoricalPriceFileSymbol(fileName: string): string | null {
  const underscoreIndex = fileName.indexOf('_')
  if (underscoreIndex <= 0) {
    return null
  }

  const symbol = fileName.slice(0, underscoreIndex).trim().toUpperCase()
  return symbol || null
}

function buildAssessmentYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

function parseAssessmentYearStart(label: string): number {
  return Number(label.slice(0, 4))
}

function getAssessmentYearContext(label: string): AssessmentYearContext {
  const assessmentYearStart = parseAssessmentYearStart(label)
  const baseYear = assessmentYearStart - 1

  return {
    assessmentYearLabel: label,
    assessmentYearStart,
    calendarStart: `${baseYear}-01-01`,
    calendarEnd: `${baseYear}-12-31`,
    financialStart: `${baseYear}-04-01`,
    financialEnd: `${baseYear + 1}-03-31`,
  }
}

function isWithinRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

function sortByBuyDateThenSellDate<
  T extends { stockSymbol?: string; buyDate: string; sellDate?: string | null; grantName?: string }
>(left: T, right: T): number {
  const leftSymbol = left.stockSymbol ?? ''
  const rightSymbol = right.stockSymbol ?? ''

  if (leftSymbol !== rightSymbol) {
    return leftSymbol.localeCompare(rightSymbol)
  }

  if (left.buyDate !== right.buyDate) {
    return left.buyDate.localeCompare(right.buyDate)
  }

  const leftSellDate = left.sellDate ?? '9999-12-31'
  const rightSellDate = right.sellDate ?? '9999-12-31'

  if (leftSellDate !== rightSellDate) {
    return leftSellDate.localeCompare(rightSellDate)
  }

  return (left.grantName ?? '').localeCompare(right.grantName ?? '')
}

function inferAssessmentYearStart(
  parsedSalesFile: ParsedShareworksFile | null,
  parsedReleasesFile: ParsedShareworksReleasesFile | null,
  parsedIbkrFile: ParsedIbkrFile | null,
): number {
  const candidateYears = [
    ...(parsedSalesFile?.rows.map((row) => Number(row.saleDate.slice(0, 4))) ?? []),
    ...(parsedReleasesFile?.rows.map((row) => Number(row.releaseDate.slice(0, 4))) ?? []),
    ...(parsedIbkrFile?.rows.map((row) => Number(row.tradeDate.slice(0, 4))) ?? []),
  ]

  if (candidateYears.length === 0) {
    return new Date().getUTCFullYear()
  }

  return Math.max(...candidateYears) + 1
}

function buildAssessmentYearOptions(suggestedStartYear: number): string[] {
  return [suggestedStartYear - 1, suggestedStartYear, suggestedStartYear + 1].map((year) =>
    buildAssessmentYearLabel(year),
  )
}

function getPageFromHash(hash: string): AppPageId {
  if (hash === '#app') {
    return 'builder'
  }

  if (hash === '#samples') {
    return 'samples'
  }

  return 'landing'
}

function getSampleTablePreview(csvText: string): { headers: string[]; rows: string[][] } {
  const parsed = Papa.parse<string[]>(csvText.trim(), { skipEmptyLines: true })
  const rows = parsed.data.filter((row) => row.some((cell) => cell.trim() !== ''))
  const normalizedRows = rows[0]?.length === 1 && (rows[1]?.length ?? 0) > 1 ? rows.slice(1) : rows
  const [headers = [], ...dataRows] = normalizedRows

  return {
    headers,
    rows: dataRows.slice(0, 2),
  }
}

function UploadFieldCard({
  label,
  helperText,
  file,
  status,
  statusLabel,
  onChange,
}: {
  label: string
  helperText: string
  file: File | null
  status: UploadStatus
  statusLabel: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className={`upload-card ${status}`}>
      <div className="upload-card-header">
        <div>
          <span className="upload-card-label">{label}</span>
          <p className="upload-card-helper">{helperText}</p>
        </div>
        <span className={`status-pill ${status}`}>{statusLabel}</span>
      </div>
      <FilePicker file={file} onChange={onChange} />
      <div className="upload-card-meta">
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)}</span>
          </>
        ) : status === 'locked' ? (
          <span>Select Shareworks to enable this file input.</span>
        ) : (
          <span>No file selected yet.</span>
        )}
      </div>
    </label>
  )
}

function FilePicker({
  file,
  displayText,
  onChange,
  buttonLabel = 'Choose file',
  compact = false,
  multiple = false,
}: {
  file: File | null
  displayText?: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  buttonLabel?: string
  compact?: boolean
  multiple?: boolean
}) {
  return (
    <label className={`file-picker ${compact ? 'compact' : ''}`}>
      <span className="file-picker-button">{buttonLabel}</span>
      <span className="file-picker-text">{displayText ?? (file ? file.name : 'No file chosen')}</span>
      <input type="file" accept=".csv,text/csv" multiple={multiple} onChange={onChange} />
    </label>
  )
}

function SymbolHistoricalPriceUploadCard({
  symbols,
  filesBySymbol,
  onChangeForSymbol,
  bulkFileCount,
  onBulkChange,
}: {
  symbols: string[]
  filesBySymbol: Record<string, File | null>
  onChangeForSymbol: (symbol: string) => (event: ChangeEvent<HTMLInputElement>) => void
  bulkFileCount: number
  onBulkChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  const selectedCount = symbols.filter((symbol) => filesBySymbol[symbol]).length
  const bulkSelectionLabel =
    bulkFileCount === 0
      ? 'No files chosen'
      : bulkFileCount === 1
        ? '1 file selected'
        : `${bulkFileCount} files selected`

  return (
    <section className="symbol-upload-panel">
      <div className="section-copy">
        <div>
          <span className="upload-card-label">Historical Price CSVs by Symbol</span>
          <p className="upload-card-helper">
            Upload one historical price CSV for each symbol discovered from the IBKR transactions
            file.
          </p>
        </div>
        {symbols.length > 0 ? (
          <span className="summary-label">
            {selectedCount}/{symbols.length} selected
          </span>
        ) : null}
      </div>

      {symbols.length === 0 ? (
        <div className="upload-card-meta">
          <span>Select the IBKR transactions CSV first to discover symbols.</span>
        </div>
      ) : (
        <div className="symbol-upload-split">
          <div className="symbol-upload-column">
            <span className="summary-label">Per symbol upload</span>
            <div className="symbol-upload-list">
              {symbols.map((symbol) => {
                const file = filesBySymbol[symbol] ?? null

                return (
                  <label key={symbol} className="symbol-upload-row">
                    <div className="symbol-upload-copy">
                      <strong>{symbol}</strong>
                      <span>
                        {file ? `${file.name} (${formatFileSize(file.size)})` : 'No file selected yet.'}
                      </span>
                    </div>
                    <FilePicker file={file} onChange={onChangeForSymbol(symbol)} compact />
                  </label>
                )
              })}
            </div>
          </div>

          <div className="symbol-upload-column">
            <div className="bulk-upload-card">
              <span className="summary-label">Bulk upload all historical files</span>
              <p className="upload-card-helper">
                Expected filename structure: <code>SYMBOL_anything.csv</code>. The text before the
                first underscore is treated as the symbol, for example{' '}
                <code>SHOP_HistoricalDataXYZ.csv</code> maps to <code>SHOP</code>.
              </p>
              <FilePicker
                file={null}
                displayText={bulkSelectionLabel}
                onChange={onBulkChange}
                buttonLabel="Choose files"
                multiple
              />
              <div className="upload-card-meta">
                <span>
                  Matched files will automatically fill the symbol slots on the left. You can still
                  replace any symbol individually afterwards.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function EmptyTableState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-table-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

function SamplePreviewTable({
  title,
  description,
  headers,
  rows,
}: {
  title: string
  description: string
  headers: string[]
  rows: string[][]
}) {
  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="badge">{rows.length} sample rows</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header || 'Column'}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${title}-${rowIndex}`}>
                {headers.map((_, columnIndex) => (
                  <td key={`${title}-${rowIndex}-${columnIndex}`}>{row[columnIndex] || '-'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function buildSellToCoverRows(parsedReleasesFile: ParsedShareworksReleasesFile | null): SellToCoverDisplayRow[] {
  if (!parsedReleasesFile) {
    return []
  }

  return parsedReleasesFile.rows
    .filter((row) => row.sharesSoldToCover > 0)
    .map((row) => {
      const buyAmountUsd = Number((row.sharesSoldToCover * row.fairMarketValuePerShareUsd).toFixed(2))
      const sellAmountUsd = row.sellToCoverSaleProceedsUsd

      return {
        id: `${row.releaseReferenceNumber}-${row.sourceRowNumber}-cover-display`,
        stockSymbol: row.stockSymbol,
        buyDate: row.releaseDate,
        sellDate: row.sellToCoverSaleDate,
        grantName: row.grantName,
        sharesMatched: row.sharesSoldToCover,
        buyPricePerShareUsd: row.fairMarketValuePerShareUsd,
        sellPricePerShareUsd: row.sellToCoverSalePricePerShareUsd,
        buyAmountUsd,
        sellAmountUsd,
        gainOrLossUsd: Number((sellAmountUsd - buyAmountUsd).toFixed(2)),
      }
    })
}

function buildCapitalGainsMatchedRows(
  matchedLots: FifoMatchedLot[],
  exchangeRates: ExchangeRateRow[],
): CapitalGainDisplayRow[] {
  return matchedLots.map((row) => {
    const buyFxLookup = getCapitalGainsExchangeRate(exchangeRates, row.buyDate)
    const sellFxLookup = getCapitalGainsExchangeRate(exchangeRates, row.sellDate)
    const buyAmountInr =
      buyFxLookup !== null ? Number((row.buyAmountUsd * buyFxLookup.rate).toFixed(2)) : null
    const sellAmountInr =
      sellFxLookup !== null ? Number((row.sellAmountUsd * sellFxLookup.rate).toFixed(2)) : null

    return {
      id: `${row.id}-cg`,
      stockSymbol: row.stockSymbol,
      buyDate: row.buyDate,
      sellDate: row.sellDate,
      grantName: row.grantName,
      sharesMatched: row.sharesMatched,
      buyPricePerShareUsd: row.buyPricePerShareUsd,
      sellPricePerShareUsd: row.sellPricePerShareUsd,
      buyAmountUsd: row.buyAmountUsd,
      sellAmountUsd: row.sellAmountUsd,
      gainOrLossUsd: row.gainOrLossUsd,
      buyFxRate: buyFxLookup?.rate ?? null,
      buyFxTargetDate: buyFxLookup?.targetDate ?? null,
      buyFxRateDate: buyFxLookup?.rateDate ?? null,
      sellFxRate: sellFxLookup?.rate ?? null,
      sellFxTargetDate: sellFxLookup?.targetDate ?? null,
      sellFxRateDate: sellFxLookup?.rateDate ?? null,
      buyAmountInr,
      sellAmountInr,
      gainOrLossInr:
        buyAmountInr !== null && sellAmountInr !== null
          ? Number((sellAmountInr - buyAmountInr).toFixed(2))
          : null,
    }
  })
}

function buildCapitalGainsSellToCoverRows(
  sellToCoverRows: SellToCoverDisplayRow[],
  exchangeRates: ExchangeRateRow[],
): CapitalGainDisplayRow[] {
  return sellToCoverRows.map((row) => {
    const buyFxLookup = getCapitalGainsExchangeRate(exchangeRates, row.buyDate)
    const sellFxLookup = getCapitalGainsExchangeRate(exchangeRates, row.sellDate)
    const buyAmountInr =
      buyFxLookup !== null ? Number((row.buyAmountUsd * buyFxLookup.rate).toFixed(2)) : null
    const sellAmountInr =
      sellFxLookup !== null ? Number((row.sellAmountUsd * sellFxLookup.rate).toFixed(2)) : null

    return {
      id: `${row.id}-cg`,
      stockSymbol: row.stockSymbol,
      buyDate: row.buyDate,
      sellDate: row.sellDate,
      grantName: row.grantName,
      sharesMatched: row.sharesMatched,
      buyPricePerShareUsd: row.buyPricePerShareUsd,
      sellPricePerShareUsd: row.sellPricePerShareUsd,
      buyAmountUsd: row.buyAmountUsd,
      sellAmountUsd: row.sellAmountUsd,
      gainOrLossUsd: row.gainOrLossUsd,
      buyFxRate: buyFxLookup?.rate ?? null,
      buyFxTargetDate: buyFxLookup?.targetDate ?? null,
      buyFxRateDate: buyFxLookup?.rateDate ?? null,
      sellFxRate: sellFxLookup?.rate ?? null,
      sellFxTargetDate: sellFxLookup?.targetDate ?? null,
      sellFxRateDate: sellFxLookup?.rateDate ?? null,
      buyAmountInr,
      sellAmountInr,
      gainOrLossInr:
        buyAmountInr !== null && sellAmountInr !== null
          ? Number((sellAmountInr - buyAmountInr).toFixed(2))
          : null,
    }
  })
}

function buildParseLogs(
  parsedSalesFile: ParsedShareworksFile,
  salesFileName: string,
  parsedReleasesFile: ParsedShareworksReleasesFile,
  releasesFileName: string,
  parsedHistoricalPriceFile: ParsedHistoricalPriceFile,
  historicalPriceFileName: string,
  parsedExchangeRateFile: ParsedExchangeRateFile,
  exchangeRateFileName: string,
  releaseTransactions: NormalizedTransaction[],
  longShareSales: NormalizedTransaction[],
  fifoReport: FifoReport,
): UiLogEntry[] {
  const heldTransactions = releaseTransactions.filter(
    (transaction) => transaction.transactionType === 'ACQUIRE',
  )
  const sellToCoverTransactions = releaseTransactions.filter(
    (transaction) => transaction.transactionType === 'SELL_TO_COVER',
  )

  const logs: UiLogEntry[] = [
    createLog('info', `Loaded "${releasesFileName}" as ${parsedReleasesFile.reportName}.`),
    createLog('info', `Loaded "${salesFileName}" as ${parsedSalesFile.reportName}.`),
    createLog(
      'info',
      `Loaded "${historicalPriceFileName}" with ${parsedHistoricalPriceFile.rows.length} historical price rows.`,
    ),
    createLog(
      'info',
      `Loaded "${exchangeRateFileName}" with ${parsedExchangeRateFile.rows.length} TT BUY exchange-rate rows.`,
    ),
    createLog(
      'info',
      `Derived ${heldTransactions.length} held-share acquisition lots and ${sellToCoverTransactions.length} sell-to-cover transactions from ${parsedReleasesFile.rows.length} release rows.`,
    ),
    createLog(
      'info',
      `Derived ${longShareSales.length} long-share sale transactions from ${parsedSalesFile.rows.length} sales rows.`,
    ),
    createLog(
      'info',
      `FIFO matching created ${fifoReport.matchedLots.length} mapped lot entries and ${fifoReport.openHoldings.length} open holding entries.`,
    ),
  ]

  if (parsedReleasesFile.ignoredRows.length > 0) {
    logs.push(
      createLog(
        'warning',
        `Ignored ${parsedReleasesFile.ignoredRows.length} row(s) while parsing the releases CSV.`,
      ),
    )

    parsedReleasesFile.ignoredRows.forEach((row) => {
      logs.push(
        createLog(
          'warning',
          `Releases row ${row.sourceRowNumber}: ${row.reason}. Preview: ${row.preview}`,
        ),
      )
    })
  }

  if (parsedSalesFile.ignoredRows.length > 0) {
    logs.push(
      createLog(
        'warning',
        `Ignored ${parsedSalesFile.ignoredRows.length} row(s) while parsing the long-share sales CSV.`,
      ),
    )

    parsedSalesFile.ignoredRows.forEach((row) => {
      logs.push(
        createLog('warning', `Sales row ${row.sourceRowNumber}: ${row.reason}. Preview: ${row.preview}`),
      )
    })
  }

  return logs
}

function buildIbkrParseLogs(
  parsedIbkrFile: ParsedIbkrFile,
  ibkrFileName: string,
  parsedHistoricalPriceFiles: ParsedHistoricalPriceFile[],
  parsedExchangeRateFile: ParsedExchangeRateFile,
  exchangeRateFileName: string,
  ibkrTransactions: NormalizedTransaction[],
  fifoReport: FifoReport,
): UiLogEntry[] {
  const acquisitionCount = ibkrTransactions.filter(
    (transaction) => transaction.transactionType === 'ACQUIRE',
  ).length
  const sellCount = ibkrTransactions.filter((transaction) => transaction.transactionType === 'SELL').length

  const logs: UiLogEntry[] = [
    createLog(
      'info',
      `Loaded "${ibkrFileName}" with ${parsedIbkrFile.rows.length} IBKR buy/sell row(s), ${parsedIbkrFile.dividendRows.length} dividend row(s), and ${parsedIbkrFile.cashLedgerRows.length} cash ledger row(s) across ${parsedIbkrFile.uniqueSymbols.length} traded symbol(s).`,
    ),
    createLog(
      'info',
      `Loaded ${parsedHistoricalPriceFiles.length} historical price file(s) for symbols: ${parsedIbkrFile.uniqueSymbols.join(', ')}.`,
    ),
    createLog(
      'info',
      `Loaded "${exchangeRateFileName}" with ${parsedExchangeRateFile.rows.length} TT BUY exchange-rate rows.`,
    ),
    createLog(
      'info',
      `Derived ${acquisitionCount} buy transactions and ${sellCount} sell transactions from the IBKR export.`,
    ),
    createLog(
      'info',
      `FIFO matching created ${fifoReport.matchedLots.length} mapped lot entries and ${fifoReport.openHoldings.length} open holding entries.`,
    ),
  ]

  if (parsedIbkrFile.ignoredRowCount > 0) {
    logs.push(
      createLog(
        'warning',
        `Ignored ${parsedIbkrFile.ignoredRowCount} IBKR row(s) that were not used for trades or dividends, such as withholding or cash movements.`,
      ),
    )

    parsedIbkrFile.ignoredRows.slice(0, 10).forEach((row) => {
      logs.push(
        createLog(
          'warning',
          `IBKR row ${row.sourceRowNumber}: ${row.reason}. Preview: ${row.preview}`,
        ),
      )
    })

    if (parsedIbkrFile.ignoredRows.length > 10) {
      logs.push(
        createLog(
          'info',
          `Only the first 10 ignored IBKR rows are shown in detail to keep the log readable.`,
        ),
      )
    }
  }

  return logs
}

function TabButton({
  isActive,
  label,
  onClick,
}: {
  isActive: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" className={`tab-button ${isActive ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
  )
}

function FifoMatchesTable({
  title,
  subtitle,
  matchedLots,
}: {
  title: string
  subtitle: string
  matchedLots: FifoMatchedLot[]
}) {
  const sortedMatchedLots = [...matchedLots].sort(sortByBuyDateThenSellDate)
  const totalSharesMatched = sumBy(sortedMatchedLots, (matchedLot) => matchedLot.sharesMatched)
  const totalBuyAmountUsd = sumBy(sortedMatchedLots, (matchedLot) => matchedLot.buyAmountUsd)
  const totalSellAmountUsd = sumBy(sortedMatchedLots, (matchedLot) => matchedLot.sellAmountUsd)
  const totalGainOrLossUsd = sumBy(sortedMatchedLots, (matchedLot) => matchedLot.gainOrLossUsd)
  const exportColumns: CsvColumn<FifoMatchedLot>[] = [
    { header: 'Buy Date', value: (row) => row.buyDate },
    { header: 'Sell Date', value: (row) => row.sellDate },
    { header: 'Grant', value: (row) => row.grantName },
    { header: 'Shares Matched', value: (row) => row.sharesMatched },
    { header: 'Buy Price USD', value: (row) => row.buyPricePerShareUsd },
    { header: 'Sell Price USD', value: (row) => row.sellPricePerShareUsd },
    { header: 'Buy Amount USD', value: (row) => row.buyAmountUsd },
    { header: 'Sell Amount USD', value: (row) => row.sellAmountUsd },
    { header: 'Gain / Loss USD', value: (row) => row.gainOrLossUsd },
  ]

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={sortedMatchedLots.length === 0}
            onClick={() => downloadCsvFile(title, exportColumns, sortedMatchedLots)}
          >
            Download CSV
          </button>
          <span className="badge">{matchedLots.length} rows</span>
        </div>
      </div>

      {sortedMatchedLots.length === 0 ? (
        <EmptyTableState
          title="No FIFO rows for this year"
          description="Long-share sales that fall inside the selected financial year will appear here after report generation."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Buy Date</th>
                <th>Sell Date</th>
                <th>Grant</th>
                <th>Shares Matched</th>
                <th>Buy Price</th>
                <th>Sell Price</th>
                <th>Buy Amount</th>
                <th>Sell Amount</th>
                <th>Gain / Loss</th>
              </tr>
            </thead>
            <tbody>
              {sortedMatchedLots.map((matchedLot) => (
                <tr key={matchedLot.id}>
                  <td>{formatUiDate(matchedLot.buyDate)}</td>
                  <td>{formatUiDate(matchedLot.sellDate)}</td>
                  <td>{matchedLot.grantName}</td>
                  <td>{matchedLot.sharesMatched}</td>
                  <td>{formatUsd(matchedLot.buyPricePerShareUsd)}</td>
                  <td>{formatUsd(matchedLot.sellPricePerShareUsd)}</td>
                  <td>{formatUsd(matchedLot.buyAmountUsd)}</td>
                  <td>{formatUsd(matchedLot.sellAmountUsd)}</td>
                  <td>{formatUsd(matchedLot.gainOrLossUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td>{totalSharesMatched}</td>
                <td></td>
                <td></td>
                <td>{formatUsd(totalBuyAmountUsd)}</td>
                <td>{formatUsd(totalSellAmountUsd)}</td>
                <td>{formatUsd(totalGainOrLossUsd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function SellToCoverTable({
  title,
  subtitle,
  sellToCoverRows,
}: {
  title: string
  subtitle: string
  sellToCoverRows: SellToCoverDisplayRow[]
}) {
  const sortedSellToCoverRows = [...sellToCoverRows].sort(sortByBuyDateThenSellDate)
  const totalShares = sumBy(sortedSellToCoverRows, (row) => row.sharesMatched)
  const totalBuyAmountUsd = sumBy(sortedSellToCoverRows, (row) => row.buyAmountUsd)
  const totalSellAmountUsd = sumBy(sortedSellToCoverRows, (row) => row.sellAmountUsd)
  const totalGainOrLossUsd = sumBy(sortedSellToCoverRows, (row) => row.gainOrLossUsd)
  const exportColumns: CsvColumn<SellToCoverDisplayRow>[] = [
    { header: 'Buy Date', value: (row) => row.buyDate },
    { header: 'Sell Date', value: (row) => row.sellDate },
    { header: 'Grant', value: (row) => row.grantName },
    { header: 'Shares Matched', value: (row) => row.sharesMatched },
    { header: 'Buy Price USD', value: (row) => row.buyPricePerShareUsd },
    { header: 'Sell Price USD', value: (row) => row.sellPricePerShareUsd },
    { header: 'Buy Amount USD', value: (row) => row.buyAmountUsd },
    { header: 'Sell Amount USD', value: (row) => row.sellAmountUsd },
    { header: 'Gain / Loss USD', value: (row) => row.gainOrLossUsd },
  ]

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={sortedSellToCoverRows.length === 0}
            onClick={() => downloadCsvFile(title, exportColumns, sortedSellToCoverRows)}
          >
            Download CSV
          </button>
          <span className="badge">{sortedSellToCoverRows.length} rows</span>
        </div>
      </div>

      {sortedSellToCoverRows.length === 0 ? (
        <EmptyTableState
          title="No sell-to-cover rows for this year"
          description="Sell-to-cover releases that fall inside the selected financial year will appear here."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Buy Date</th>
                <th>Sell Date</th>
                <th>Grant</th>
                <th>Shares Matched</th>
                <th>Buy Price</th>
                <th>Sell Price</th>
                <th>Buy Amount</th>
                <th>Sell Amount</th>
                <th>Gain / Loss</th>
              </tr>
            </thead>
            <tbody>
              {sortedSellToCoverRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatUiDate(row.buyDate)}</td>
                  <td>{formatUiDate(row.sellDate)}</td>
                  <td>{row.grantName}</td>
                  <td>{row.sharesMatched}</td>
                  <td>{formatUsd(row.buyPricePerShareUsd)}</td>
                  <td>{formatUsd(row.sellPricePerShareUsd)}</td>
                  <td>{formatUsd(row.buyAmountUsd)}</td>
                  <td>{formatUsd(row.sellAmountUsd)}</td>
                  <td>{formatUsd(row.gainOrLossUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td>{totalShares}</td>
                <td></td>
                <td></td>
                <td>{formatUsd(totalBuyAmountUsd)}</td>
                <td>{formatUsd(totalSellAmountUsd)}</td>
                <td>{formatUsd(totalGainOrLossUsd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function CapitalGainsTable({
  title,
  subtitle,
  rows,
}: {
  title: string
  subtitle: string
  rows: CapitalGainDisplayRow[]
}) {
  const sortedRows = [...rows].sort(sortByBuyDateThenSellDate)
  const totalShares = sumBy(sortedRows, (row) => row.sharesMatched)
  const totalBuyAmountUsd = sumBy(sortedRows, (row) => row.buyAmountUsd)
  const totalSellAmountUsd = sumBy(sortedRows, (row) => row.sellAmountUsd)
  const totalGainOrLossUsd = sumBy(sortedRows, (row) => row.gainOrLossUsd)
  const totalBuyAmountInr = sumBy(sortedRows, (row) => row.buyAmountInr ?? 0)
  const totalSellAmountInr = sumBy(sortedRows, (row) => row.sellAmountInr ?? 0)
  const totalGainOrLossInr = sumBy(sortedRows, (row) => row.gainOrLossInr ?? 0)
  const exportColumns: CsvColumn<CapitalGainDisplayRow>[] = [
    { header: 'Buy Date', value: (row) => row.buyDate },
    { header: 'Sell Date', value: (row) => row.sellDate },
    { header: 'Grant', value: (row) => row.grantName },
    { header: 'Shares Matched', value: (row) => row.sharesMatched },
    { header: 'Buy Price USD', value: (row) => row.buyPricePerShareUsd },
    { header: 'Buy Amount USD', value: (row) => row.buyAmountUsd },
    { header: 'Buy FX Rate', value: (row) => row.buyFxRate },
    { header: 'Buy FX Date', value: (row) => row.buyFxRateDate },
    { header: 'Buy Amount INR', value: (row) => row.buyAmountInr },
    { header: 'Sell Price USD', value: (row) => row.sellPricePerShareUsd },
    { header: 'Sell Amount USD', value: (row) => row.sellAmountUsd },
    { header: 'Sell FX Rate', value: (row) => row.sellFxRate },
    { header: 'Sell FX Date', value: (row) => row.sellFxRateDate },
    { header: 'Sell Amount INR', value: (row) => row.sellAmountInr },
    { header: 'Gain / Loss USD', value: (row) => row.gainOrLossUsd },
    { header: 'Gain / Loss INR', value: (row) => row.gainOrLossInr },
  ]

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={sortedRows.length === 0}
            onClick={() => downloadCsvFile(title, exportColumns, sortedRows)}
          >
            Download CSV
          </button>
          <span className="badge">{sortedRows.length} rows</span>
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <EmptyTableState
          title="No capital gains rows in this view"
          description="Transactions inside the selected financial year will appear here after the report is generated."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Buy Date</th>
                <th>Sell Date</th>
                <th>Grant</th>
                <th>Shares Matched</th>
                <th>Buy Price</th>
                <th>Buy Amount USD</th>
                <th>Buy FX Rate</th>
                <th>Buy FX Date</th>
                <th>Buy Amount INR</th>
                <th>Sell Price</th>
                <th>Sell Amount USD</th>
                <th>Sell FX Rate</th>
                <th>Sell FX Date</th>
                <th>Sell Amount INR</th>
                <th>Gain / Loss USD</th>
                <th>Gain / Loss INR</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatUiDate(row.buyDate)}</td>
                  <td>{formatUiDate(row.sellDate)}</td>
                  <td>{row.grantName}</td>
                  <td>{row.sharesMatched}</td>
                  <td>{formatUsd(row.buyPricePerShareUsd)}</td>
                  <td>{formatUsd(row.buyAmountUsd)}</td>
                  <td>{row.buyFxRate !== null ? row.buyFxRate.toFixed(2) : '-'}</td>
                  <td>{row.buyFxRateDate ? formatUiDate(row.buyFxRateDate) : '-'}</td>
                  <td>{row.buyAmountInr !== null ? formatInr(row.buyAmountInr) : '-'}</td>
                  <td>{formatUsd(row.sellPricePerShareUsd)}</td>
                  <td>{formatUsd(row.sellAmountUsd)}</td>
                  <td>{row.sellFxRate !== null ? row.sellFxRate.toFixed(2) : '-'}</td>
                  <td>{row.sellFxRateDate ? formatUiDate(row.sellFxRateDate) : '-'}</td>
                  <td>{row.sellAmountInr !== null ? formatInr(row.sellAmountInr) : '-'}</td>
                  <td>{formatUsd(row.gainOrLossUsd)}</td>
                  <td>{row.gainOrLossInr !== null ? formatInr(row.gainOrLossInr) : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td>{totalShares}</td>
                <td></td>
                <td>{formatUsd(totalBuyAmountUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalBuyAmountInr)}</td>
                <td></td>
                <td>{formatUsd(totalSellAmountUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalSellAmountInr)}</td>
                <td>{formatUsd(totalGainOrLossUsd)}</td>
                <td>{formatInr(totalGainOrLossInr)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function DividendIncomeTable({
  rows,
}: {
  rows: DividendIncomeRow[]
}) {
  const totalDividendAmountUsd = sumBy(rows, (row) => row.dividendAmountUsd)
  const totalDividendAmountInr = sumBy(rows, (row) => row.dividendAmountInr ?? 0)
  const exportColumns: CsvColumn<DividendIncomeRow>[] = [
    { header: 'Symbol', value: (row) => row.stockSymbol },
    { header: 'Dividend Date', value: (row) => row.dividendDate },
    { header: 'Description', value: (row) => row.description },
    { header: 'Dividend Amount USD', value: (row) => row.dividendAmountUsd },
    { header: 'Dividend FX Rate', value: (row) => row.fxRate },
    { header: 'Dividend FX Date', value: (row) => row.fxRateDate },
    { header: 'Dividend Amount INR', value: (row) => row.dividendAmountInr },
  ]

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>Dividend Income</h3>
          <p>Financial-year dividend receipts using previous-month SBI TT BUY rates for INR conversion.</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={rows.length === 0}
            onClick={() => downloadCsvFile('dividend-income', exportColumns, rows)}
          >
            Download CSV
          </button>
          <span className="badge">{rows.length} rows</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyTableState
          title="No dividend income rows in this year"
          description="IBKR dividend receipts inside the selected financial year will appear here after the report is generated."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Dividend Date</th>
                <th>Description</th>
                <th>Dividend Amount USD</th>
                <th>Dividend FX Rate</th>
                <th>Dividend FX Date</th>
                <th>Dividend Amount INR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.stockSymbol}</td>
                  <td>{formatUiDate(row.dividendDate)}</td>
                  <td>{row.description}</td>
                  <td>{formatUsd(row.dividendAmountUsd)}</td>
                  <td>{row.fxRate !== null ? row.fxRate.toFixed(2) : '-'}</td>
                  <td>{row.fxRateDate ? formatUiDate(row.fxRateDate) : '-'}</td>
                  <td>{row.dividendAmountInr !== null ? formatInr(row.dividendAmountInr) : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td>{formatUsd(totalDividendAmountUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalDividendAmountInr)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function OpenHoldingsTable({
  title,
  subtitle,
  openHoldings,
}: {
  title: string
  subtitle: string
  openHoldings: OpenHolding[]
}) {
  const sortedOpenHoldings = [...openHoldings].sort(sortByBuyDateThenSellDate)
  const totalSharesRemaining = sumBy(sortedOpenHoldings, (holding) => holding.sharesRemaining)
  const totalCostBasisUsd = sumBy(sortedOpenHoldings, (holding) => holding.costBasisUsd)
  const exportColumns: CsvColumn<OpenHolding>[] = [
    { header: 'Buy Date', value: (row) => row.buyDate },
    { header: 'Grant', value: (row) => row.grantName },
    { header: 'Shares Remaining', value: (row) => row.sharesRemaining },
    { header: 'Buy Price USD', value: (row) => row.buyPricePerShareUsd },
    { header: 'Cost Basis USD', value: (row) => row.costBasisUsd },
  ]

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={sortedOpenHoldings.length === 0}
            onClick={() => downloadCsvFile(title, exportColumns, sortedOpenHoldings)}
          >
            Download CSV
          </button>
          <span className="badge">{openHoldings.length} rows</span>
        </div>
      </div>

      {sortedOpenHoldings.length === 0 ? (
        <EmptyTableState
          title="No open holdings"
          description="Any shares still held at the selected calendar-year end will appear here."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Buy Date</th>
                <th>Grant</th>
                <th>Shares Remaining</th>
                <th>Buy Price</th>
                <th>Cost Basis</th>
              </tr>
            </thead>
            <tbody>
              {sortedOpenHoldings.map((holding) => (
                <tr key={holding.id}>
                  <td>{formatUiDate(holding.buyDate)}</td>
                  <td>{holding.grantName}</td>
                  <td>{holding.sharesRemaining}</td>
                  <td>{formatUsd(holding.buyPricePerShareUsd)}</td>
                  <td>{formatUsd(holding.costBasisUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Totals</td>
                <td>{totalSharesRemaining}</td>
                <td></td>
                <td>{formatUsd(totalCostBasisUsd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function ScheduleFaA2Table({
  rows,
}: {
  rows: ScheduleFaA2Row[]
}) {
  const exportColumns: CsvColumn<ScheduleFaA2Row>[] = [
    { header: 'Account Type', value: (row) => row.accountType },
    { header: 'Calendar Start', value: (row) => row.calendarStart },
    { header: 'Calendar End', value: (row) => row.calendarEnd },
    { header: 'Max Value Date', value: (row) => row.maxValueDate },
    { header: 'Max FX Rate', value: (row) => row.maxFxRate },
    { header: 'Max Securities Value USD', value: (row) => row.maxSecuritiesValueUsd },
    { header: 'Max Cash Balance USD', value: (row) => row.maxCashBalanceUsd },
    { header: 'Max Account Value USD', value: (row) => row.maxAccountValueUsd },
    { header: 'Max Account Value INR', value: (row) => row.maxAccountValueInr },
    { header: 'Closing Value Date', value: (row) => row.closingValueDate },
    { header: 'Closing FX Rate', value: (row) => row.closingFxRate },
    { header: 'Closing FX Date', value: (row) => row.closingFxRateDate },
    { header: 'Closing Securities Value USD', value: (row) => row.closingSecuritiesValueUsd },
    { header: 'Closing Cash Balance USD', value: (row) => row.closingCashBalanceUsd },
    { header: 'Closing Account Value USD', value: (row) => row.closingAccountValueUsd },
    { header: 'Closing Account Value INR', value: (row) => row.closingAccountValueInr },
  ]

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>Schedule FA A2</h3>
          <p>Calendar-year maximum and closing account values in INR.</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={rows.length === 0}
            onClick={() => downloadCsvFile('schedule-fa-a2', exportColumns, rows)}
          >
            Download CSV
          </button>
          <span className="badge">{rows.length} rows</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyTableState
          title="No Schedule FA A2 values"
          description="Upload historical prices and SBI reference rates to calculate A2 maximum and closing account values."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account Type</th>
                <th>Max Value Date</th>
                <th>Max FX Rate</th>
                <th>Max Securities USD</th>
                <th>Max Cash USD</th>
                <th>Max Account USD</th>
                <th>Max Account INR</th>
                <th>Closing Date</th>
                <th>Closing FX Rate</th>
                <th>Closing FX Date</th>
                <th>Closing Securities USD</th>
                <th>Closing Cash USD</th>
                <th>Closing Account USD</th>
                <th>Closing Account INR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.accountType}-${row.calendarStart}-${row.calendarEnd}`}>
                  <td>{row.accountType}</td>
                  <td>{row.maxValueDate ? formatUiDate(row.maxValueDate) : '-'}</td>
                  <td>{row.maxFxRate !== null ? row.maxFxRate.toFixed(2) : '-'}</td>
                  <td>
                    {row.maxSecuritiesValueUsd !== null ? formatUsd(row.maxSecuritiesValueUsd) : '-'}
                  </td>
                  <td>{row.maxCashBalanceUsd !== null ? formatUsd(row.maxCashBalanceUsd) : '-'}</td>
                  <td>{row.maxAccountValueUsd !== null ? formatUsd(row.maxAccountValueUsd) : '-'}</td>
                  <td>{row.maxAccountValueInr !== null ? formatInr(row.maxAccountValueInr) : '-'}</td>
                  <td>{formatUiDate(row.closingValueDate)}</td>
                  <td>{row.closingFxRate !== null ? row.closingFxRate.toFixed(2) : '-'}</td>
                  <td>{row.closingFxRateDate ? formatUiDate(row.closingFxRateDate) : '-'}</td>
                  <td>
                    {row.closingSecuritiesValueUsd !== null
                      ? formatUsd(row.closingSecuritiesValueUsd)
                      : '-'}
                  </td>
                  <td>
                    {row.closingCashBalanceUsd !== null ? formatUsd(row.closingCashBalanceUsd) : '-'}
                  </td>
                  <td>
                    {row.closingAccountValueUsd !== null ? formatUsd(row.closingAccountValueUsd) : '-'}
                  </td>
                  <td>
                    {row.closingAccountValueInr !== null ? formatInr(row.closingAccountValueInr) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ScheduleFaTable({
  rows,
}: {
  rows: ScheduleFaRow[]
}) {
  const sortedRows = [...rows].sort(sortByBuyDateThenSellDate)
  const totalShares = sumBy(sortedRows, (row) => row.shares)
  const totalBuyAmountUsd = sumBy(sortedRows, (row) => row.buyAmountUsd)
  const totalBuyAmountInr = sumBy(sortedRows, (row) => row.buyAmountInr ?? 0)
  const totalSellAmountUsd = sumBy(sortedRows, (row) => row.sellAmountUsd ?? 0)
  const totalSellAmountInr = sumBy(sortedRows, (row) => row.sellAmountInr ?? 0)
  const totalDividendReceivedUsd = sumBy(sortedRows, (row) => row.dividendReceivedUsd)
  const totalDividendReceivedInr = sumBy(sortedRows, (row) => row.dividendReceivedInr)
  const totalMaxAmountUsd = sumBy(sortedRows, (row) => row.maxAmountUsd ?? 0)
  const totalMaxAmountInr = sumBy(sortedRows, (row) => row.maxAmountInr ?? 0)
  const totalClosingAmountUsd = sumBy(sortedRows, (row) => row.closingAmountUsd ?? 0)
  const totalClosingAmountInr = sumBy(sortedRows, (row) => row.closingAmountInr ?? 0)
  const exportColumns: CsvColumn<ScheduleFaRow>[] = [
    { header: 'Holding Type', value: (row) => row.holdingType },
    { header: 'Buy Date', value: (row) => row.buyDate },
    { header: 'Sell Date', value: (row) => row.sellDate },
    { header: 'Grant', value: (row) => row.grantName },
    { header: 'Shares', value: (row) => row.shares },
    { header: 'Buy Price USD', value: (row) => row.buyPricePerShareUsd },
    { header: 'Buy Amount USD', value: (row) => row.buyAmountUsd },
    { header: 'Buy FX Rate', value: (row) => row.buyFxRate },
    { header: 'Buy FX Date', value: (row) => row.buyFxRateDate },
    { header: 'Buy Amount INR', value: (row) => row.buyAmountInr },
    { header: 'Sell Price USD', value: (row) => row.sellPricePerShareUsd },
    { header: 'Sell Amount USD', value: (row) => row.sellAmountUsd },
    { header: 'Sell FX Rate', value: (row) => row.sellFxRate },
    { header: 'Sell FX Date', value: (row) => row.sellFxRateDate },
    { header: 'Sell Amount INR', value: (row) => row.sellAmountInr },
    { header: 'Dividend Received USD', value: (row) => row.dividendReceivedUsd },
    { header: 'Dividend FX Rate', value: (row) => row.dividendFxRate },
    { header: 'Dividend FX Date', value: (row) => row.dividendFxDate },
    { header: 'Dividend Amount INR', value: (row) => row.dividendReceivedInr },
    { header: 'Max Price / Share USD', value: (row) => row.maxPricePerShareUsd },
    { header: 'Max Price Date', value: (row) => row.maxPriceDate },
    { header: 'Max Amount USD', value: (row) => row.maxAmountUsd },
    { header: 'Max FX Rate', value: (row) => row.maxFxRate },
    { header: 'Max FX Date', value: (row) => row.maxFxRateDate },
    { header: 'Max Amount INR', value: (row) => row.maxAmountInr },
    { header: 'Closing Price USD', value: (row) => row.closingPricePerShareUsd },
    { header: 'Closing Amount USD', value: (row) => row.closingAmountUsd },
    { header: 'Closing FX Rate', value: (row) => row.closingFxRate },
    { header: 'Closing FX Date', value: (row) => row.closingFxRateDate },
    { header: 'Closing Amount INR', value: (row) => row.closingAmountInr },
  ]

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>Schedule FA A3</h3>
          <p>Calendar-year transaction disclosure rows for the selected assessment year.</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={sortedRows.length === 0}
            onClick={() => downloadCsvFile('schedule-fa-a3', exportColumns, sortedRows)}
          >
            Download CSV
          </button>
          <span className="badge">{rows.length} rows</span>
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <EmptyTableState
          title="No Schedule FA rows in this year"
          description="Any holding that overlaps the selected calendar year will appear here after the report is generated."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Holding Type</th>
                <th>Buy Date</th>
                <th>Sell Date</th>
                <th>Grant</th>
                <th>Shares</th>
                <th>Buy Price</th>
                <th>Buy Amount USD</th>
                <th>Buy FX Rate</th>
                <th>Buy FX Date</th>
                <th>Buy Amount INR</th>
                <th>Sell Price</th>
                <th>Sell Amount USD</th>
                <th>Sell FX Rate</th>
                <th>Sell FX Date</th>
                <th>Sell Amount INR</th>
                <th>Dividend Received USD</th>
                <th>Dividend FX Rate</th>
                <th>Dividend FX Date</th>
                <th>Dividend Amount INR</th>
                <th>Max Price / Share</th>
                <th>Max Price Date</th>
                <th>Max Amount USD</th>
                <th>Max FX Rate</th>
                <th>Max FX Date</th>
                <th>Max Amount INR</th>
                <th>Closing Price</th>
                <th>Closing Amount USD</th>
                <th>Closing FX Rate</th>
                <th>Closing FX Date</th>
                <th>Closing Amount INR</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.holdingType}</td>
                  <td>{formatUiDate(row.buyDate)}</td>
                  <td>{row.sellDate ? formatUiDate(row.sellDate) : '-'}</td>
                  <td>{row.grantName}</td>
                  <td>{row.shares}</td>
                  <td>{formatUsd(row.buyPricePerShareUsd)}</td>
                  <td>{formatUsd(row.buyAmountUsd)}</td>
                  <td>{row.buyFxRate !== null ? row.buyFxRate.toFixed(2) : '-'}</td>
                  <td>{row.buyFxRateDate ? formatUiDate(row.buyFxRateDate) : '-'}</td>
                  <td>{row.buyAmountInr !== null ? formatInr(row.buyAmountInr) : '-'}</td>
                  <td>{row.sellPricePerShareUsd !== null ? formatUsd(row.sellPricePerShareUsd) : '-'}</td>
                  <td>{row.sellAmountUsd !== null ? formatUsd(row.sellAmountUsd) : '-'}</td>
                  <td>{row.sellFxRate !== null ? row.sellFxRate.toFixed(2) : '-'}</td>
                  <td>{row.sellFxRateDate ? formatUiDate(row.sellFxRateDate) : '-'}</td>
                  <td>{row.sellAmountInr !== null ? formatInr(row.sellAmountInr) : '-'}</td>
                  <td>{formatUsd(row.dividendReceivedUsd)}</td>
                  <td>{row.dividendFxRate ?? '-'}</td>
                  <td>{row.dividendFxDate ? row.dividendFxDate.split('; ').map((date) => formatUiDate(date)).join('; ') : '-'}</td>
                  <td>{formatInr(row.dividendReceivedInr)}</td>
                  <td>{row.maxPricePerShareUsd !== null ? formatUsd(row.maxPricePerShareUsd) : '-'}</td>
                  <td>{row.maxPriceDate ? formatUiDate(row.maxPriceDate) : '-'}</td>
                  <td>{row.maxAmountUsd !== null ? formatUsd(row.maxAmountUsd) : '-'}</td>
                  <td>{row.maxFxRate !== null ? row.maxFxRate.toFixed(2) : '-'}</td>
                  <td>{row.maxFxRateDate ? formatUiDate(row.maxFxRateDate) : '-'}</td>
                  <td>{row.maxAmountInr !== null ? formatInr(row.maxAmountInr) : '-'}</td>
                  <td>
                    {row.closingPricePerShareUsd !== null ? formatUsd(row.closingPricePerShareUsd) : '-'}
                  </td>
                  <td>{row.closingAmountUsd !== null ? formatUsd(row.closingAmountUsd) : '-'}</td>
                  <td>{row.closingFxRate !== null ? row.closingFxRate.toFixed(2) : '-'}</td>
                  <td>{row.closingFxRateDate ? formatUiDate(row.closingFxRateDate) : '-'}</td>
                  <td>{row.closingAmountInr !== null ? formatInr(row.closingAmountInr) : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Totals</td>
                <td>{totalShares}</td>
                <td></td>
                <td>{formatUsd(totalBuyAmountUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalBuyAmountInr)}</td>
                <td></td>
                <td>{formatUsd(totalSellAmountUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalSellAmountInr)}</td>
                <td>{formatUsd(totalDividendReceivedUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalDividendReceivedInr)}</td>
                <td></td>
                <td></td>
                <td>{formatUsd(totalMaxAmountUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalMaxAmountInr)}</td>
                <td></td>
                <td>{formatUsd(totalClosingAmountUsd)}</td>
                <td></td>
                <td></td>
                <td>{formatInr(totalClosingAmountInr)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function App() {
  const [, setHashRefreshKey] = useState(0)
  const [selectedBroker, setSelectedBroker] = useState<BrokerType | ''>('')
  const [generatedBroker, setGeneratedBroker] = useState<BrokerType | null>(null)
  const [selectedIbkrFile, setSelectedIbkrFile] = useState<File | null>(null)
  const [selectedSalesFile, setSelectedSalesFile] = useState<File | null>(null)
  const [selectedReleasesFile, setSelectedReleasesFile] = useState<File | null>(null)
  const [selectedHistoricalPriceFile, setSelectedHistoricalPriceFile] = useState<File | null>(null)
  const [selectedHistoricalPriceFilesBySymbol, setSelectedHistoricalPriceFilesBySymbol] = useState<
    Record<string, File | null>
  >({})
  const [selectedHistoricalPriceBulkFiles, setSelectedHistoricalPriceBulkFiles] = useState<File[]>([])
  const [selectedExchangeRateFile, setSelectedExchangeRateFile] = useState<File | null>(null)
  const [parsedIbkrFile, setParsedIbkrFile] = useState<ParsedIbkrFile | null>(null)
  const [parsedSalesFile, setParsedSalesFile] = useState<ParsedShareworksFile | null>(null)
  const [parsedReleasesFile, setParsedReleasesFile] =
    useState<ParsedShareworksReleasesFile | null>(null)
  const [parsedHistoricalPriceFile, setParsedHistoricalPriceFile] =
    useState<ParsedHistoricalPriceFile | null>(null)
  const [parsedExchangeRateFile, setParsedExchangeRateFile] =
    useState<ParsedExchangeRateFile | null>(null)
  const [logs, setLogs] = useState<UiLogEntry[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState<ReportTabId>('overview')
  const [selectedAssessmentYear, setSelectedAssessmentYear] = useState(buildAssessmentYearLabel(2026))

  const suggestedAssessmentYearStart = useMemo(
    () => inferAssessmentYearStart(parsedSalesFile, parsedReleasesFile, parsedIbkrFile),
    [parsedIbkrFile, parsedSalesFile, parsedReleasesFile],
  )
  const assessmentYearOptions = useMemo(
    () => buildAssessmentYearOptions(suggestedAssessmentYearStart),
    [suggestedAssessmentYearStart],
  )
  const assessmentYearContext = useMemo(
    () => getAssessmentYearContext(selectedAssessmentYear),
    [selectedAssessmentYear],
  )

  const releaseTransactions = useMemo(
    () => (parsedReleasesFile ? deriveReleaseTransactions(parsedReleasesFile.rows) : []),
    [parsedReleasesFile],
  )
  const ibkrTransactions = useMemo(
    () => (parsedIbkrFile ? deriveIbkrTransactions(parsedIbkrFile.rows) : []),
    [parsedIbkrFile],
  )
  const longShareSales = useMemo(
    () => (parsedSalesFile ? deriveLongShareSaleTransactions(parsedSalesFile.rows) : []),
    [parsedSalesFile],
  )
  const allTransactions = useMemo(
    () =>
      selectedBroker === 'ibkr' ? ibkrTransactions : [...releaseTransactions, ...longShareSales],
    [ibkrTransactions, longShareSales, releaseTransactions, selectedBroker],
  )
  const heldTransactions = useMemo(
    () => allTransactions.filter((transaction) => transaction.transactionType === 'ACQUIRE'),
    [allTransactions],
  )
  const sellTransactions = useMemo(
    () => allTransactions.filter((transaction) => transaction.transactionType === 'SELL'),
    [allTransactions],
  )
  const sellToCoverTransactions = useMemo(
    () => releaseTransactions.filter((transaction) => transaction.transactionType === 'SELL_TO_COVER'),
    [releaseTransactions],
  )
  const sellToCoverRows = useMemo(
    () => (selectedBroker === 'shareworks' ? buildSellToCoverRows(parsedReleasesFile) : []),
    [parsedReleasesFile, selectedBroker],
  )

  const capitalGainsBaseReport = useMemo(
    () =>
      buildFifoReport([
        ...heldTransactions.filter((transaction) => transaction.tradeDate <= assessmentYearContext.financialEnd),
        ...allTransactions.filter(
          (transaction) =>
            transaction.transactionType === 'SELL' &&
            transaction.tradeDate <= assessmentYearContext.financialEnd,
        ),
      ]),
    [allTransactions, assessmentYearContext.financialEnd, heldTransactions],
  )
  const capitalGainsMatches = useMemo(
    () =>
      capitalGainsBaseReport.matchedLots.filter((match) =>
        isWithinRange(match.sellDate, assessmentYearContext.financialStart, assessmentYearContext.financialEnd),
      ),
    [assessmentYearContext.financialEnd, assessmentYearContext.financialStart, capitalGainsBaseReport.matchedLots],
  )
  const capitalGainsSellToCoverRows = useMemo(
    () =>
      sellToCoverRows.filter((row) =>
        isWithinRange(row.sellDate, assessmentYearContext.financialStart, assessmentYearContext.financialEnd),
      ),
    [assessmentYearContext.financialEnd, assessmentYearContext.financialStart, sellToCoverRows],
  )
  const capitalGainsMatchedDisplayRows = useMemo(
    () => buildCapitalGainsMatchedRows(capitalGainsMatches, parsedExchangeRateFile?.rows ?? []),
    [capitalGainsMatches, parsedExchangeRateFile],
  )
  const capitalGainsSellToCoverDisplayRows = useMemo(
    () => buildCapitalGainsSellToCoverRows(capitalGainsSellToCoverRows, parsedExchangeRateFile?.rows ?? []),
    [capitalGainsSellToCoverRows, parsedExchangeRateFile],
  )
  const dividendIncomeRows = useMemo(
    () =>
      buildDividendIncomeRows(
        selectedBroker === 'ibkr' ? (parsedIbkrFile?.dividendRows ?? []) : [],
        parsedExchangeRateFile?.rows ?? [],
        assessmentYearContext,
      ),
    [assessmentYearContext, parsedExchangeRateFile, parsedIbkrFile, selectedBroker],
  )
  const scheduleFaA2Rows = useMemo(
    () =>
      buildScheduleFaA2Rows({
        transactions: allTransactions,
        cashLedgerRows: selectedBroker === 'ibkr' ? (parsedIbkrFile?.cashLedgerRows ?? []) : [],
        historicalPrices: parsedHistoricalPriceFile?.rows ?? [],
        exchangeRates: parsedExchangeRateFile?.rows ?? [],
        includeCash: selectedBroker === 'ibkr',
        context: assessmentYearContext,
      }),
    [
      allTransactions,
      assessmentYearContext,
      parsedExchangeRateFile,
      parsedHistoricalPriceFile,
      parsedIbkrFile,
      selectedBroker,
    ],
  )

  const lifetimeFifoReport = useMemo(
    () => buildFifoReport(allTransactions),
    [allTransactions],
  )

  const overviewHoldingsReport = useMemo(
    () =>
      buildFifoReport([
        ...heldTransactions.filter((transaction) => transaction.tradeDate <= assessmentYearContext.calendarEnd),
        ...allTransactions.filter(
          (transaction) =>
            transaction.transactionType === 'SELL' &&
            transaction.tradeDate <= assessmentYearContext.calendarEnd,
        ),
      ]),
    [allTransactions, assessmentYearContext.calendarEnd, heldTransactions],
  )
  const overviewSellToCoverRows = useMemo(
    () =>
      sellToCoverRows.filter((row) =>
        isWithinRange(row.sellDate, assessmentYearContext.financialStart, assessmentYearContext.financialEnd),
      ),
    [assessmentYearContext.financialEnd, assessmentYearContext.financialStart, sellToCoverRows],
  )
  const scheduleFaRows = useMemo(
    () =>
      buildScheduleFaRows(
        lifetimeFifoReport.matchedLots,
        sellToCoverRows,
        overviewHoldingsReport.openHoldings,
        parsedHistoricalPriceFile?.rows ?? [],
        parsedExchangeRateFile?.rows ?? [],
        parsedIbkrFile?.dividendRows ?? [],
        assessmentYearContext,
      ),
    [
      assessmentYearContext,
      parsedExchangeRateFile,
      parsedIbkrFile,
      lifetimeFifoReport.matchedLots,
      overviewHoldingsReport.openHoldings,
      parsedHistoricalPriceFile,
      sellToCoverRows,
    ],
  )
  const scheduleFaFxLogs = useMemo(() => {
    if (scheduleFaRows.length === 0) {
      return []
    }

    const fallbackCounts = {
      buy: 0,
      sell: 0,
      max: 0,
      closing: 0,
    }
    const missingCounts = {
      buy: 0,
      sell: 0,
      max: 0,
      closing: 0,
    }

    scheduleFaRows.forEach((row) => {
      if (row.buyAmountUsd > 0) {
        if (row.buyFxRate === null || row.buyFxRateDate === null) {
          missingCounts.buy += 1
        } else if (row.buyFxRateDate !== row.buyDate) {
          fallbackCounts.buy += 1
        }
      }

      if (row.sellAmountUsd !== null && row.sellAmountUsd > 0 && row.sellDate) {
        if (row.sellFxRate === null || row.sellFxRateDate === null) {
          missingCounts.sell += 1
        } else if (row.sellFxRateDate !== row.sellDate) {
          fallbackCounts.sell += 1
        }
      }

      if (row.maxAmountUsd !== null && row.maxAmountUsd > 0 && row.maxAmountInrDate) {
        if (row.maxFxRate === null || row.maxFxRateDate === null) {
          missingCounts.max += 1
        } else if (row.maxFxRateDate !== row.maxAmountInrDate) {
          fallbackCounts.max += 1
        }
      }

      if (row.closingAmountUsd !== null && row.closingAmountUsd > 0) {
        if (row.closingFxRate === null || row.closingFxRateDate === null) {
          missingCounts.closing += 1
        } else if (row.closingFxRateDate !== assessmentYearContext.calendarEnd) {
          fallbackCounts.closing += 1
        }
      }
    })

    const derivedLogs: UiLogEntry[] = []

    derivedLogs.push(
      {
        id: 'fx-summary-info',
        level: 'info',
        message: `Schedule FA INR conversions are using SBI TT BUY rates with previous-date fallback when the same date is unavailable or zero.`,
      },
      {
        id: 'fx-fallback-info',
        level: 'info',
        message: `FX fallback counts for the current Schedule FA view: buy ${fallbackCounts.buy}, sell ${fallbackCounts.sell}, max ${fallbackCounts.max}, closing ${fallbackCounts.closing}.`,
      },
    )

    if (missingCounts.buy + missingCounts.sell + missingCounts.max + missingCounts.closing > 0) {
      derivedLogs.push({
        id: 'fx-missing-warning',
        level: 'warning',
        message: `Some INR conversions could not be calculated because no earlier TT BUY rate was found. Missing counts: buy ${missingCounts.buy}, sell ${missingCounts.sell}, max ${missingCounts.max}, closing ${missingCounts.closing}.`,
      })
    }

    return derivedLogs
  }, [assessmentYearContext.calendarEnd, scheduleFaRows])
  const capitalGainsFxLogs = useMemo(() => {
    const allRows = [...capitalGainsMatchedDisplayRows, ...capitalGainsSellToCoverDisplayRows]

    if (allRows.length === 0) {
      return []
    }

    const fallbackCounts = {
      buy: 0,
      sell: 0,
    }
    const missingCounts = {
      buy: 0,
      sell: 0,
    }

    allRows.forEach((row) => {
      if (row.buyFxRate === null || row.buyFxRateDate === null) {
        missingCounts.buy += 1
      } else if (row.buyFxTargetDate !== null && row.buyFxRateDate !== row.buyFxTargetDate) {
        fallbackCounts.buy += 1
      }

      if (row.sellFxRate === null || row.sellFxRateDate === null) {
        missingCounts.sell += 1
      } else if (row.sellFxTargetDate !== null && row.sellFxRateDate !== row.sellFxTargetDate) {
        fallbackCounts.sell += 1
      }
    })

    return [
      {
        id: 'cg-fx-summary-info',
        level: 'info',
        message:
          'Capital gains INR conversions use the SBI TT BUY rate from the last available date of the previous month, with backward fallback when month-end is missing or zero.',
      },
      {
        id: 'cg-fx-fallback-info',
        level: 'info',
        message: `Capital gains FX fallback counts for the current view: buy ${fallbackCounts.buy}, sell ${fallbackCounts.sell}.`,
      },
      ...(missingCounts.buy + missingCounts.sell > 0
        ? [
            {
              id: 'cg-fx-missing-warning',
              level: 'warning' as const,
              message: `Some capital gains INR conversions could not be calculated because no previous-month TT BUY rate was found. Missing counts: buy ${missingCounts.buy}, sell ${missingCounts.sell}.`,
            },
          ]
        : []),
    ]
  }, [capitalGainsMatchedDisplayRows, capitalGainsSellToCoverDisplayRows])
  const displayLogs = useMemo(
    () => [...logs, ...scheduleFaFxLogs, ...capitalGainsFxLogs],
    [capitalGainsFxLogs, logs, scheduleFaFxLogs],
  )
  const isShareworksSelected = selectedBroker === 'shareworks'
  const isIbkrSelected = selectedBroker === 'ibkr'
  const ibkrSymbols = parsedIbkrFile?.uniqueSymbols ?? []
  const ibkrHistoricalFiles = ibkrSymbols.map((symbol) => selectedHistoricalPriceFilesBySymbol[symbol] ?? null)
  const hasAllRequiredFiles = isShareworksSelected
    ? Boolean(
        selectedSalesFile &&
          selectedReleasesFile &&
          selectedHistoricalPriceFile &&
          selectedExchangeRateFile,
      )
    : isIbkrSelected
      ? Boolean(
          selectedIbkrFile &&
            selectedExchangeRateFile &&
            ibkrSymbols.length > 0 &&
            ibkrHistoricalFiles.every(Boolean),
        )
      : false
  const hasGeneratedReport = generatedBroker === selectedBroker && Boolean(parsedHistoricalPriceFile && parsedExchangeRateFile) &&
    (isShareworksSelected ? Boolean(parsedSalesFile && parsedReleasesFile) : isIbkrSelected ? Boolean(parsedIbkrFile) : false)
  const sampleTables = useMemo<SampleTableDefinition[]>(
    () => [
      {
        id: 'releases',
        title: 'RSU Releases sample',
        description: 'Example Shareworks release rows showing vest date, sold-to-cover, and held-share values.',
        csvText: releasesSampleCsv,
      },
      {
        id: 'sales',
        title: 'Long Shares Sales sample',
        description: 'Example Shareworks sale rows used for later FIFO matching against vested holdings.',
        csvText: salesSampleCsv,
      },
      {
        id: 'historical-prices',
        title: 'Historical TEAM Price sample',
        description: 'Example historical TEAM price rows used for max-price and closing-price lookups.',
        csvText: historicalPriceSampleCsv,
      },
      {
        id: 'exchange-rates',
        title: 'USD to INR rate sample',
        description: 'Example SBI reference-rate rows where the app uses the `TT BUY` column.',
        csvText: exchangeRateSampleCsv,
      },
      {
        id: 'ibkr-transactions',
        title: 'IBKR Transactions sample',
        description: 'Example IBKR consolidated transaction rows showing Buy, Sell, and Dividend entries used by the app.',
        csvText: ibkrTransactionSampleCsv,
      },
    ],
    [],
  )
  const uploadProgressCount = [
    selectedExchangeRateFile,
    ...(isShareworksSelected
      ? [selectedReleasesFile, selectedSalesFile, selectedHistoricalPriceFile]
      : isIbkrSelected
        ? [selectedIbkrFile, ...ibkrHistoricalFiles]
        : []),
  ].filter(Boolean).length
  const uploadProgressTotal = isShareworksSelected ? 4 : isIbkrSelected ? 2 + ibkrSymbols.length : 1
  const logCounts = useMemo(
    () => ({
      info: displayLogs.filter((log) => log.level === 'info').length,
      warning: displayLogs.filter((log) => log.level === 'warning').length,
      error: displayLogs.filter((log) => log.level === 'error').length,
    }),
    [displayLogs],
  )
  const currentPage = typeof window === 'undefined' ? 'landing' : getPageFromHash(window.location.hash)

  useEffect(() => {
    function handleHashChange() {
      setHashRefreshKey((value) => value + 1)
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange()

    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  function navigateToPage(page: AppPageId) {
    window.location.hash = page === 'builder' ? 'app' : page === 'samples' ? 'samples' : ''
  }

  async function handleIbkrFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setGeneratedBroker(null)
    setParsedIbkrFile(null)
    setParsedHistoricalPriceFile(null)
    setSelectedIbkrFile(file ?? null)
    setSelectedHistoricalPriceFilesBySymbol({})
    setSelectedHistoricalPriceBulkFiles([])

    if (!file) {
      setLogs((existingLogs) =>
        existingLogs.filter((entry) => !entry.message.startsWith('Selected IBKR transaction file')),
      )
      return
    }

    try {
      const csvText = await file.text()
      const parsed = parseIbkrTransactionsCsv(csvText)
      setParsedIbkrFile(parsed)
      setSelectedHistoricalPriceFilesBySymbol(
        Object.fromEntries(parsed.uniqueSymbols.map((symbol) => [symbol, null])),
      )
      setLogs((existingLogs) => [
        ...existingLogs.filter((entry) => !entry.message.startsWith('Selected IBKR transaction file')),
        createLog(
          'info',
          `Selected IBKR transaction file "${file.name}" with ${parsed.uniqueSymbols.length} symbol(s): ${parsed.uniqueSymbols.join(', ')}.`,
        ),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse the selected IBKR file.'
      setLogs([createLog('error', message)])
      setSelectedIbkrFile(null)
      setParsedIbkrFile(null)
      setSelectedHistoricalPriceFilesBySymbol({})
    }
  }

  function handleSalesFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setGeneratedBroker(null)
    setParsedSalesFile(null)
    setSelectedSalesFile(file ?? null)

    if (!file) {
      setLogs((existingLogs) =>
        existingLogs.filter((entry) => !entry.message.startsWith('Selected sales file')),
      )
      return
    }

    setLogs((existingLogs) => [
      ...existingLogs.filter((entry) => !entry.message.startsWith('Selected sales file')),
      createLog('info', `Selected sales file "${file.name}".`),
    ])
  }

  function handleReleasesFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setGeneratedBroker(null)
    setParsedReleasesFile(null)
    setSelectedReleasesFile(file ?? null)

    if (!file) {
      setLogs((existingLogs) =>
        existingLogs.filter((entry) => !entry.message.startsWith('Selected releases file')),
      )
      return
    }

    setLogs((existingLogs) => [
      ...existingLogs.filter((entry) => !entry.message.startsWith('Selected releases file')),
      createLog('info', `Selected releases file "${file.name}".`),
    ])
  }

  function handleHistoricalPriceFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setGeneratedBroker(null)
    setParsedHistoricalPriceFile(null)
    setSelectedHistoricalPriceFile(file ?? null)

    if (!file) {
      setLogs((existingLogs) =>
        existingLogs.filter((entry) => !entry.message.startsWith('Selected historical price file')),
      )
      return
    }

    setLogs((existingLogs) => [
      ...existingLogs.filter((entry) => !entry.message.startsWith('Selected historical price file')),
      createLog('info', `Selected historical price file "${file.name}".`),
    ])
  }

  function handleHistoricalPriceFileSelectForSymbol(symbol: string) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null
      setGeneratedBroker(null)
      setParsedHistoricalPriceFile(null)
      setSelectedHistoricalPriceFilesBySymbol((existingFiles) => ({
        ...existingFiles,
        [symbol]: file,
      }))

      setLogs((existingLogs) => [
        ...existingLogs.filter((entry) => !entry.message.startsWith(`Selected historical price file for ${symbol}`)),
        ...(file
          ? [createLog('info', `Selected historical price file for ${symbol}: "${file.name}".`)]
          : []),
      ])
    }
  }

  function handleHistoricalPriceBulkFilesSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    const symbolSet = new Set(ibkrSymbols)
    const nextFilesBySymbol = { ...selectedHistoricalPriceFilesBySymbol }
    const ignoredFileNames: string[] = []
    const duplicateSymbols = new Set<string>()
    const matchedSymbols = new Set<string>()

    setGeneratedBroker(null)
    setParsedHistoricalPriceFile(null)
    setSelectedHistoricalPriceBulkFiles(files)

    files.forEach((file) => {
      const symbol = getHistoricalPriceFileSymbol(file.name)

      if (!symbol || !symbolSet.has(symbol)) {
        ignoredFileNames.push(file.name)
        return
      }

      if (matchedSymbols.has(symbol) || nextFilesBySymbol[symbol]) {
        duplicateSymbols.add(symbol)
      }

      nextFilesBySymbol[symbol] = file
      matchedSymbols.add(symbol)
    })

    setSelectedHistoricalPriceFilesBySymbol(nextFilesBySymbol)
    setLogs((existingLogs) => [
      ...existingLogs.filter(
        (entry) =>
          !entry.message.startsWith('Selected bulk historical price files') &&
          !entry.message.startsWith('Bulk historical file upload'),
      ),
      ...(files.length > 0
        ? [
            createLog(
              'info',
              `Selected bulk historical price files: matched ${matchedSymbols.size} symbol(s) from ${files.length} file(s). Expected format: "SYMBOL_anything.csv".`,
            ),
          ]
        : []),
      ...(ignoredFileNames.length > 0
        ? [
            createLog(
              'warning',
              `Bulk historical file upload ignored ${ignoredFileNames.length} file(s) because the symbol prefix before "_" was missing or did not match the discovered IBKR symbols: ${ignoredFileNames.join(', ')}.`,
            ),
          ]
        : []),
      ...(duplicateSymbols.size > 0
        ? [
            createLog(
              'warning',
              `Bulk historical file upload received multiple files for ${[...duplicateSymbols].join(', ')}. The last matching file was kept for each symbol.`,
            ),
          ]
        : []),
    ])
  }

  function handleExchangeRateFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setGeneratedBroker(null)
    setParsedExchangeRateFile(null)
    setSelectedExchangeRateFile(file ?? null)

    if (!file) {
      setLogs((existingLogs) =>
        existingLogs.filter((entry) => !entry.message.startsWith('Selected exchange-rate file')),
      )
      return
    }

    setLogs((existingLogs) => [
      ...existingLogs.filter((entry) => !entry.message.startsWith('Selected exchange-rate file')),
      createLog('info', `Selected exchange-rate file "${file.name}".`),
    ])
  }

  async function handleGenerateReport() {
    if (!selectedBroker || !selectedExchangeRateFile) {
      return
    }

    setIsGenerating(true)

    try {
      if (selectedBroker === 'shareworks') {
        if (!selectedSalesFile || !selectedReleasesFile || !selectedHistoricalPriceFile) {
          return
        }

        const [salesCsvText, releasesCsvText, historicalPriceCsvText, exchangeRateCsvText] =
          await Promise.all([
            selectedSalesFile.text(),
            selectedReleasesFile.text(),
            selectedHistoricalPriceFile.text(),
            selectedExchangeRateFile.text(),
          ])
        const nextParsedSalesFile = parseShareworksCsv(salesCsvText)
        const nextParsedReleasesFile = parseShareworksReleasesCsv(releasesCsvText)
        const nextParsedHistoricalPriceFile = parseHistoricalPriceCsv(historicalPriceCsvText, 'TEAM')
        const nextParsedExchangeRateFile = parseExchangeRateCsv(exchangeRateCsvText)
        const nextReleaseTransactions = deriveReleaseTransactions(nextParsedReleasesFile.rows)
        const nextLongShareSales = deriveLongShareSaleTransactions(nextParsedSalesFile.rows)
        const nextFifoReport = buildFifoReport([...nextReleaseTransactions, ...nextLongShareSales])

        setParsedIbkrFile(null)
        setParsedSalesFile(nextParsedSalesFile)
        setParsedReleasesFile(nextParsedReleasesFile)
        setParsedHistoricalPriceFile(nextParsedHistoricalPriceFile)
        setParsedExchangeRateFile(nextParsedExchangeRateFile)
        setGeneratedBroker('shareworks')
        setActiveTab('overview')
        setLogs(
          buildParseLogs(
            nextParsedSalesFile,
            selectedSalesFile.name,
            nextParsedReleasesFile,
            selectedReleasesFile.name,
            nextParsedHistoricalPriceFile,
            selectedHistoricalPriceFile.name,
            nextParsedExchangeRateFile,
            selectedExchangeRateFile.name,
            nextReleaseTransactions,
            nextLongShareSales,
            nextFifoReport,
          ),
        )
        return
      }

      if (selectedBroker === 'ibkr') {
        if (!selectedIbkrFile || ibkrSymbols.length === 0 || ibkrHistoricalFiles.some((file) => !file)) {
          return
        }

        const [ibkrCsvText, exchangeRateCsvText, ...historicalPriceCsvTexts] = await Promise.all([
          selectedIbkrFile.text(),
          selectedExchangeRateFile.text(),
          ...ibkrHistoricalFiles.map((file) => file!.text()),
        ])

        const nextParsedIbkrFile = parseIbkrTransactionsCsv(ibkrCsvText)
        const nextParsedExchangeRateFile = parseExchangeRateCsv(exchangeRateCsvText)
        const parsedHistoricalPriceFiles = nextParsedIbkrFile.uniqueSymbols.map((symbol, index) =>
          parseHistoricalPriceCsv(historicalPriceCsvTexts[index], symbol),
        )
        const nextParsedHistoricalPriceFile: ParsedHistoricalPriceFile = {
          reportName: 'Historical Prices',
          rows: parsedHistoricalPriceFiles
            .flatMap((file) => file.rows)
            .sort((left, right) =>
              left.stockSymbol === right.stockSymbol
                ? left.date.localeCompare(right.date)
                : left.stockSymbol.localeCompare(right.stockSymbol),
            ),
        }
        const nextIbkrTransactions = deriveIbkrTransactions(nextParsedIbkrFile.rows)
        const nextFifoReport = buildFifoReport(nextIbkrTransactions)

        setParsedSalesFile(null)
        setParsedReleasesFile(null)
        setParsedIbkrFile(nextParsedIbkrFile)
        setParsedHistoricalPriceFile(nextParsedHistoricalPriceFile)
        setParsedExchangeRateFile(nextParsedExchangeRateFile)
        setGeneratedBroker('ibkr')
        setActiveTab('overview')
        setLogs(
          buildIbkrParseLogs(
            nextParsedIbkrFile,
            selectedIbkrFile.name,
            parsedHistoricalPriceFiles,
            nextParsedExchangeRateFile,
            selectedExchangeRateFile.name,
            nextIbkrTransactions,
            nextFifoReport,
          ),
        )
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse the selected file.'
      setGeneratedBroker(null)
      setParsedIbkrFile(null)
      setParsedSalesFile(null)
      setParsedReleasesFile(null)
      setParsedHistoricalPriceFile(null)
      setParsedExchangeRateFile(null)
      setLogs([createLog('error', message)])
    } finally {
      setIsGenerating(false)
    }
  }

  function handleBrokerChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextBroker = event.target.value as BrokerType | ''
    setSelectedBroker(nextBroker)
    setGeneratedBroker(null)
    setSelectedIbkrFile(null)
    setSelectedSalesFile(null)
    setSelectedReleasesFile(null)
    setSelectedHistoricalPriceFile(null)
    setSelectedHistoricalPriceFilesBySymbol({})
    setSelectedHistoricalPriceBulkFiles([])
    setSelectedExchangeRateFile(null)
    setParsedIbkrFile(null)
    setParsedSalesFile(null)
    setParsedReleasesFile(null)
    setParsedHistoricalPriceFile(null)
    setParsedExchangeRateFile(null)
    setLogs(
      nextBroker
        ? [
            createLog(
              'info',
              nextBroker === 'shareworks'
                ? 'Broker selected: Shareworks. Upload releases, long-share sales, historical TEAM price, and USD/INR rate CSV files next.'
                : 'Broker selected: IBKR. Upload the consolidated transactions CSV first, then upload historical price CSVs per symbol or in bulk using filenames like "SYMBOL_anything.csv", plus the USD/INR rate CSV.',
            ),
          ]
        : [],
    )
  }

  return (
    <main className="app-shell">
      {currentPage === 'landing' ? (
        <section className="landing-shell">
          <section className="landing-hero">
            <span className="eyebrow">FA-Helper-App</span>
            <h1>Prepare foreign stock tax schedules with a guided workflow</h1>
            <p>
              Upload Shareworks account reports, historical TEAM price data, and USD/INR exchange
              rates to generate reviewable outputs for Overview, Schedule FA A3, and Capital Gains.
            </p>

            <div className="landing-actions">
              <button type="button" className="primary-button" onClick={() => navigateToPage('builder')}>
                Open report builder
              </button>
              <button type="button" className="secondary-button" onClick={() => navigateToPage('samples')}>
                View sample formats
              </button>
              <p className="landing-note">
                Review the checklist first, then continue to the builder when your files are ready.
              </p>
            </div>
          </section>

          <section className="landing-grid">
            <article className="info-card">
              <span className="summary-label">Step 1</span>
              <strong>Download the Shareworks account report CSVs</strong>
              <p>
                From Shareworks, download the account report CSV files that contain your `RSU
                Releases` and `Sales - Long Shares` data.
              </p>
            </article>
            <article className="info-card">
              <span className="summary-label">Step 2</span>
              <strong>Get historical TEAM price data</strong>
              <p>
                Download historical prices from Nasdaq for TEAM so the app can derive max-price and
                closing-price values for Schedule FA.
              </p>
              <a
                className="resource-link"
                href="https://www.nasdaq.com/market-activity/stocks/team/historical?page=1&rows_per_page=10&timeline=y5"
                target="_blank"
                rel="noreferrer"
              >
                Open Nasdaq historical data
              </a>
            </article>
            <article className="info-card">
              <span className="summary-label">Step 3</span>
              <strong>Get USD to INR reference rates</strong>
              <p>
                Use the SBI reference rate CSV so the app can apply `TT BUY` conversion rules for
                Schedule FA and capital gains.
              </p>
              <a
                className="resource-link"
                href="https://github.com/sahilgupta/sbi-fx-ratekeeper/blob/main/csv_files/SBI_REFERENCE_RATES_USD.csv"
                target="_blank"
                rel="noreferrer"
              >
                Open SBI rate CSV source
              </a>
            </article>
          </section>

          <section className="hero-card landing-card">
            <div className="setup-panel-header">
              <div>
                <h2>Setup checklist</h2>
                <p>Keep these files ready before opening the builder.</p>
              </div>
            </div>

            <div className="landing-grid">
              <article className="summary-card">
                <span className="summary-label">Required files</span>
                <strong>4 CSV inputs</strong>
                <p>RSU releases, long-share sales, historical TEAM prices, and SBI USD/INR rates.</p>
              </article>
              <article className="summary-card">
                <span className="summary-label">Formatting help</span>
                <strong>Review sample file formats</strong>
                <p>Open the sample page to see the expected layout before uploading your own files.</p>
              </article>
              <article className="summary-card">
                <span className="summary-label">Year logic</span>
                <strong>AY drives CY and FY</strong>
                <p>Schedule FA uses calendar year. Capital gains uses financial year.</p>
              </article>
              <article className="summary-card">
                <span className="summary-label">Privacy</span>
                <strong>Browser-side processing</strong>
                <p>Your uploaded CSV data stays in the app session while you review and export tables.</p>
              </article>
            </div>
          </section>
        </section>
      ) : null}

      {currentPage === 'samples' ? (
        <>
          <section className="builder-nav">
            <button type="button" className="secondary-button" onClick={() => navigateToPage('landing')}>
              Back to setup guide
            </button>
            <div className="results-meta">
              <button type="button" className="secondary-button" onClick={() => navigateToPage('builder')}>
                Open report builder
              </button>
              <span className="badge subtle">Sample formats</span>
            </div>
          </section>

          <section className="hero-card">
            <div className="builder-hero">
              <div className="builder-hero-copy">
                <span className="eyebrow">Sample CSVs</span>
                <h1>Sample file formats</h1>
                <p>
                  These tables show example file layouts so you can verify the expected structure
                  before uploading your own Shareworks, historical price, and FX files.
                </p>
              </div>

              <div className="summary-grid">
                <article className="summary-card">
                  <span className="summary-label">Shareworks releases</span>
                  <strong>RSU vesting and sell-to-cover</strong>
                  <p>Use the account report export from Shareworks for this input.</p>
                </article>
                <article className="summary-card">
                  <span className="summary-label">Shareworks sales</span>
                  <strong>Long-share sale rows</strong>
                  <p>These rows later get matched through FIFO in the builder.</p>
                </article>
                <article className="summary-card">
                  <span className="summary-label">IBKR transactions</span>
                  <strong>Consolidated trade export</strong>
                  <p>Shows the single-file transaction format used to discover symbols and trades.</p>
                </article>
                <article className="summary-card">
                  <span className="summary-label">Historical prices</span>
                  <strong>TEAM daily price data</strong>
                  <p>Used for max-price and closing-price calculations in Schedule FA.</p>
                </article>
                <article className="summary-card">
                  <span className="summary-label">FX rates</span>
                  <strong>SBI TT BUY rates</strong>
                  <p>Used for INR conversion in Schedule FA and Capital Gains.</p>
                </article>
              </div>
            </div>
          </section>

          <section className="results-stack">
            {sampleTables.map((table) => {
              const preview = getSampleTablePreview(table.csvText)

              return (
                <SamplePreviewTable
                  key={table.id}
                  title={table.title}
                  description={table.description}
                  headers={preview.headers}
                  rows={preview.rows}
                />
              )
            })}
          </section>
        </>
      ) : null}

      {currentPage === 'builder' ? (
        <>
          <section className="builder-nav">
            <button type="button" className="secondary-button" onClick={() => navigateToPage('landing')}>
              Back to setup guide
            </button>
            <span className="badge subtle">Report builder</span>
          </section>

          <section className="hero-card">
            <div className="builder-hero">
              <div className="builder-hero-copy">
                <span className="eyebrow">FA-Helper-App</span>
                <h1>Report Builder</h1>
                <p>
                  Upload the required files, confirm the assessment-year window, and generate the
                  schedules from one focused workspace.
                </p>
              </div>

              <section className="setup-panel full-width">
            <div className="setup-panel-header">
              <div>
                <h2>Report Setup</h2>
                <p>Choose the year, confirm the required files, and generate the report when ready.</p>
              </div>
              <span className={`status-pill ${hasGeneratedReport ? 'ready' : hasAllRequiredFiles ? 'pending' : 'locked'}`}>
                {hasGeneratedReport
                  ? 'Report ready'
                  : hasAllRequiredFiles
                    ? 'Ready to generate'
                    : 'Setup in progress'}
              </span>
            </div>

            <div className="controls-grid">
              <label className="field">
                <span>Broker type</span>
                <select value={selectedBroker} onChange={handleBrokerChange}>
                  <option value="">Select a broker</option>
                  {BROKER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Assessment year</span>
                <select
                  value={selectedAssessmentYear}
                  onChange={(event) => setSelectedAssessmentYear(event.target.value)}
                >
                  {assessmentYearOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="year-context-grid">
              <article className="summary-card compact">
                <span className="summary-label">Calendar year</span>
                <strong>
                  {formatUiDate(assessmentYearContext.calendarStart)} -{' '}
                  {formatUiDate(assessmentYearContext.calendarEnd)}
                </strong>
              </article>
              <article className="summary-card compact">
                <span className="summary-label">Financial year</span>
                <strong>
                  {formatUiDate(assessmentYearContext.financialStart)} -{' '}
                  {formatUiDate(assessmentYearContext.financialEnd)}
                </strong>
              </article>
            </div>

            <div className="upload-section">
              <div className="section-copy">
                <h3>Required uploads</h3>
                <p>
                  {isShareworksSelected
                    ? `You have selected ${BROKER_OPTIONS[0].label}. Upload all four CSV files below.`
                    : isIbkrSelected
                      ? 'Upload the IBKR transactions CSV to discover symbols, then upload one historical price CSV for each symbol.'
                      : 'Start with the USD/INR rate file. Broker-specific inputs appear after choosing a broker.'}
                </p>
              </div>

              <div className="upload-grid">
                <UploadFieldCard
                  label="USD to INR Rate CSV"
                  helperText="Used for Schedule FA and capital gains INR conversion via SBI TT BUY rates."
                  file={selectedExchangeRateFile}
                  status={selectedExchangeRateFile ? 'ready' : 'pending'}
                  statusLabel={selectedExchangeRateFile ? 'Selected' : 'Required'}
                  onChange={handleExchangeRateFileSelect}
                />
                {isShareworksSelected ? (
                  <>
                    <UploadFieldCard
                      label="RSU Releases CSV"
                      helperText="Provides vesting, sell-to-cover, and held-share acquisition lots."
                      file={selectedReleasesFile}
                      status={selectedReleasesFile ? 'ready' : 'pending'}
                      statusLabel={selectedReleasesFile ? 'Selected' : 'Required'}
                      onChange={handleReleasesFileSelect}
                    />
                    <UploadFieldCard
                      label="Long Shares Sales CSV"
                      helperText="Provides later long-share disposals that get matched through FIFO."
                      file={selectedSalesFile}
                      status={selectedSalesFile ? 'ready' : 'pending'}
                      statusLabel={selectedSalesFile ? 'Selected' : 'Required'}
                      onChange={handleSalesFileSelect}
                    />
                    <UploadFieldCard
                      label="Historical TEAM Price"
                      helperText="Used for max-price and closing-price lookups in Schedule FA A3."
                      file={selectedHistoricalPriceFile}
                      status={selectedHistoricalPriceFile ? 'ready' : 'pending'}
                      statusLabel={selectedHistoricalPriceFile ? 'Selected' : 'Required'}
                      onChange={handleHistoricalPriceFileSelect}
                    />
                  </>
                ) : null}
                {isIbkrSelected ? (
                  <>
                    <UploadFieldCard
                      label="IBKR Transactions CSV"
                      helperText="Upload the consolidated transaction history export. Buy and sell rows drive FIFO; Dividend rows are used for the Schedule FA dividend column."
                      file={selectedIbkrFile}
                      status={selectedIbkrFile ? 'ready' : 'pending'}
                      statusLabel={selectedIbkrFile ? 'Selected' : 'Required'}
                      onChange={(event) => {
                        void handleIbkrFileSelect(event)
                      }}
                    />
                    <SymbolHistoricalPriceUploadCard
                      symbols={ibkrSymbols}
                      filesBySymbol={selectedHistoricalPriceFilesBySymbol}
                      onChangeForSymbol={handleHistoricalPriceFileSelectForSymbol}
                      bulkFileCount={selectedHistoricalPriceBulkFiles.length}
                      onBulkChange={handleHistoricalPriceBulkFilesSelect}
                    />
                  </>
                ) : null}
              </div>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="primary-button"
                disabled={!selectedBroker || !hasAllRequiredFiles || isGenerating}
                onClick={() => void handleGenerateReport()}
              >
                {isGenerating ? 'Generating report...' : 'Generate report'}
              </button>
              <div className="action-summary">
                <strong>
                  Files ready: {uploadProgressCount}/{uploadProgressTotal}
                </strong>
                <p>
                  Capital gains uses the <strong>financial year</strong>. Schedule FA A3 uses the{' '}
                  <strong>calendar year</strong>.
                </p>
              </div>
            </div>

            {!hasGeneratedReport ? (
              <p className="status-message">
                {isIbkrSelected
                  ? 'Select IBKR, upload the transactions file to discover symbols, then either upload historical price CSVs per symbol or bulk upload files named like `SYMBOL_anything.csv` before clicking `Generate report`.'
                  : 'Select a broker, upload the required CSV files, adjust the assessment year if needed, and then click `Generate report`.'}
              </p>
            ) : null}
              </section>
            </div>

            <div className="summary-grid">
          <article className="summary-card">
            <span className="summary-label">Assessment year</span>
            <strong>{assessmentYearContext.assessmentYearLabel}</strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">Calendar year</span>
            <strong>
              {formatUiDate(assessmentYearContext.calendarStart)} - {formatUiDate(assessmentYearContext.calendarEnd)}
            </strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">Financial year</span>
            <strong>
              {formatUiDate(assessmentYearContext.financialStart)} - {formatUiDate(assessmentYearContext.financialEnd)}
            </strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">
              {isIbkrSelected ? 'Trades / Symbols' : 'Releases / Sales rows'}
            </span>
            <strong>
              {isIbkrSelected
                ? `${parsedIbkrFile?.rows.length ?? 0} / ${parsedIbkrFile?.uniqueSymbols.length ?? 0}`
                : `${parsedReleasesFile?.rows.length ?? 0} / ${parsedSalesFile?.rows.length ?? 0}`}
            </strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">Historical price rows</span>
            <strong>{parsedHistoricalPriceFile?.rows.length ?? 0}</strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">FX rate rows</span>
            <strong>{parsedExchangeRateFile?.rows.length ?? 0}</strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">
              {isIbkrSelected ? 'Buy / Sell trades' : 'Held lots / Cover sales'}
            </span>
            <strong>
              {isIbkrSelected
                ? `${heldTransactions.length} / ${sellTransactions.length}`
                : `${heldTransactions.length} / ${sellToCoverTransactions.length}`}
            </strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">Ignored rows</span>
            <strong>
              {isIbkrSelected
                ? parsedIbkrFile?.ignoredRowCount ?? 0
                : (parsedReleasesFile?.ignoredRowCount ?? 0) + (parsedSalesFile?.ignoredRowCount ?? 0)}
            </strong>
          </article>
            </div>
          </section>

          {hasGeneratedReport ? (
        <section className="results-stack">
          <div className="results-topbar">
            <div>
              <h2>Generated Report</h2>
              <p>
                Review the current assessment year through tabs. Each table supports CSV export and
                keeps the existing business calculations unchanged.
              </p>
            </div>
            <div className="results-meta">
              <span className="badge">{assessmentYearContext.assessmentYearLabel}</span>
              <span className="badge subtle">
                {formatUiDate(assessmentYearContext.financialStart)} -{' '}
                {formatUiDate(assessmentYearContext.financialEnd)}
              </span>
            </div>
          </div>

          <div className="tabs-row">
            <TabButton isActive={activeTab === 'overview'} label="Overview" onClick={() => setActiveTab('overview')} />
            <TabButton isActive={activeTab === 'faA2'} label="Schedule FA A2" onClick={() => setActiveTab('faA2')} />
            <TabButton isActive={activeTab === 'faA3'} label="Schedule FA A3" onClick={() => setActiveTab('faA3')} />
            <TabButton
              isActive={activeTab === 'capitalGains'}
              label="Capital Gains"
              onClick={() => setActiveTab('capitalGains')}
            />
            <TabButton
              isActive={activeTab === 'dividendIncome'}
              label="Dividend Income"
              onClick={() => setActiveTab('dividendIncome')}
            />
          </div>

          {activeTab === 'overview' ? (
            <>
              <div className="section-banner">
                <div>
                  <h2>Overview</h2>
                  <p>
                    The current assessment year drives the date windows used below. FIFO matches and
                    sell-to-cover rows are filtered to the financial year, while holdings are shown
                    as of the calendar-year end.
                  </p>
                </div>
                <div className="results-meta">
                  <span className="badge">{capitalGainsMatches.length} FIFO matches</span>
                  <span className="badge subtle">
                    {overviewHoldingsReport.openHoldings.length} open holdings
                  </span>
                </div>
              </div>

              <FifoMatchesTable
                title="FIFO matched entries"
                subtitle="Financial-year long-share sales matched against held lots."
                matchedLots={capitalGainsMatches}
              />

              <SellToCoverTable
                title="Sell-To-Cover sales"
                subtitle="Financial-year cover sales from the releases file."
                sellToCoverRows={overviewSellToCoverRows}
              />

              <OpenHoldingsTable
                title="Still holding"
                subtitle="Open holdings remaining as of the selected calendar-year end."
                openHoldings={overviewHoldingsReport.openHoldings}
              />
            </>
          ) : null}

          {activeTab === 'faA2' ? (
            <>
              <div className="section-banner">
                <div>
                  <h2>Schedule FA A2</h2>
                  <p>
                    This tab uses the calendar year for {assessmentYearContext.assessmentYearLabel}:{' '}
                    {formatUiDate(assessmentYearContext.calendarStart)} to{' '}
                    {formatUiDate(assessmentYearContext.calendarEnd)}. Max value is checked on SBI
                    TT BUY rate dates; closing value is as of calendar-year end.
                  </p>
                </div>
                <div className="results-meta">
                  <span className="badge">{scheduleFaA2Rows.length} rows</span>
                  <span className="badge subtle">
                    {isIbkrSelected ? 'Securities plus cash' : 'Securities only'}
                  </span>
                </div>
              </div>

              <ScheduleFaA2Table rows={scheduleFaA2Rows} />
            </>
          ) : null}

          {activeTab === 'faA3' ? (
            <>
              <div className="section-banner">
                <div>
                  <h2>Schedule FA A3</h2>
                  <p>
                    This tab uses the calendar year for {assessmentYearContext.assessmentYearLabel}:{' '}
                    {formatUiDate(assessmentYearContext.calendarStart)} to{' '}
                    {formatUiDate(assessmentYearContext.calendarEnd)}.
                  </p>
                </div>
                <div className="results-meta">
                  <span className="badge">{scheduleFaRows.length} rows</span>
                  <span className="badge subtle">Calendar-year holdings overlap</span>
                </div>
              </div>

              <ScheduleFaTable rows={scheduleFaRows} />
            </>
          ) : null}

          {activeTab === 'capitalGains' ? (
            <>
              <div className="section-banner">
                <div>
                  <h2>Capital Gains</h2>
                  <p>
                    This tab uses the financial year for {assessmentYearContext.assessmentYearLabel}:{' '}
                    {formatUiDate(assessmentYearContext.financialStart)} to{' '}
                    {formatUiDate(assessmentYearContext.financialEnd)}.
                  </p>
                </div>
                <div className="results-meta">
                  <span className="badge">
                    {capitalGainsMatches.length + capitalGainsSellToCoverRows.length} rows
                  </span>
                  <span className="badge subtle">Previous-month FX lookup</span>
                </div>
              </div>

              <CapitalGainsTable
                title="Capital gains FIFO rows"
                subtitle="Financial-year long-share sales using previous-month SBI TT BUY rates for INR conversion."
                rows={capitalGainsMatchedDisplayRows}
              />

              <CapitalGainsTable
                title="Capital gains sell-to-cover rows"
                subtitle="Financial-year sell-to-cover sales using previous-month SBI TT BUY rates for INR conversion."
                rows={capitalGainsSellToCoverDisplayRows}
              />
            </>
          ) : null}

          {activeTab === 'dividendIncome' ? (
            <>
              <div className="section-banner">
                <div>
                  <h2>Dividend Income</h2>
                  <p>
                    This tab uses the financial year for {assessmentYearContext.assessmentYearLabel}:{' '}
                    {formatUiDate(assessmentYearContext.financialStart)} to{' '}
                    {formatUiDate(assessmentYearContext.financialEnd)}.
                  </p>
                </div>
                <div className="results-meta">
                  <span className="badge">{dividendIncomeRows.length} rows</span>
                  <span className="badge subtle">Previous-month FX lookup</span>
                </div>
              </div>

              <DividendIncomeTable rows={dividendIncomeRows} />
            </>
          ) : null}
        </section>
          ) : null}

          <section className="log-card">
        <div className="card-header">
          <div>
            <h2>Logs</h2>
            <p>
              Warnings and errors appear here. Ignored rows are CSV rows skipped during parsing,
              such as trailing Shareworks totals rows. FX fallback and missing-rate diagnostics for
              Schedule FA also appear here.
            </p>
          </div>
          <div className="results-meta">
            <span className="badge">{displayLogs.length} entries</span>
            <span className="badge subtle">{logCounts.info} info</span>
            <span className="badge subtle">{logCounts.warning} warnings</span>
            {logCounts.error > 0 ? <span className="badge subtle">{logCounts.error} errors</span> : null}
          </div>
        </div>

        <div className="log-list">
          {displayLogs.length > 0 ? (
            displayLogs.map((log) => (
              <article key={log.id} className={`log-entry ${log.level}`}>
                <span className="log-level">{log.level.toUpperCase()}</span>
                <p>{log.message}</p>
              </article>
            ))
          ) : (
            <p className="empty-logs">Logs will appear here after you select a broker or upload a file.</p>
          )}
        </div>
          </section>
        </>
      ) : null}

      <section className="disclaimer-card">
        <div className="card-header">
          <div>
            <h2>Disclaimer</h2>
            <p>
              This app is provided only as a helper for reviewing and organizing foreign stock data.
              It should not be used as the sole basis for tax filing, tax advice, or legal
              compliance.
            </p>
          </div>
        </div>

        <div className="disclaimer-copy">
          <p>
            By using this app, you acknowledge that the developers are not liable or responsible
            for any filing decisions, tax positions, calculation errors, omissions, or losses that
            may arise from its use.
          </p>
          <p>
            Please consult a qualified Chartered Accountant (CA) or other licensed tax professional
            before filing your tax return.
          </p>
        </div>
      </section>
    </main>
  )
}

export default App
