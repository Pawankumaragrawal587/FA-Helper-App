import { describe, expect, it } from 'vitest'

import { buildFifoReport } from '../common/fifo'
import { parseShareworksCsv } from './parser'
import { deriveReleaseTransactions, parseShareworksReleasesCsv } from './releases'
import { deriveLongShareSaleTransactions } from './transform'

const salesCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Sale Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
01-Jan-2025,31-Dec-2025,SELLREF-001,RELREF-001,GRANT-001,Sample Grant Alpha,1,Long Shares,20-Jun-2025,10-Mar-2025,NO,$100.00,USD,$500.00,USD,5,$550.00,USD,$110.0000,USD,$0.00,USD,$0.20,USD
01-Jan-2025,31-Dec-2025,SELLREF-002,RELREF-002,GRANT-002,Sample Grant Beta,1,Long Shares,01-Jul-2025,15-Apr-2025,NO,$120.00,USD,$480.00,USD,4,$520.00,USD,$130.0000,USD,$0.00,USD,$0.25,USD
`

const releasesCsv = `RSU Releases
Period Start Date,Period End Date,Grant Date,Grant Number,Grant Type,Grant Name,Grant Reason,Release Date,Shares Vested,Shares Sold-To-Cover,Shares Held,Value,,Fair Market Value Per Share,,Sale Date (Sell-To-Cover only),Sale Price Per Share,,Sale Proceeds,,Sell-To-Cover Amount,,Release Reference Number
01-Jan-2025,31-Dec-2025,05-Jan-2025,GRANT-001,Share Units (RSU),Sample Grant Alpha,Ongoing,10-Mar-2025,12,4,8,"$1,200.00",USD,$100.00,USD,11-Mar-2025,$98.5000,USD,"$394.00",USD,"$393.80",USD,RELREF-001
01-Jan-2025,31-Dec-2025,15-Feb-2025,GRANT-002,Share Units (RSU),Sample Grant Beta,Ongoing,15-Apr-2025,9,3,6,"$1,080.00",USD,$120.00,USD,16-Apr-2025,$119.0000,USD,"$357.00",USD,"$356.85",USD,RELREF-002
`

describe('Shareworks combined flow', () => {
  it('uses releases for held lots and long-share sales for FIFO matching', () => {
    const parsedSales = parseShareworksCsv(salesCsv)
    const parsedReleases = parseShareworksReleasesCsv(releasesCsv)
    const releaseTransactions = deriveReleaseTransactions(parsedReleases.rows)
    const longShareSales = deriveLongShareSaleTransactions(parsedSales.rows)
    const fifoReport = buildFifoReport([...releaseTransactions, ...longShareSales])

    expect(parsedSales.rows).toHaveLength(2)
    expect(parsedReleases.rows).toHaveLength(2)
    expect(releaseTransactions.filter((row) => row.transactionType === 'ACQUIRE')).toHaveLength(2)
    expect(releaseTransactions.filter((row) => row.transactionType === 'SELL_TO_COVER')).toHaveLength(2)
    expect(longShareSales).toHaveLength(2)
    expect(fifoReport.matchedLots).toHaveLength(3)
    expect(fifoReport.unmatchedSellShares).toBe(0)
    expect(
      fifoReport.openHoldings.reduce((total, holding) => total + holding.sharesRemaining, 0),
    ).toBe(5)
    expect(fifoReport.openHoldings.map((holding) => holding.sharesRemaining)).toEqual([5])
  })
})
