// Ticker filter groups for the Best Recipes page

export interface TickerFilterGroup {
  id: string;
  label: string;
  tickers: string[] | null; // null means "All" (no filter)
}

export const tickerFilterGroups: TickerFilterGroup[] = [
  {
    id: 'all',
    label: 'All',
    tickers: null
  },
  {
    id: 'market-makers',
    label: 'Market Makers',
    tickers: [
      'STR',
      'SP',
      'UTS',
      'POW',
      'EDC',
      'IDC',
      'CBS',
      'RED',
      'CBM',
      'LOG',
      'ADR',
      'SRD',
      'CCD',
      'CBL',
      'SDR',
      'SUD',
      'NV1',
      'WR',
      'AIR',
      'CRU',
      'NV2',
      'FFC',
      'LIS',
      'CC'
    ]
  },
  {
    id: 'consumables',
    label: 'Consumables',
    tickers: [
      'DW',
      'RAT',
      'OVE',
      'PWO',
      'COF',
      'EXO',
      'PT',
      'REP',
      'KOM',
      'HMS',
      'MED',
      'SCN',
      'ALE',
      'SC',
      'FIM',
      'HSS',
      'PDA',
      'GIN',
      'VG',
      'MEA',
      'WIN',
      'NST',
      'LC',
      'WS'
    ]
  },
  {
    id: 'construction-prefabs',
    label: 'Construction Prefabs',
    tickers: [
      'BBH',
      'BSE',
      'BDE',
      'BTA',
      'LBH',
      'LDE',
      'LSE',
      'LTA',
      'RBH',
      'RDE',
      'RSE',
      'RTA',
      'ABH',
      'ADE',
      'ASE',
      'ATA'
    ]
  },
  // Add more filter groups below as needed
  // {
  //   id: 'electronics',
  //   label: 'Electronics',
  //   tickers: ['...']
  // },
];
