// Places whose draw is a flower in bloom, known by their name: 白河林初埤木棉花道
// is typed a hiking area, so the climate check (climate.ts isInSeason) let it
// into a November trip, months after its kapok flowers. Months are generous,
// covering Taiwan and Japan (櫻 opens in January in Taiwan, May in 北海道).
// 薰衣草 is left out: 「薰衣草森林」 is a café chain, not a field.

type Bloom = { name: RegExp; months: number[] };

const BLOOMS: Bloom[] = [
  { name: /木棉/, months: [3, 4] },
  { name: /櫻|桜|樱|sakura/i, months: [1, 2, 3, 4, 5] },
  { name: /油桐|桐花/, months: [4, 5] },
  { name: /繡球|绣球|紫陽花|あじさい|hydrangea/i, months: [5, 6, 7] },
  { name: /向日葵|ひまわり|sunflower/i, months: [7, 8] },
  { name: /荷花|蓮花|lotus/i, months: [6, 7, 8] },
  { name: /油菜花|菜の花/, months: [1, 2, 3] },
  { name: /金針花/, months: [8, 9] },
  { name: /波斯菊|コスモス|cosmos/i, months: [9, 10, 11, 12, 1] },
  { name: /楓|紅葉|もみじ|maple/i, months: [10, 11, 12] },
  { name: /梅園|梅花/, months: [1, 2, 3] },
  { name: /鬱金香|チューリップ|tulip/i, months: [2, 3, 4, 5] },
  { name: /杜鵑|つつじ|azalea/i, months: [3, 4, 5] },
  { name: /芒草|すすき/, months: [10, 11] },
  { name: /銀杏|ginkgo/i, months: [11, 12] },
  // Taiwan's flowering trees: after 木棉, 台南's November half day went to 花旗木步道.
  { name: /花旗木/, months: [4, 5] },
  { name: /阿勃勒/, months: [5, 6, 7] },
  { name: /藍花楹/, months: [4, 5] },
  { name: /風鈴木/, months: [3, 4] },
  { name: /苦楝/, months: [3, 4] },
  { name: /流蘇/, months: [3, 4] },
  { name: /鳳凰木|鳳凰花/, months: [5, 6, 7] },
  { name: /落羽松/, months: [12, 1] },
  { name: /海芋/, months: [2, 3, 4, 5] },
  { name: /桃花/, months: [2, 3] },
];

/** Whether a place's name says it's for a flower that isn't out in `month` (1-12). */
export function isBloomOutOfSeason(name: string, month: number): boolean {
  const bloom = BLOOMS.find((b) => b.name.test(name));
  return Boolean(bloom && !bloom.months.includes(month));
}

/** The month (1-12) of a 2026-11-10 date. */
export function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}
