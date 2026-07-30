import { describe, expect, it } from 'vitest'

import { buildScheduleFaA2Rows } from './scheduleFaA2'
import type { NormalizedTransaction } from '../types'

const buyTransaction: NormalizedTransaction = {
  id: 'buy-team',
  broker: 'shareworks',
  stockSymbol: 'TEAM',
  transactionType: 'ACQUIRE',
  grantName: 'TEAM',
  grantNumber: 'TEAM',
  withdrawalReferenceNumber: 'buy-team',
  originatingReleaseReferenceNumber: 'buy-team',
  lotNumber: '1',
  tradeDate: '2025-01-10',
  acquisitionDate: '2025-01-10',
  shares: 2,
  pricePerShareUsd: 100,
  grossAmountUsd: 200,
  feeUsd: 0,
  sourceRowNumber: 1,
}

describe('buildScheduleFaA2Rows', () => {
  it('calculates securities-only max and closing account value for Shareworks', () => {
    const rows = buildScheduleFaA2Rows({
      transactions: [buyTransaction],
      cashLedgerRows: [],
      historicalPrices: [
        { stockSymbol: 'TEAM', date: '2025-01-10', highPriceUsd: 110, closePriceUsd: 108 },
        { stockSymbol: 'TEAM', date: '2025-12-31', highPriceUsd: 120, closePriceUsd: 115 },
      ],
      exchangeRates: [
        { date: '2025-01-10', ttBuyInr: 80 },
        { date: '2025-12-31', ttBuyInr: 82 },
      ],
      includeCash: false,
      context: {
        calendarStart: '2025-01-01',
        calendarEnd: '2025-12-31',
      },
    })

    expect(rows).toEqual([
      {
        accountType: 'Securities only',
        calendarStart: '2025-01-01',
        calendarEnd: '2025-12-31',
        maxValueDate: '2025-12-31',
        maxFxRate: 82,
        maxSecuritiesValueUsd: 240,
        maxCashBalanceUsd: 0,
        maxAccountValueUsd: 240,
        maxAccountValueInr: 19680,
        closingValueDate: '2025-12-31',
        closingFxRate: 82,
        closingFxRateDate: '2025-12-31',
        closingSecuritiesValueUsd: 230,
        closingCashBalanceUsd: 0,
        closingAccountValueUsd: 230,
        closingAccountValueInr: 18860,
      },
    ])
  })

  it('adds IBKR cash movements to securities value', () => {
    const rows = buildScheduleFaA2Rows({
      transactions: [
        {
          ...buyTransaction,
          broker: 'ibkr',
          stockSymbol: 'GOOG',
          shares: 1,
          tradeDate: '2025-01-10',
          sourceRowNumber: 2,
        },
      ],
      cashLedgerRows: [
        {
          broker: 'ibkr',
          stockSymbol: '-',
          sourceRowNumber: 1,
          tradeDate: '2025-01-05',
          description: 'Deposit',
          transactionTypeLabel: 'Deposit',
          netAmountUsd: 500,
        },
        {
          broker: 'ibkr',
          stockSymbol: 'GOOG',
          sourceRowNumber: 2,
          tradeDate: '2025-01-10',
          description: 'Buy',
          transactionTypeLabel: 'Buy',
          netAmountUsd: -100,
        },
        {
          broker: 'ibkr',
          stockSymbol: 'GOOG',
          sourceRowNumber: 3,
          tradeDate: '2025-03-20',
          description: 'Dividend',
          transactionTypeLabel: 'Dividend',
          netAmountUsd: 2,
        },
        {
          broker: 'ibkr',
          stockSymbol: 'GOOG',
          sourceRowNumber: 4,
          tradeDate: '2025-03-20',
          description: 'Withholding',
          transactionTypeLabel: 'Foreign Tax Withholding',
          netAmountUsd: -0.5,
        },
      ],
      historicalPrices: [
        { stockSymbol: 'GOOG', date: '2025-01-10', highPriceUsd: 120, closePriceUsd: 110 },
        { stockSymbol: 'GOOG', date: '2025-12-31', highPriceUsd: 150, closePriceUsd: 140 },
      ],
      exchangeRates: [
        { date: '2025-01-10', ttBuyInr: 80 },
        { date: '2025-12-31', ttBuyInr: 82 },
      ],
      includeCash: true,
      context: {
        calendarStart: '2025-01-01',
        calendarEnd: '2025-12-31',
      },
    })

    expect(rows[0]).toMatchObject({
      accountType: 'Securities plus cash',
      maxValueDate: '2025-12-31',
      maxSecuritiesValueUsd: 150,
      maxCashBalanceUsd: 401.5,
      maxAccountValueUsd: 551.5,
      maxAccountValueInr: 45223,
      closingSecuritiesValueUsd: 140,
      closingCashBalanceUsd: 401.5,
      closingAccountValueUsd: 541.5,
      closingAccountValueInr: 44403,
    })
  })
})
