# Temist — BIST Gelişmiş Teknik ve Temel Analiz Paneli

Borsa İstanbul (BIST) hisse senetleri için özelleştirilmiş teknik indikatörler, korelasyon analizleri ve kapsamlı finansal tablolar sunan profesyonel bir analiz platformu.

**Canlı Yayın:** [ozdoganosman.github.io/Temist](https://ozdoganosman.github.io/Temist/)

---

## 🚀 Öne Çıkan Özellikler & Özel İndikatörler

### 📊 Teknik Grafik & Gelişmiş İndikatörler
- **Nizam-ı Cedid (3. Selim) İndikatörü:** 
  - Fiyat momentumu (`EMA 120` ve `EMA 260`) ile hacim ağırlıklı uzun vadeli ortalamanın (`VWMA 185`) entegrasyonu.
  - Alıcı ve satıcı yoğunluğunu ölçen **Delta Histogramı** ve `EMA 377 > EMA 610` uzun vadeli trend filtresi.
- **MATLRNS:** Çok katmanlı trend rejimi ve hareketli ortalama fark alanları (boğa, ayı, nötr trend bantları).
- **Williams Paşa:** Kısa-orta vadeli momentum dönüşlerini ve aşırı alım/satım sınırlarını belirleyen gelişmiş `%R` ve `EMA %R` osilatörü.
- **Dinamik EMA Trend Bulutu (Amorfik Geçiş):** 
  - 10 farklı EMA periyodunun (`8, 13, 21, 34, 55, 89, 144, 233, 377, 610`) hizalanma gücünü ölçer.
  - Trend yönüne göre arka planda yumuşak, kesintisiz bir yeşilden kırmızıya geçiş efekti (Amorphous Gradient) oluşturur.
- **Pearson Kanalları (3ChanPers):** Pearson korelasyon tabanlı dinamik kanal desteği.

### 📈 İstatistik & Portföy Araçları
- **Pearson Korelasyon Matrisi:** Seçilen hisseler arasındaki korelasyon derecelerini gerçek zamanlı hesaplayan, genişletilmiş ve okunabilirliği artırılmış veri tablosu.
- **Takip Listesi:** Hızlı erişim için kişiselleştirilmiş hisse takip listesi.
- **Alarm Sistemi:** Lokal tarayıcı tabanlı dinamik fiyat alarm sistemi.

### 💼 Temel ve Finansal Analiz
- Şirketlerin F/K, PD/DD, FD/FAVÖK ve Özsermaye Karlılığı (ROE) oranları.
- Gelir Tablosu, Bilanço ve Nakit Akış tablolarının interaktif grafiklerle görselleştirilmesi (Grafik altında ve ayrı Finansal Analiz sayfasında).

---

## 🛠️ Mimari ve Veri Akışı

Uygulama tamamen statik dosya tabanlı (client-side) çalışacak şekilde tasarlanmıştır:
- Python derleme betiği (`build_data.py`) günlük olarak çalışır ve BIST verilerini statik JSON dosyalarına dönüştürür.
- Sunucu bağımsızdır, hızlı yüklenir ve tamamen istemci tarafında (tarayıcıda) çalışır.

---

## 💻 Kullanılan Teknolojiler

- **Frontend:** React 18 + TypeScript + Vite
- **Grafikler:** Apache ECharts (Yüksek performanslı veri görselleştirme)
- **PWA (Progressive Web App):** Çevrimdışı destek için Service Worker önbelleklemesi
- **Uluslararasılaştırma:** i18next (Türkçe / İngilizce çoklu dil desteği)
- **Veri Sağlayıcılar:** `borsapy` (OHLCV fiyat verileri) & `isyatirimhisse` (Finansal tablolar)

---

## 🚀 Yerel Kurulum & Çalıştırma

Projeyi yerel bilgisayarınızda çalıştırmak için:

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/ozdoganosman/Temist.git
cd Temist
```

### 2. Arayüzü (Frontend) Başlatın
```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın
npm run dev
```

### 3. Statik Verileri Derleme (Opsiyonel)
Yerelde güncel piyasa verilerini çekip statik JSON dosyalarını üretmek isterseniz:
```bash
# Python kütüphanelerini yükleyin
cd backend
pip install -r requirements.txt

# Ana dizine dönün ve veri betiğini çalıştırın
cd ..
python scripts/build_data.py
```

---

## ⚖️ Yasal Uyarı / Feragatname

**Bu sitede yer alan tüm analizler, grafikler ve indikatör sinyalleri yalnızca eğitim ve kişisel araştırma amaçlıdır. Kesinlikle yatırım tavsiyesi, al-sat önerisi veya yönlendirme niteliğinde değildir.**

- Sunulan veriler gecikmeli olup doğrulukları veya eksiksizliği garanti edilmez.
- Bu uygulamadaki verilere dayanarak alınan kararlardan doğabilecek doğrudan/dolaylı zararlardan site sahipleri veya geliştiricileri sorumlu tutulamaz.
- Yatırım yapmadan önce mutlaka SPK tarafından yetkilendirilmiş lisanslı yatırım danışmanlarına başvurun.

---

## 📄 Lisans

Bu proje [MIT](LICENSE) lisansı altındadır.

