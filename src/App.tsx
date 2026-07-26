import { useMemo, useState, type ChangeEvent } from 'react'

import './App.css'
import { buildFifoReport } from './shareworks/fifo'
import {
  getCapitalGainsExchangeRate,
  getExchangeRateOnOrBefore,
  getMaxInrAmountForRange,
  parseExchangeRateCsv,
} from './shareworks/exchangeRates'
import { parseHistoricalPriceCsv } from './shareworks/historicalPrices'
import { parseShareworksCsv } from './shareworks/parser'
import { deriveReleaseTransactions, parseShareworksReleasesCsv } from './shareworks/releases'
import { deriveLongShareSaleTransactions } from './shareworks/transform'
import type {
  BrokerType,
  ExchangeRateRow,
  FifoMatchedLot,
  FifoReport,
  HistoricalPriceRow,
  NormalizedTransaction,
  ParsedExchangeRateFile,
  OpenHolding,
  ParsedHistoricalPriceFile,
  ParsedShareworksFile,
  ParsedShareworksReleasesFile,
} from './types'

const BROKER_OPTIONS: Array<{ value: BrokerType; label: string }> = [
  { value: 'shareworks', label: 'Shareworks (Atlassian RSU)' },
]

type LogLevel = 'info' | 'warning' | 'error'
type ReportTabId = 'overview' | 'faA3' | 'capitalGains'

interface UiLogEntry {
  id: string
  level: LogLevel
  message: string
}

