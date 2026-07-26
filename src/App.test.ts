import { describe, expect, it } from 'vitest'

import { buildScheduleFaRows } from './common/scheduleFa'
import type { FifoMatchedLot, OpenHolding } from './types'

const context = {
  assessmentYearLabel: '2026-27',
  assessmentYearStart: 2026,
  calendarStart: '2025-01-01',
  calendarEnd: '2025-12-31',
  financialStart: '2025-04-01',
  financialEnd: '2026-03-31',
}

describe('buildScheduleFaRows', () => {
  it('does not double count lots that are sold after the calendar year ends', () => {
    const lifetimeMatchedLots: FifoMatchedLot[] = [
      {
        id: 'goog-2024-sold-2025',
        acquisitionTransactionId: 'buy-2024-1',
        sellTransactionId: 'sell-2025-1',
        stockSymbol: 'GOOG',
        grantName: 'GOOG',
        grantNumber: 'GOOG',
        buyDate: '2024-11-26',
        sellDate: '2025-03-26',
        acquisitionSourceRowNumber: 1,
        sellSourceRowNumber: 2,
        sharesMatched: 1,
        buyPricePerShareUsd: 170.51,
        sellPricePerShareUsd: 172.72,
        buyAmountUsd: 170.51,
        sellAmountUsd: 172.72,
        allocatedFeeUsd: 0.35,
        netProceedsUsd: 172.37,
        gainOrLossUsd: 2.21,
      },
      {
        id: 'goog-2025-sold-2026',
        acquisitionTransactionId: 'buy-2025-1',
        sellTransactionId: 'sell-2026-1',
        stockSymbol: 'GOOG',
        grantName: 'GOOG',
        grantNumber: 'GOOG',
        buyDate: '2025-02-26',
        sellDate: '2026-02-20',
        acquisitionSourceRowNumber: 3,
        sellSourceRowNumber: 4,
        sharesMatched: 2,
        buyPricePerShareUsd: 175.84,
        sellPricePerShareUsd: 311,
        buyAmountUsd: 351.68,
        sellAmountUsd: 622,
        allocatedFeeUsd: 0.35,
        netProceedsUsd: 621.65,
        gainOrLossUsd: 270.32,
      },
    ]

    const openHoldings: OpenHolding[] = [
      {
        id: 'buy-2025-1-open',
        stockSymbol: 'GOOG',
        grantName: 'GOOG',
        grantNumber: 'GOOG',
        buyDate: '2025-02-26',
        sourceRowNumber: 3,
        sharesRemaining: 2,
        buyPricePerShareUsd: 175.84,
        costBasisUsd: 351.68,
      },
    ]

    const rows = buildScheduleFaRows(lifetimeMatchedLots, [], openHoldings, [], [], [], context)

    expect(
      rows.map((row) => ({
        holdingType: row.holdingType,
        buyDate: row.buyDate,
        sellDate: row.sellDate,
        shares: row.shares,
      })),
    ).toEqual([
      {
        holdingType: 'Long Shares Sold',
        buyDate: '2024-11-26',
        sellDate: '2025-03-26',
        shares: 1,
      },
      {
        holdingType: 'Still Holding',
        buyDate: '2025-02-26',
        sellDate: null,
        shares: 2,
      },
    ])
  })

  it('allocates dividend amounts across the active lots for the dividend date', () => {
    const lifetimeMatchedLots: FifoMatchedLot[] = [
      {
        id: 'goog-sold-2025',
        acquisitionTransactionId: 'buy-2024-1',
        sellTransactionId: 'sell-2025-1',
        stockSymbol: 'GOOG',
        grantName: 'GOOG',
        grantNumber: 'GOOG',
        buyDate: '2024-11-26',
        sellDate: '2025-03-26',
        acquisitionSourceRowNumber: 1,
        sellSourceRowNumber: 2,
        sharesMatched: 1,
        buyPricePerShareUsd: 170.51,
        sellPricePerShareUsd: 172.72,
        buyAmountUsd: 170.51,
        sellAmountUsd: 172.72,
        allocatedFeeUsd: 0.35,
        netProceedsUsd: 172.37,
        gainOrLossUsd: 2.21,
      },
    ]

    const openHoldings: OpenHolding[] = [
      {
        id: 'buy-2025-1-open',
        stockSymbol: 'GOOG',
        grantName: 'GOOG',
        grantNumber: 'GOOG',
        buyDate: '2025-02-26',
        sourceRowNumber: 3,
        sharesRemaining: 2,
        buyPricePerShareUsd: 175.84,
        costBasisUsd: 351.68,
      },
    ]

    const rows = buildScheduleFaRows(
      lifetimeMatchedLots,
      [],
      openHoldings,
      [],
      [
        { date: '2025-02-28', ttBuyInr: 80 },
        { date: '2025-03-31', ttBuyInr: 81 },
      ],
      [
        {
          broker: 'ibkr',
          stockSymbol: 'GOOG',
          sourceRowNumber: 10,
          tradeDate: '2025-03-01',
          description: 'Dividend 1',
          transactionTypeLabel: 'Dividend',
          netAmountUsd: 3,
        },
        {
          broker: 'ibkr',
          stockSymbol: 'GOOG',
          sourceRowNumber: 11,
          tradeDate: '2025-04-15',
          description: 'Dividend 2',
          transactionTypeLabel: 'Dividend',
          netAmountUsd: 2,
        },
      ],
      context,
    )

    expect(
      rows.map((row) => ({
        holdingType: row.holdingType,
        buyDate: row.buyDate,
        dividendReceivedUsd: row.dividendReceivedUsd,
        dividendFxRate: row.dividendFxRate,
        dividendFxDate: row.dividendFxDate,
        dividendReceivedInr: row.dividendReceivedInr,
      })),
    ).toEqual([
      {
        holdingType: 'Long Shares Sold',
        buyDate: '2024-11-26',
        dividendReceivedUsd: 1,
        dividendFxRate: '80.00',
        dividendFxDate: '2025-02-28',
        dividendReceivedInr: 80,
      },
      {
        holdingType: 'Still Holding',
        buyDate: '2025-02-26',
        dividendReceivedUsd: 4,
        dividendFxRate: '80.00; 81.00',
        dividendFxDate: '2025-02-28; 2025-03-31',
        dividendReceivedInr: 322,
      },
    ])
  })
})
