// 國家 / 地區名稱對照表，鍵值與 iataCity.ts 的 IATA_CITY_ZH 一致。
// 讓城市搜尋框可以用國家名稱找到城市（例：打「尼泊爾」找到「加德滿都」），
// 不用先知道目的地由哪個機場服務。
export const IATA_COUNTRY_ZH: Record<string, string> = {
  // 東北亞
  NRT: "日本", HND: "日本", KIX: "日本", NGO: "日本", CTS: "日本", FUK: "日本", OKA: "日本",
  ICN: "韓國", GMP: "韓國", PUS: "韓國",
  PEK: "中國", PKX: "中國", PVG: "中國", SHA: "中國", CAN: "中國",
  HKG: "香港",
  // 東南亞
  SIN: "新加坡",
  KUL: "馬來西亞",
  BKK: "泰國", DMK: "泰國", HKT: "泰國", CNX: "泰國",
  SGN: "越南", HAN: "越南", DAD: "越南",
  DPS: "印尼", CGK: "印尼",
  REP: "柬埔寨", PNH: "柬埔寨",
  // 大洋洲
  SYD: "澳洲", MEL: "澳洲", BNE: "澳洲", PER: "澳洲",
  AKL: "紐西蘭",
  // 歐洲
  LHR: "英國", LGW: "英國", MAN: "英國", EDI: "英國",
  CDG: "法國", ORY: "法國", LYS: "法國", NCE: "法國",
  AMS: "荷蘭",
  FRA: "德國", MUC: "德國", BER: "德國", HAM: "德國",
  VIE: "奧地利",
  FCO: "義大利", MXP: "義大利", VCE: "義大利", NAP: "義大利",
  BCN: "西班牙", MAD: "西班牙",
  LIS: "葡萄牙",
  ATH: "希臘",
  HEL: "芬蘭",
  CPH: "丹麥",
  ARN: "瑞典",
  OSL: "挪威",
  PRG: "捷克",
  BUD: "匈牙利",
  WAW: "波蘭", KRK: "波蘭",
  ZRH: "瑞士", GVA: "瑞士",
  IST: "土耳其",
  BTS: "斯洛伐克",
  LJU: "斯洛維尼亞",
  ZAG: "克羅埃西亞", DBV: "克羅埃西亞",
  SJJ: "波士尼亞",
  BEG: "塞爾維亞",
  SOF: "保加利亞",
  OTP: "羅馬尼亞",
  BRU: "比利時",
  DUB: "愛爾蘭",
  // 中東
  DXB: "阿聯", AUH: "阿聯",
  DOH: "卡達",
  // 南亞
  KTM: "尼泊爾", PKR: "尼泊爾",
  DEL: "印度", BOM: "印度",
  CMB: "斯里蘭卡",
  // 北美
  JFK: "美國", LAX: "美國", SFO: "美國", ORD: "美國", MIA: "美國", SEA: "美國",
  YYZ: "加拿大", YVR: "加拿大",
  // 台灣
  TPE: "台灣", KHH: "台灣", RMQ: "台灣",
  // 非洲
  CAI: "埃及",
  CMN: "摩洛哥",
  JNB: "南非", CPT: "南非",
};
