// Matching a place name against brand lists (hotel chains, coffee chains).
// Latin names match as whole words ("Aman" must not match "Yamanote");
// CJK and kana names have no word boundaries, so they match as substrings
// and must be specific enough on their own.

const isLatinLetter = (ch: string | undefined) => ch !== undefined && ch >= "a" && ch <= "z";

// Whole-word substring match, done by hand rather than by building a RegExp
// from the brand list, so no brand ever needs escaping.
function containsWord(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
    if (!isLatinLetter(text[i - 1]) && !isLatinLetter(text[i + word.length])) return true;
  }
  return false;
}

export type BrandNames = {
  /** Lowercase; matched as whole words. */
  latin: string[];
  /** Matched as substrings. */
  cjk: string[];
};

export function matchesBrand(name: string, brand: BrandNames): boolean {
  const lower = name.toLowerCase();
  return brand.latin.some((word) => containsWord(lower, word)) || brand.cjk.some((word) => lower.includes(word));
}