interface SellToCoverDisplayRow {
  id: string
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

interface AssessmentYearContext {
  assessmentYearLabel: string
  assessmentYearStart: number
  calendarStart: string
  calendarEnd: string
  financialStart: string
  financialEnd: string
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

function createLog(level: LogLevel, message: string): UiLogEntry {
  return {
    id: `${level}-${crypto.randomUUID()}`,
    level,
    message,
  }
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

function sortByBuyDateAndName(
  left: { buyDate: string; grantName: string },
  right: { buyDate: string; grantName: string },
): number {
  if (left.buyDate !== right.buyDate) {
    return left.buyDate.localeCompare(right.buyDate)
  }

  return left.grantName.localeCompare(right.grantName)
}

function sortByBuyDateThenSellDate<
  T extends { buyDate: string; sellDate?: string | null; grantName?: string }
>(left: T, right: T): number {
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
): number {
  const candidateYears = [
    ...(parsedSalesFile?.rows.map((row) => Number(row.saleDate.slice(0, 4))) ?? []),
    ...(parsedReleasesFile?.rows.map((row) => Number(row.releaseDate.slice(0, 4))) ?? []),
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

function getMaxPriceForRange(
  historicalPrices: HistoricalPriceRow[],
  startDate: string,
  endDate: string,
): { price: number; date: string } | null {
  const matchingRows = historicalPrices.filter((row) => row.date >= startDate && row.date <= endDate)

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
  endDate: string,
): number | null {
  const matchingRows = historicalPrices.filter((row) => row.date <= endDate)
  const lastRow = matchingRows.at(-1)

  return lastRow ? lastRow.closePriceUsd : null
}

function buildScheduleFaRows(
  lifetimeMatchedLots: FifoMatchedLot[],
  sellToCoverRows: SellToCoverDisplayRow[],
  openHoldings: OpenHolding[],
  historicalPrices: HistoricalPriceRow[],
  exchangeRates: ExchangeRateRow[],
  context: AssessmentYearContext,
): ScheduleFaRow[] {
  const matchedRows = lifetimeMatchedLots
    .filter(
      (row) => row.buyDate <= context.calendarEnd && row.sellDate >= context.calendarStart,
    )
    .map((row) => {
      const rangeStart = row.buyDate > context.calendarStart ? row.buyDate : context.calendarStart
      const rangeEnd = row.sellDate < context.calendarEnd ? row.sellDate : context.calendarEnd
      const maxPriceResult = getMaxPriceForRange(
        historicalPrices,
        rangeStart,
        rangeEnd,
      )
      const buyFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.buyDate)
      const sellFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.sellDate)
      const maxInrResult = getMaxInrAmountForRange(
        historicalPrices,
        exchangeRates,
        rangeStart,
        rangeEnd,
        row.sharesMatched,
      )
      const maxPricePerShareUsd = maxPriceResult?.price ?? null

      return {
        id: `${row.id}-fa-long`,
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
    .filter((row) => row.buyDate <= context.calendarEnd && row.sellDate >= context.calendarStart)
    .map((row) => {
      const rangeStart = row.buyDate > context.calendarStart ? row.buyDate : context.calendarStart
      const rangeEnd = row.sellDate < context.calendarEnd ? row.sellDate : context.calendarEnd
      const maxPriceResult = getMaxPriceForRange(
        historicalPrices,
        rangeStart,
        rangeEnd,
      )
      const buyFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.buyDate)
      const sellFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.sellDate)
      const maxInrResult = getMaxInrAmountForRange(
        historicalPrices,
        exchangeRates,
        rangeStart,
        rangeEnd,
        row.sharesMatched,
      )
      const maxPricePerShareUsd = maxPriceResult?.price ?? null

      return {
        id: `${row.id}-fa-cover`,
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
        rangeStart,
        context.calendarEnd,
      )
      const buyFxLookup = getExchangeRateOnOrBefore(exchangeRates, row.buyDate)
      const maxInrResult = getMaxInrAmountForRange(
        historicalPrices,
        exchangeRates,
        rangeStart,
        context.calendarEnd,
        row.sharesRemaining,
      )
      const maxPricePerShareUsd = maxPriceResult?.price ?? null
      const closingPricePerShareUsd = getClosingPriceOnOrBefore(historicalPrices, context.calendarEnd)
      const closingAmountUsd =
        closingPricePerShareUsd !== null
          ? Number((closingPricePerShareUsd * row.sharesRemaining).toFixed(2))
          : null
      const closingFxLookup = getExchangeRateOnOrBefore(exchangeRates, context.calendarEnd)

      return {
        id: `${row.id}-fa-open`,
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

  return [...matchedRows, ...coverRows, ...openRows].sort(sortByBuyDateAndName)
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

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="badge">{matchedLots.length} rows</span>
      </div>

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

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="badge">{sortedSellToCoverRows.length} rows</span>
      </div>

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

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="badge">{sortedRows.length} rows</span>
      </div>

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

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="badge">{openHoldings.length} rows</span>
      </div>

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
  const totalMaxAmountUsd = sumBy(sortedRows, (row) => row.maxAmountUsd ?? 0)
  const totalMaxAmountInr = sumBy(sortedRows, (row) => row.maxAmountInr ?? 0)
  const totalClosingAmountUsd = sumBy(sortedRows, (row) => row.closingAmountUsd ?? 0)
  const totalClosingAmountInr = sumBy(sortedRows, (row) => row.closingAmountInr ?? 0)

  return (
    <section className="transaction-card">
      <div className="card-header">
        <div>
          <h3>Schedule FA A3</h3>
          <p>Calendar-year transaction disclosure rows for the selected assessment year.</p>
        </div>
        <span className="badge">{rows.length} rows</span>
      </div>

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
    </section>
  )
}

function App() {
  const [selectedBroker, setSelectedBroker] = useState<BrokerType | ''>('')
  const [selectedSalesFile, setSelectedSalesFile] = useState<File | null>(null)
  const [selectedReleasesFile, setSelectedReleasesFile] = useState<File | null>(null)
  const [selectedHistoricalPriceFile, setSelectedHistoricalPriceFile] = useState<File | null>(null)
  const [selectedExchangeRateFile, setSelectedExchangeRateFile] = useState<File | null>(null)
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
    () => inferAssessmentYearStart(parsedSalesFile, parsedReleasesFile),
    [parsedSalesFile, parsedReleasesFile],
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
  const longShareSales = useMemo(
    () => (parsedSalesFile ? deriveLongShareSaleTransactions(parsedSalesFile.rows) : []),
    [parsedSalesFile],
  )
  const heldTransactions = useMemo(
    () => releaseTransactions.filter((transaction) => transaction.transactionType === 'ACQUIRE'),
    [releaseTransactions],
  )
  const sellToCoverTransactions = useMemo(
    () => releaseTransactions.filter((transaction) => transaction.transactionType === 'SELL_TO_COVER'),
    [releaseTransactions],
  )
  const sellToCoverRows = useMemo(
    () => buildSellToCoverRows(parsedReleasesFile),
    [parsedReleasesFile],
  )

  const capitalGainsBaseReport = useMemo(
    () =>
      buildFifoReport([
        ...heldTransactions.filter((transaction) => transaction.tradeDate <= assessmentYearContext.financialEnd),
        ...longShareSales.filter((transaction) => transaction.tradeDate <= assessmentYearContext.financialEnd),
      ]),
    [assessmentYearContext.financialEnd, heldTransactions, longShareSales],
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

  const lifetimeFifoReport = useMemo(
    () => buildFifoReport([...heldTransactions, ...longShareSales]),
    [heldTransactions, longShareSales],
  )

  const overviewHoldingsReport = useMemo(
    () =>
      buildFifoReport([
        ...heldTransactions.filter((transaction) => transaction.tradeDate <= assessmentYearContext.calendarEnd),
        ...longShareSales.filter((transaction) => transaction.tradeDate <= assessmentYearContext.calendarEnd),
      ]),
    [assessmentYearContext.calendarEnd, heldTransactions, longShareSales],
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
        assessmentYearContext,
      ),
    [
      assessmentYearContext,
      parsedExchangeRateFile,
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

  function handleSalesFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
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

  function handleExchangeRateFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
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
    if (
      !selectedBroker ||
      !selectedSalesFile ||
      !selectedReleasesFile ||
      !selectedHistoricalPriceFile ||
      !selectedExchangeRateFile
    ) {
      return
    }

    setIsGenerating(true)

    try {
      const [salesCsvText, releasesCsvText, historicalPriceCsvText, exchangeRateCsvText] =
        await Promise.all([
        selectedSalesFile.text(),
        selectedReleasesFile.text(),
        selectedHistoricalPriceFile.text(),
        selectedExchangeRateFile.text(),
      ])
      const nextParsedSalesFile = parseShareworksCsv(salesCsvText)
      const nextParsedReleasesFile = parseShareworksReleasesCsv(releasesCsvText)
      const nextParsedHistoricalPriceFile = parseHistoricalPriceCsv(historicalPriceCsvText)
      const nextParsedExchangeRateFile = parseExchangeRateCsv(exchangeRateCsvText)
      const nextReleaseTransactions = deriveReleaseTransactions(nextParsedReleasesFile.rows)
      const nextLongShareSales = deriveLongShareSaleTransactions(nextParsedSalesFile.rows)
      const nextFifoReport = buildFifoReport([...nextReleaseTransactions, ...nextLongShareSales])

      setParsedSalesFile(nextParsedSalesFile)
      setParsedReleasesFile(nextParsedReleasesFile)
      setParsedHistoricalPriceFile(nextParsedHistoricalPriceFile)
      setParsedExchangeRateFile(nextParsedExchangeRateFile)
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse the selected file.'
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
    setSelectedSalesFile(null)
    setSelectedReleasesFile(null)
    setSelectedHistoricalPriceFile(null)
    setSelectedExchangeRateFile(null)
    setParsedSalesFile(null)
    setParsedReleasesFile(null)
    setParsedHistoricalPriceFile(null)
    setParsedExchangeRateFile(null)
    setLogs(
      nextBroker
        ? [
            createLog(
              'info',
              'Broker selected: Shareworks. Upload releases, long-share sales, historical-price, and USD/INR rate CSV files next.',
            ),
          ]
        : [],
    )
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">FA-Helper-App</span>
          <h1>Upload Shareworks releases, sales, price, and FX CSVs to build the report</h1>
          <p>
            The releases file supplies vested shares, sell-to-cover shares, and held shares. The
            long-share sales file supplies the later sales. The historical price file supplies the
            max-price and closing-price lookups used by Schedule FA A3. The USD/INR file supplies
            SBI `TT BUY` rates for INR conversions. Select an assessment year to derive the
            matching financial-year and calendar-year windows used by each tab.
          </p>
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

          <label className={`field upload-field ${!selectedBroker ? 'disabled' : ''}`}>
            <span>RSU Releases CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!selectedBroker}
              onChange={handleReleasesFileSelect}
            />
          </label>

          <label className={`field upload-field ${!selectedBroker ? 'disabled' : ''}`}>
            <span>Long Shares Sales CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!selectedBroker}
              onChange={handleSalesFileSelect}
            />
          </label>

          <label className={`field upload-field ${!selectedBroker ? 'disabled' : ''}`}>
            <span>Historical Price CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!selectedBroker}
              onChange={handleHistoricalPriceFileSelect}
            />
          </label>

          <label className={`field upload-field ${!selectedBroker ? 'disabled' : ''}`}>
            <span>USD to INR Rate CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!selectedBroker}
              onChange={handleExchangeRateFileSelect}
            />
          </label>

          <label className="field">
            <span>Assessment year</span>
            <select value={selectedAssessmentYear} onChange={(event) => setSelectedAssessmentYear(event.target.value)}>
              {assessmentYearOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="primary-button"
            disabled={
              !selectedBroker ||
              !selectedSalesFile ||
              !selectedReleasesFile ||
              !selectedHistoricalPriceFile ||
              !selectedExchangeRateFile ||
              isGenerating
            }
            onClick={() => void handleGenerateReport()}
          >
            {isGenerating ? 'Generating report...' : 'Generate report'}
          </button>
          <p className="helper-copy">
            Capital gains uses the <strong>financial year</strong>. Schedule FA A3 uses the{' '}
            <strong>calendar year</strong>.
          </p>
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
            <span className="summary-label">Releases / Sales rows</span>
            <strong>
              {parsedReleasesFile?.rows.length ?? 0} / {parsedSalesFile?.rows.length ?? 0}
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
            <span className="summary-label">Held lots / Cover sales</span>
            <strong>
              {heldTransactions.length} / {sellToCoverTransactions.length}
            </strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">Ignored rows</span>
            <strong>
              {(parsedReleasesFile?.ignoredRowCount ?? 0) + (parsedSalesFile?.ignoredRowCount ?? 0)}
            </strong>
          </article>
        </div>

        {!parsedSalesFile || !parsedReleasesFile || !parsedHistoricalPriceFile || !parsedExchangeRateFile ? (
          <p className="status-message">
            Select `Shareworks`, choose the releases, sales, historical price, and USD/INR rate
            CSV files, optionally adjust the assessment year, and click `Generate report`.
          </p>
        ) : null}
      </section>

      {parsedSalesFile && parsedReleasesFile && parsedHistoricalPriceFile && parsedExchangeRateFile ? (
        <section className="results-stack">
          <div className="tabs-row">
            <TabButton isActive={activeTab === 'overview'} label="Overview" onClick={() => setActiveTab('overview')} />
            <TabButton isActive={activeTab === 'faA3'} label="Schedule FA A3" onClick={() => setActiveTab('faA3')} />
            <TabButton
              isActive={activeTab === 'capitalGains'}
              label="Capital Gains"
              onClick={() => setActiveTab('capitalGains')}
            />
          </div>

          {activeTab === 'overview' ? (
            <>
              <div className="card-header">
                <div>
                  <h2>Overview</h2>
                  <p>
                    The current assessment year drives the date windows used below. FIFO matches and
                    sell-to-cover rows are filtered to the financial year, while holdings are shown
                    as of the calendar-year end.
                  </p>
                </div>
                <span className="badge">{capitalGainsMatches.length} FIFO matches</span>
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

              {overviewHoldingsReport.openHoldings.length > 0 ? (
                <OpenHoldingsTable
                  title="Still holding"
                  subtitle="Open holdings remaining as of the selected calendar-year end."
                  openHoldings={overviewHoldingsReport.openHoldings}
                />
              ) : (
                <section className="transaction-card">
                  <div className="card-header">
                    <div>
                      <h3>Still holding</h3>
                      <p>No open holdings remain as of the selected calendar-year end.</p>
                    </div>
                    <span className="badge">0 rows</span>
                  </div>
                </section>
              )}
            </>
          ) : null}

          {activeTab === 'faA3' ? (
            <>
              <div className="card-header">
                <div>
                  <h2>Schedule FA A3</h2>
                  <p>
                    This tab uses the calendar year for {assessmentYearContext.assessmentYearLabel}:{' '}
                    {formatUiDate(assessmentYearContext.calendarStart)} to{' '}
                    {formatUiDate(assessmentYearContext.calendarEnd)}.
                  </p>
                </div>
                <span className="badge">{scheduleFaRows.length} rows</span>
              </div>

              <ScheduleFaTable rows={scheduleFaRows} />
            </>
          ) : null}

          {activeTab === 'capitalGains' ? (
            <>
              <div className="card-header">
                <div>
                  <h2>Capital Gains</h2>
                  <p>
                    This tab uses the financial year for {assessmentYearContext.assessmentYearLabel}:{' '}
                    {formatUiDate(assessmentYearContext.financialStart)} to{' '}
                    {formatUiDate(assessmentYearContext.financialEnd)}.
                  </p>
                </div>
                <span className="badge">
                  {capitalGainsMatches.length + capitalGainsSellToCoverRows.length} rows
                </span>
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
          <span className="badge">{displayLogs.length} entries</span>
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
    </main>
  )
}

export default App
