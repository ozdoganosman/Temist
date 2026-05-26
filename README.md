# Temist — BIST & Kripto Gelişmiş Analiz ve İndikatör Paneli

Borsa İstanbul (BIST) ve Kripto para piyasaları için özelleştirilmiş indikatörler, korelasyon analizleri, makine öğrenimi tahminleri ve kapsamlı finansal tablolar sunan profesyonel, hibrit (statik/canlı) bir teknik analiz platformu.

**Canlı Yayın (Statik Mod):** [ozdoganosman.github.io/Temist](https://ozdoganosman.github.io/Temist/)

---

## 🚀 Özellikler & Özel İndikatörler

### 📊 Teknik Grafik & Gelişmiş İndikatörler
- **Nizam-ı Cedid (3. Selim) İndikatörü:** 
  - Fiyat momentumu (`EMA 120` ve `EMA 260`) ile hacim ağırlıklı uzun vadeli ortalamanın (`VWMA 185`) entegrasyonu.
  - Alıcı ve satıcı yoğunluğunu ölçen **Delta Histogramı** ve `EMA 377 > EMA 610` uzun vadeli trend filtresi.
- **MATLRNS:** Çok katmanlı trend rejimi ve hareketli ortalama fark alanları (boğa, ayı, nötr trend bantları).
- **Williams Paşa:** Kısa-orta vadeli momentum dönüşlerini ve aşırı alım/satım sınırlarını belirleyen gelişmiş `%R` ve `EMA %R` osilatörü.
- **Dinamik EMA Trend Bulutu (Amorfik Geçiş):** 
  - 10 farklı EMA periyodunun (`8, 13, 21, 34, 55, 89, 144, 233, 377, 610`) hizalanma gücünü ölçer.
  - Trend yönüne göre arka planda yumuşak, kesintisiz bir yeşilden kırmızıya geçiş efekti (Amorphous Gradient) oluşturur.
- **Kripto Para Desteği:** Binance Spot API entegrasyonu ile popüler kripto çiftleri için canlı WebSocket fiyat akışı ve indikatör grafikleri.

### 🧠 Makine Öğrenimi & Yapay Zeka (Yerel Modda Aktif)
- **ML Tahmin Modülü:** LightGBM, XGBoost ve Scikit-Learn modelleri ile hisse senedi fiyat yönü tahminlemesi.
- **Hiperparametre Optimizasyonu:** Optuna entegrasyonu ile en iyi model parametrelerinin otomatik tespiti.
- **Walk-Forward Analizi:** Modellerin geçmiş veriler üzerinde adım adım simüle edilmesiyle elde edilen başarı metrikleri (isabet oranı, F1 skoru).

### 📈 İstatistik & Portföy Araçları
- **Pearson Korelasyon Matrisi:** Seçilen hisseler arasındaki korelasyon derecelerini gerçek zamanlı hesaplayan, genişletilmiş ve okunabilirliği artırılmış veri tablosu.
- **Çoklu Grafik Modu:** Aynı ekranda birden fazla hisseyi ve indikatör panellerini eş zamanlı izleme.
- **Backtest Modülü:** İndikatör sinyallerinin tarihsel veriler üzerindeki getiri performans analizleri (5, 10, 20, 60 günlük periyotlarda).

### 💼 Temel ve Finansal Analiz
- Şirketlerin F/K, PD/DD, FD/FAVÖK ve Özsermaye Karlılığı (ROE) oranları.
- Gelir Tablosu, Bilanço ve Nakit Akış tablolarının interaktif grafiklerle görselleştirilmesi.
- Kişiselleştirilmiş Takip Listesi ve lokal tarayıcı tabanlı alarm sistemi.

---

## 🛠️ Mimari ve Çalışma Modları

Sistem iki farklı modda çalışabilir:

1. **Statik Mod (GitHub Pages):** 
   - Python derleme betiği (`build_data.py`) günlük olarak çalışır ve BIST verilerini statik JSON dosyalarına dönüştürür.
   - Sunucu bağımsızdır, hızlı yüklenir ve tamamen istemci tarafında (tarayıcıda) çalışır.
2. **Canlı/Yerel Mod (Local Backend):**
   - Yerel bilgisayarınızda FastAPI sunucusunu çalıştırdığınızda, frontend otomatik olarak yerel API'ye bağlanır.
   - Canlı intraday veri sorguları, dinamik taramalar, makine öğrenimi modellerinin eğitilmesi ve WebSocket üzerinden canlı fiyat akışları aktif hale gelir.

---

## 💻 Kullanılan Teknolojiler

### Frontend Stack
- **Framework:** React 18 + TypeScript + Vite
- **Grafikler:** Apache ECharts (Yüksek performanslı veri görselleştirme)
- **PWA (Progressive Web App):** Çevrimdışı destek için Service Worker önbelleklemesi
- **Uluslararasılaştırma:** i18next (Türkçe / İngilizce çoklu dil desteği)

### Backend & Veri Analizi Stack (Python)
- **API Sunucusu:** FastAPI + Uvicorn + WebSockets
- **Veri Analizi:** Pandas + NumPy
- **Makine Öğrenimi:** LightGBM + XGBoost + Scikit-Learn
- **Optimizasyon:** Optuna
- **Veri Sağlayıcılar:** `borsapy` (OHLCV fiyat verileri) & `isyatirimhisse` (Finansal tablolar)

---

## 🚀 Yerel Kurulum & Çalıştırma

Yerel ortamda hem arayüzü hem de canlı analiz sunucusunu çalıştırmak için:

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/ozdoganosman/Temist.git
cd Temist
```

### 2. Canlı Analiz Sunucusunu (Backend) Başlatın
```bash
# Backend dizinine geçin ve kütüphaneleri yükleyin
cd backend
pip install -r requirements.txt

# (İsteğe bağlı) .env dosyasını yapılandırın
cp .env.example .env

# Sunucuyu başlatın (varsayılan port: 8001)
python main.py
```

### 3. Arayüzü (Frontend) Başlatın
Ayrı bir terminal penceresinde projenin ana dizinine dönün:
```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın
npm run dev
```

### 4. Statik Verileri Derleme (Opsiyonel)
GitHub Pages'e yüklenmek üzere tüm verileri önceden çekip statik JSON üretmek isterseniz:
```bash
python scripts/build_data.py
```

---

## ⚖️ Yasal Uyarı / Feragatname

**Bu sitede yer alan tüm analizler, grafikler, yapay zeka tahminleri ve indikatör sinyalleri yalnızca eğitim ve kişisel araştırma amaçlıdır. Kesinlikle yatırım tavsiyesi, al-sat önerisi veya yönlendirme niteliğinde değildir.**

- Sunulan veriler gecikmeli olup doğrulukları veya eksiksizliği garanti edilmez.
- Bu uygulamadaki verilere veya tahminlere dayanarak alınan kararlardan doğabilecek doğrudan/dolaylı zararlardan site sahipleri veya geliştiricileri sorumlu tutulamaz.
- Yatırım yapmadan önce mutlaka SPK tarafından yetkilendirilmiş lisanslı yatırım danışmanlarına başvurun.

---

## 📄 Lisans

Bu proje [MIT](LICENSE) lisansı altındadır.

