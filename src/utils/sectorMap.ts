/**
 * Sector Mapping Utility for BIST Stocks
 */

export const SECTORS = [
  'Teknoloji',
  'Telekomünikasyon',
  'Bankacılık',
  'Finansal Hizmetler',
  'Sigortacılık',
  'Holdingler',
  'Yatırım Ortaklıkları',
  'Gıda ve İçecek',
  'Tarım ve Hayvancılık',
  'Perakende ve Ticaret',
  'Enerji',
  'Petrol ve Gaz',
  'Otomotiv',
  'Demir Çelik ve Metal',
  'Çimento ve Yapı Malzemeleri',
  'Gayrimenkul (GYO)',
  'İnşaat',
  'Kimya ve Plastik',
  'İlaç ve Sağlık',
  'Tekstil ve Deri',
  'Giyim ve Ayakkabı',
  'Kağıt ve Ambalaj',
  'Mobilya',
  'Ulaştırma ve Havacılık',
  'Lojistik ve Taşımacılık',
  'Turizm',
  'Madencilik',
  'Spor',
  'Diğer'
] as const;

export type SectorType = typeof SECTORS[number];

export function getStockSector(symbol: string, displayName: string): SectorType {
  const sym = symbol.toUpperCase().trim();
  const name = displayName.toUpperCase().trim();

  // 1. Spor Kulüpleri
  if (
    sym === 'BJKAS' || 
    sym === 'GSRAY' || 
    sym === 'FENER' || 
    sym === 'TSPOR' || 
    name.includes('KULÜBÜ') || 
    name.includes('KULUBU')
  ) {
    return 'Spor';
  }

  // 2. Gayrimenkul (GYO)
  if (
    sym.endsWith('GYO') || 
    sym.endsWith('GY') || 
    sym === 'FZLGY' || 
    name.includes('GAYRİMENKUL') || 
    name.includes('GAYRIMENKUL') || 
    name.includes('GYO')
  ) {
    return 'Gayrimenkul (GYO)';
  }

  // 3. Sigortacılık & Emeklilik
  if (
    sym.endsWith('GRT') || 
    name.includes('SİGORTA') || 
    name.includes('SIGORTA') || 
    name.includes('EMEKLİLİK') || 
    name.includes('EMEKLILIK') || 
    sym === 'AGESA' || 
    sym === 'ANSGR' || 
    sym === 'ANHYT'
  ) {
    return 'Sigortacılık';
  }

  // 4. Bankacılık
  if (
    name.includes('BANK') || 
    name.includes('BANCA') || 
    sym === 'GARAN' || 
    sym === 'AKBNK' || 
    sym === 'YKBNK' || 
    sym === 'ISCTR' || 
    sym === 'HALKB' || 
    sym === 'VAKBN' || 
    sym === 'ALBRK' || 
    sym === 'SKBNK' || 
    sym === 'TSKB'
  ) {
    return 'Bankacılık';
  }

  // 5. Holdingler
  if (
    sym.endsWith('HOL') || 
    name.includes('HOLDİNG') || 
    name.includes('HOLDING') || 
    sym === 'KCHOL' || 
    sym === 'SAHOL' || 
    sym === 'ALARK' || 
    sym === 'DOHOL' || 
    sym === 'AGHOL'
  ) {
    return 'Holdingler';
  }

  // 6. Yatırım Ortaklıkları (Menkul Kıymet Girişim)
  if (
    sym.endsWith('YO') || 
    name.includes('YATIRIM ORTAKLIGI') || 
    name.includes('YATIRIM ORTAKLIĞI') || 
    name.includes('PORTFÖY') || 
    name.includes('PORTFOY')
  ) {
    return 'Yatırım Ortaklıkları';
  }

  // 7. Finansal Hizmetler (Faktoring, Leasing, Aracı Kurumlar)
  if (
    name.includes('FAKTORİNG') || 
    name.includes('FAKTORING') || 
    name.includes('KİRALAMA') || 
    name.includes('KIRALAMA') || 
    name.includes('LEASING') || 
    name.includes('MENKUL DEĞERLER') || 
    name.includes('MENKUL DEGERLER') || 
    name.includes('FINANS') || 
    name.includes('FİNANS') || 
    sym === 'A1CAP'
  ) {
    return 'Finansal Hizmetler';
  }

  // 8. Petrol ve Gaz
  if (
    name.includes('PETROL') || 
    name.includes('GAZ') || 
    name.includes('RAFİNERİ') || 
    name.includes('RAFINERI') || 
    sym === 'TUPRS' || 
    sym === 'AYGAZ'
  ) {
    return 'Petrol ve Gaz';
  }

  // 9. Ulaştırma ve Havacılık
  if (
    name.includes('ULAŞTIRMA') || 
    name.includes('ULASTIRMA') || 
    name.includes('HAVA YOLLARI') || 
    name.includes('HAVA TASIMACILIGI') || 
    name.includes('HAVALİMAN') || 
    name.includes('HAVALIMAN') || 
    sym === 'THYAO' || 
    sym === 'PGSUS' || 
    sym === 'TAVHL'
  ) {
    return 'Ulaştırma ve Havacılık';
  }

  // 10. Lojistik ve Taşımacılık
  if (
    name.includes('LOJİSTİK') || 
    name.includes('LOJISTIK') || 
    name.includes('KARGO') || 
    name.includes('LİMAN') || 
    name.includes('LIMAN') || 
    name.includes('TAŞIMACILIK') || 
    name.includes('TASIMACILIK') || 
    sym === 'RYSAS' || 
    sym === 'HOROZ'
  ) {
    return 'Lojistik ve Taşımacılık';
  }

  // 11. Turizm
  if (
    name.includes('TURİZM') || 
    name.includes('TURIZM') || 
    name.includes('OTEL') || 
    name.includes('MARMARİS') || 
    name.includes('MARMARIS')
  ) {
    return 'Turizm';
  }

  // 12. Telekomünikasyon
  if (
    name.includes('TELEKOM') || 
    name.includes('İLETİŞİM') || 
    name.includes('ILETISIM') || 
    sym === 'TCELL' || 
    sym === 'TTKOM'
  ) {
    return 'Telekomünikasyon';
  }

  // 13. Teknoloji & Yazılım
  if (
    sym.endsWith('YZ') || 
    name.includes('TEKNOLOJİ') || 
    name.includes('TEKNOLOJI') || 
    name.includes('YAZILIM') || 
    name.includes('BİLİŞİM') || 
    name.includes('BILISIM') || 
    name.includes('SOFTWARE') || 
    name.includes(' DATA') || 
    name.includes('BİLGİSAYAR') || 
    name.includes('BILGISAYAR') || 
    name.includes('NETWORK') || 
    name.includes('SİBER') || 
    name.includes('SIBER') || 
    name.includes('SYSTEMS') || 
    sym === 'ARDYZ' || 
    sym === 'LOGO' || 
    sym === 'MIATK' || 
    sym === 'KFEIN' || 
    sym === 'REEDR'
  ) {
    return 'Teknoloji';
  }

  // 14. İlaç ve Sağlık
  if (
    name.includes('İLAÇ') || 
    name.includes('ILAC') || 
    name.includes('MEDİKAL') || 
    name.includes('MEDIKAL') || 
    name.includes('TIBBİ') || 
    name.includes('TIBBI') || 
    name.includes('SAĞLIK') || 
    name.includes('SAGLIK') || 
    name.includes('HASTANE') || 
    name.includes('KLİNİK') || 
    name.includes('KLINIK') || 
    sym === 'DEVA' || 
    sym === 'ECILC' || 
    sym === 'MPARK'
  ) {
    return 'İlaç ve Sağlık';
  }

  // 15. Kimya ve Plastik
  if (
    name.includes('KİMYA') || 
    name.includes('KIMYA') || 
    name.includes('BOYA') || 
    name.includes('PLASTİK') || 
    name.includes('PLASTIK') || 
    name.includes('POLİESTER') || 
    name.includes('POLIESTER') || 
    name.includes('GÜBRE') || 
    name.includes('GUBRE') || 
    sym === 'SASA' || 
    sym === 'KMPUR'
  ) {
    return 'Kimya ve Plastik';
  }

  // 16. Çimento ve Yapı Malzemeleri
  if (
    name.includes('ÇİMENTO') || 
    name.includes('CIMENTO') || 
    name.includes('BETON') || 
    name.includes('BOBET') || 
    name.includes('KİREMİT') || 
    name.includes('ALÇI') || 
    name.includes('ALCI')
  ) {
    return 'Çimento ve Yapı Malzemeleri';
  }

  // 17. İnşaat
  if (
    name.includes('İNŞAAT') || 
    name.includes('INSAAT') || 
    name.includes('SERAMİK') || 
    name.includes('SERAMIK') || 
    name.includes('TUĞLA') || 
    name.includes('YAPI')
  ) {
    return 'İnşaat';
  }

  // 18. Enerji
  if (
    sym.endsWith('ENR') || 
    sym.endsWith('YEN') || 
    name.includes('ENERJİ') || 
    name.includes('ENERJI') || 
    name.includes('ELEKTRİK') || 
    name.includes('ELEKTRIK') || 
    name.includes('GÜNEŞ') || 
    name.includes('GUNES') || 
    name.includes('SOLAR') || 
    name.includes('WIND') || 
    name.includes('RÜZGAR') || 
    name.includes('RUZGAR') || 
    name.includes('KOMÜR') || 
    name.includes('KÖMÜR') || 
    name.includes('TERMİK') || 
    name.includes('TERMIK') || 
    sym === 'AKSEN' || 
    sym === 'ZOREN' || 
    sym === 'ENJSA' || 
    sym === 'ALFAS' || 
    sym === 'CWENE' || 
    sym === 'GESAN'
  ) {
    return 'Enerji';
  }

  // 19. Otomotiv
  if (
    name.includes('OTOMOTİV') || 
    name.includes('OTOMOTIV') || 
    name.includes('TRAKTÖR') || 
    name.includes('TRAKTOR') || 
    sym === 'FROTO' || 
    sym === 'TOASO' || 
    sym === 'OTKAR' || 
    sym === 'KARSN' || 
    sym === 'TTRAK'
  ) {
    return 'Otomotiv';
  }

  // 20. Demir Çelik ve Metal
  if (
    name.includes('ÇELİK') || 
    name.includes('CELIK') || 
    name.includes('DEMİR') || 
    name.includes('DEMIR') || 
    name.includes('BAKIR') || 
    name.includes('METAL') || 
    name.includes('KABLO') || 
    name.includes('BORU') || 
    name.includes('ALÜMİNYUM') || 
    name.includes('ALUMINYUM') || 
    name.includes('DÖKÜM') || 
    name.includes('DOKUM') || 
    sym === 'EREGL' || 
    sym === 'ISDMR' || 
    sym === 'KRDMD' || 
    sym === 'CEMTS'
  ) {
    return 'Demir Çelik ve Metal';
  }

  // 21. Gıda ve İçecek
  if (
    name.includes('GIDA') || 
    name.includes('ŞEKER') || 
    name.includes('SEKER') || 
    name.includes('UN ') || 
    name.includes('TAVUK') || 
    name.includes(' ET ') || 
    name.includes('SÜT') || 
    name.includes('SUT') || 
    name.includes('BALIK') || 
    name.includes('ÇAY') || 
    name.includes('CAY') || 
    name.includes('RESTORAN') || 
    name.includes('SALÇA') || 
    name.includes('SALCA') || 
    name.includes('YAĞ') || 
    name.includes('YAG') || 
    name.includes('MEYVE') || 
    name.includes('İÇECEK') || 
    name.includes('ICECEK') || 
    name.includes('BİSKÜVİ') || 
    name.includes('BISKUVI') || 
    name.includes('MAKARNA') || 
    name.includes('ZEYTİN') || 
    name.includes('UNLU MAMUL') || 
    sym === 'AEFES' || 
    sym === 'CCOLA' || 
    sym === 'ULKER' || 
    sym === 'TABGD' || 
    sym === 'BYDNR' || 
    sym === 'MEYSU'
  ) {
    return 'Gıda ve İçecek';
  }

  // 22. Tarım ve Hayvancılık
  if (
    name.includes('TARIM') || 
    name.includes('YEM ') || 
    name.includes('BESİ') || 
    name.includes('BESI') || 
    name.includes('FİDAN') || 
    name.includes('FIDAN') || 
    name.includes('KÜTÜK') || 
    name.includes('KUTUK')
  ) {
    return 'Tarım ve Hayvancılık';
  }

  // 23. Giyim ve Ayakkabı
  if (
    name.includes('GİYİM') || 
    name.includes('GIYIM') || 
    name.includes('AYAKKABI') || 
    name.includes('AYAKKAB') || 
    sym === 'MAVI' || 
    sym === 'KOTON'
  ) {
    return 'Giyim ve Ayakkabı';
  }

  // 24. Tekstil ve Deri
  if (
    name.includes('TEKSTİL') || 
    name.includes('TEKSTIL') || 
    name.includes('HALI') || 
    name.includes('DERİ') || 
    name.includes('DERI') || 
    name.includes('IPLIK') || 
    name.includes('İPLİK') || 
    name.includes('DOKUMA') || 
    name.includes('MENSUCAT') || 
    name.includes('YÜNLÜ') || 
    name.includes('YUNLU') || 
    name.includes('KADİFE') || 
    name.includes('KADIFE') || 
    sym === 'YUNSA' || 
    sym === 'MNDRS' || 
    sym === 'SUWEN'
  ) {
    return 'Tekstil ve Deri';
  }

  // 25. Kağıt ve Ambalaj
  if (
    name.includes('AMBALAJ') || 
    name.includes('KAĞIT') || 
    name.includes('KAGIT') || 
    name.includes('KARTON') || 
    name.includes('BASIM') || 
    name.includes('SELÜLOZ') || 
    name.includes('SELULOZ') || 
    sym === 'KARTN' || 
    sym === 'ALKA'
  ) {
    return 'Kağıt ve Ambalaj';
  }

  // 26. Mobilya
  if (
    name.includes('MOBİLYA') || 
    name.includes('MOBILYA') || 
    name.includes('YONGA') || 
    sym === 'YATAS'
  ) {
    return 'Mobilya';
  }

  // 27. Madencilik
  if (
    name.includes('MADEN') || 
    name.includes('MADENCİLİK') || 
    name.includes('MADENCILIK') || 
    name.includes('ALTIN') || 
    name.includes('MERMER') || 
    sym === 'ALTIN' || 
    sym === 'ALTNY' || 
    sym === 'ZGOLD'
  ) {
    return 'Madencilik';
  }

  // 28. Perakende ve Ticaret
  if (
    name.includes('PERAKENDE') || 
    name.includes('MARKET') || 
    name.includes('MAĞAZA') || 
    name.includes('MAGAZA') || 
    name.includes('COMMERCE') || 
    name.includes('KAZANÇ') || 
    sym === 'MGROS' || 
    sym === 'SOKM' || 
    sym === 'BIMAS' || 
    sym === 'CRFSA'
  ) {
    return 'Perakende ve Ticaret';
  }

  // 29. Diğer Sanayi & Üretim
  if (
    name.includes('SANAYİ') || 
    name.includes('SANAYI') || 
    name.includes('MAKİNE') || 
    name.includes('MAKINE') || 
    name.includes('MAKİNA') || 
    name.includes('MAKINA') || 
    name.includes('ROBOT') || 
    name.includes('VİNÇ') || 
    name.includes('VINC') || 
    name.includes('SİLAH') || 
    name.includes('SILAH') || 
    name.includes('TİCARET') || 
    name.includes('TICARET')
  ) {
    return 'Diğer';
  }

  return 'Diğer';
}
