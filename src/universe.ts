// Tracked universe for TR Equity Monitor: BIST 100 + liquid Borsa Istanbul names.
// code = Borsa Istanbul stock code (Yahoo symbol is `${code}.IS`). Names are refreshed from Yahoo;
// the comments here are hints for readability only.
export interface UniverseEntry {
  code: string;
  sector: Sector;
  kind?: "equity" | "index";
  name?: string;
}

export type Sector =
  | "Banking" | "Insurance" | "Financials" | "Industrial" | "Auto" | "Consumer" | "Staples" | "Tech" | "Telecom" | "Healthcare" | "Property" | "Utilities" | "Energy" | "Materials" | "Index";

export const INDEX_SYMBOL = "XU100.IS";
export const INDEX_CODE = "BIST100";
export const EXCHANGE_SUFFIX = ".IS";

export const UNIVERSE: UniverseEntry[] = [
  { code: "BIST100", sector: "Index", kind: "index", name: "BIST 100" },
  // Banking
  { code: "AKBNK", sector: "Banking" }, // Akbank T.A.S.
  { code: "GARAN", sector: "Banking" }, // Turkiye Garanti Bankasi A.S.
  { code: "ISCTR", sector: "Banking" }, // Türkiye Is Bankasi A.S.
  { code: "YKBNK", sector: "Banking" }, // Yapi ve Kredi Bankasi A.S.
  { code: "HALKB", sector: "Banking" }, // Türkiye Halk Bankasi A.S.
  { code: "VAKBN", sector: "Banking" }, // Türkiye Vakiflar Bankasi Türk Anonim Ortakligi
  { code: "TSKB", sector: "Banking" }, // Türkiye Sinai Kalkinma Bankasi A.S.
  { code: "ALBRK", sector: "Banking" }, // Albaraka Türk Katilim Bankasi A.S.
  // Insurance
  { code: "AKGRT", sector: "Insurance" }, // Aksigorta A.S.
  { code: "ANSGR", sector: "Insurance" }, // Anadolu Anonim Türk Sigorta Sirketi
  { code: "TURSG", sector: "Insurance" }, // Türkiye Sigorta A.S.
  { code: "ANHYT", sector: "Insurance" }, // Anadolu Hayat Emeklilik Anonim Sirketi
  // Financials
  { code: "ISMEN", sector: "Financials" }, // Is Yatirim Menkul Degerler Anonim Sirketi
  { code: "GLYHO", sector: "Financials" }, // Global Yatirim Holding A.S.
  // Industrial
  { code: "THYAO", sector: "Industrial" }, // Türk Hava Yollari Anonim Ortakligi
  { code: "PGSUS", sector: "Industrial" }, // Pegasus Hava Tasimaciligi Anonim Sirketi
  { code: "TAVHL", sector: "Industrial" }, // TAV Havalimanlari Holding A.S.
  { code: "ASELS", sector: "Industrial" }, // ASELSAN Elektronik Sanayi ve Ticaret Anonim Sirketi
  { code: "ALARK", sector: "Industrial" }, // Alarko Holding A.S.
  { code: "ASTOR", sector: "Industrial" }, // Astor Enerji A.S.
  { code: "EUPWR", sector: "Industrial" }, // Europower Enerji ve Otomasyon Teknolojileri Sanayi Ticaret Anonim Sirketi
  { code: "GESAN", sector: "Industrial" }, // Girisim Elektrik Sanayi Taahhüt ve Ticaret A.S.
  { code: "SMRTG", sector: "Industrial" }, // Smart Günes Enerjisi Teknolojileri Arastirma ve Gelistirme Üretim Sanayi ve Ticaret A.S.
  { code: "TKFEN", sector: "Industrial" }, // Tekfen Holding Anonim Sirketi
  { code: "DOHOL", sector: "Industrial" }, // Dogan Sirketler Grubu Holding A.S.
  { code: "KCHOL", sector: "Industrial" }, // Koç Holding A.S.
  { code: "SAHOL", sector: "Industrial" }, // Haci Ömer Sabanci Holding A.S.
  { code: "AGHOL", sector: "Industrial" }, // AG Anadolu Grubu Holding A.S.
  { code: "TRGYO", sector: "Industrial" }, // Torunlar Gayrimenkul Yatirim Ortakligi A.S.
  // Auto
  { code: "FROTO", sector: "Auto" }, // Ford Otomotiv Sanayi A.S.
  { code: "TOASO", sector: "Auto" }, // Tofas Türk Otomobil Fabrikasi Anonim Sirketi
  { code: "TTRAK", sector: "Auto" }, // Türk Traktör ve Ziraat Makineleri A.S.
  { code: "OTKAR", sector: "Auto" }, // Otokar Otomotiv ve Savunma Sanayi A.S.
  { code: "DOAS", sector: "Auto" }, // Dogus Otomotiv Servis ve Ticaret A.S.
  // Consumer
  { code: "MAVI", sector: "Consumer" }, // Mavi Giyim Sanayi ve Ticaret A.S.
  { code: "VESTL", sector: "Consumer" }, // Vestel Elektronik Sanayi ve Ticaret Anonim Sirketi
  { code: "ARCLK", sector: "Consumer" }, // Arçelik Anonim Sirketi
  // Staples
  { code: "BIMAS", sector: "Staples" }, // BIM Birlesik Magazalar A.S.
  { code: "MGROS", sector: "Staples" }, // Migros Ticaret A.S.
  { code: "SOKM", sector: "Staples" }, // Sok Marketler Ticaret A.S.
  { code: "ULKER", sector: "Staples" }, // Ülker Bisküvi Sanayi A.S.
  { code: "CCOLA", sector: "Staples" }, // Coca-Cola Içecek Anonim Sirketi
  { code: "AEFES", sector: "Staples" }, // Anadolu Efes Biracilik ve Malt Sanayii Anonim Sirketi
  // Tech
  { code: "LOGO", sector: "Tech" }, // Logo Yazilim Sanayi ve Ticaret A.S.
  { code: "MIATK", sector: "Tech" }, // MIA Teknoloji Anonim Sirketi
  // Telecom
  { code: "TCELL", sector: "Telecom" }, // Turkcell Iletisim Hizmetleri A.S.
  { code: "TTKOM", sector: "Telecom" }, // Türk Telekomünikasyon Anonim Sirketi
  // Healthcare
  { code: "MPARK", sector: "Healthcare" }, // MLP Saglik Hizmetleri A.S.
  // Property
  { code: "EKGYO", sector: "Property" }, // Emlak Konut Gayrimenkul Yatirim Ortakligi A.S.
  // Utilities
  { code: "ENKAI", sector: "Utilities" }, // Enka Insaat ve Sanayi A.S.
  // Energy
  { code: "TUPRS", sector: "Energy" }, // Türkiye Petrol Rafinerileri A.S.
  { code: "AKSEN", sector: "Energy" }, // Aksa Enerji Üretim A.S.
  { code: "ENJSA", sector: "Energy" }, // Enerjisa Enerji A.S.
  { code: "ODAS", sector: "Energy" }, // Odas Elektrik Üretim Sanayi Ticaret A.S.
  { code: "ZOREN", sector: "Energy" }, // Zorlu Enerji Elektrik Üretim A.S.
  // Materials
  { code: "EREGL", sector: "Materials" }, // Eregli Demir ve Çelik Fabrikalari T.A.S.
  { code: "KRDMD", sector: "Materials" }, // Kardemir Karabük Demir Çelik Sanayi Ve Ticaret A.S.
  { code: "SISE", sector: "Materials" }, // Türkiye Sise Ve Cam Fabrikalari A.S.
  { code: "PETKM", sector: "Materials" }, // Petkim Petrokimya Holding Anonim Sirketi
  { code: "SASA", sector: "Materials" }, // Sasa Polyester Sanayi A.S.
  { code: "GUBRF", sector: "Materials" }, // Gübre Fabrikalari Türk Anonim Sirketi
  { code: "CIMSA", sector: "Materials" }, // Çimsa Çimento Sanayi ve Ticaret A.S.
  { code: "OYAKC", sector: "Materials" }, // OYAK Çimento Fabrikalari A.S.
  { code: "BRSAN", sector: "Materials" }, // Borusan Birlesik Boru Fabrikalari Sanayi ve Ticaret A.S.
];

export function symbolFor(entry: UniverseEntry): string {
  return entry.kind === "index" ? INDEX_SYMBOL : `${entry.code}${EXCHANGE_SUFFIX}`;
}

// Japanese sector labels (same table the UI uses); consumed by sectorLabel() in market.ts
export const SECTOR_JA: Record<string, string> = { Banking: "銀行", Insurance: "保険", Financials: "金融・証券", Industrial: "航空・防衛・持株・建設", Auto: "自動車", Consumer: "消費・家電", Staples: "食品・小売", Tech: "IT・通信機器", Telecom: "通信", Healthcare: "ヘルスケア", Property: "不動産", Utilities: "電力", Energy: "エネルギー・石油", Materials: "鉄鋼・化学・セメント", Index: "指数" };
