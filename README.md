# Temist — BIST Gelişmiş Analiz ve İndikatör Paneli

Borsa İstanbul (BIST) hisse senetleri için özelleştirilmiş indikatörler, korelasyon analizleri ve kapsamlı finansal tablolar sunan profesyonel web tabanlı analiz aracı.

**Canlı Yayın:** [ozdoganosman.github.io/Temist](https://ozdoganosman.github.io/Temist/)

---

## 🚀 Özellikler & Özel İndikatörler

### 📊 Teknik Grafik & Özel İndikatör Setleri
- **Nizam-ı Cedid (3. Selim) İndikatörü:** 
  - Fiyat momentumu (`EMA 120` ve `EMA 260`) ile hacim ağırlıklı uzun vadeli ortalamanın (`VWMA 185`) entegrasyonu.
  - Alıcı ve satıcı yoğunluğunu ölçen **Delta Histogramı** ve `EMA 377 > EMA 610` mega trend filtresi.
- **MATLRNS:** Çok katmanlı trend rejimi ve hareketli ortalama fark alanları (boğa, ayı, nötr trend bantları).
- **Williams Paşa:** Kısa-orta vadeli momentum dönüşlerini ve aşırı alım/satım sınırlarını belirleyen gelişmiş `%R` ve `EMA %R` osilatörü.
- **Dinamik EMA Trend Bulutu (Amorfik Geçiş):** 
  - 10 farklı EMA periyodunun (`8, 13, 21, 34, 55, 89, 144, 233, 377, 610`) hizalanma gücünü ölçer.
  - Trend yönüne göre arka planda yumuşak, kesintisiz bir yeşilden kırmızıya geçiş efekti (Amorphous Gradient) oluşturur.

### 📈 Piyasa ve İstatistik Araçları
- **Pearson Korelasyon Matrisi:** Seçilen hisseler arasındaki korelasyonu gerçek zamanlı hesaplayan, genişletilmiş ve okunabilirliği artırılmış veri tablosu.
- **Çoklu Grafik Modu:** Aynı ekranda birden fazla hisseyi ve indikatör panellerini eş zamanlı izleme.
- **Backtest Modülü:** İndikatör sinyallerinin tarihsel veriler üzerindeki getiri performans analizleri (5, 10, 20, 60 günlük periyotlarda).

### 💼 Temel ve Finansal Analiz
- Şirketlerin F/K, PD/DD, FD/FAVÖK ve Özsermaye Karlılığı (ROE) oranları.
- Gelir Tablosu, Bilanço ve Nakit Akış tablolarının interaktif grafiklerle görselleştirilmesi.
- Kişiselleştirilmiş Takip Listesi ve lokal alarm yapılandırmaları.

---

## 🛠️ Veri Kaynakları

Bu proje, verilerini aşağıdaki açık kaynak kütüphaneler aracılığıyla günceller:

| Kaynak | Kullanım Alanı | Lisans |
|--------|----------------|--------|
| [borsapy](https://github.com/borsapy/borsapy) | Tarihsel OHLCV fiyat verileri | MIT |
| [isyatirimhisse](https://github.com/urazakgul/isyatirimhisse) | Finansal tablolar ve temel analiz verileri | MIT |

> **Önemli Not:** Veriler yatırım kararları için tek başına yeterli olmayıp, günlük olarak güncellenen gecikmeli statik verilerdir.

---

## 💻 Kullanılan Teknolojiler

- **Frontend:** React + TypeScript + Vite
- **Grafikler:** Apache ECharts (Performans optimizasyonlu, 60 FPS yakınlaştırma ve kaydırma)
- **Veri Depolama:** Statik JSON (Python ön-derleme betiğiyle otomatik oluşturulan veri havuzu)
- **CI/CD & Dağıtım:** GitHub Actions (Günlük veri güncelleme ve GitHub Pages dağıtım akışı)

---

## 🚀 Yerel Kurulum & Çalıştırma

Projeyi kendi yerel bilgisayarınızda çalıştırmak için:

```bash
# Depoyu klonlayın
git clone https://github.com/ozdoganosman/Temist.git
cd Temist

# Bağımlılıkları yükleyin
npm install
pip install -r requirements.txt

# Güncel piyasa verilerini çekin ve JSON dosyalarını oluşturun
python scripts/build_data.py

# Geliştirme sunucusunu başlatın
npm run dev
```

---

## ⚖️ Yasal Uyarı / Feragatname

**Bu sitede yer alan tüm analizler, grafikler ve indikatör sinyalleri yalnızca bilgilendirme amacı taşımaktadır. Kesinlikle yatırım tavsiyesi, al-sat önerisi veya yönlendirme niteliğinde değildir.**

- Sunulan veriler gecikmeli olup doğrulukları veya eksiksizliği garanti edilmez.
- Bu uygulamadaki verilere dayanarak alınan kararlardan doğabilecek doğrudan veya dolaylı zararlardan site sahipleri/geliştiricileri sorumlu tutulamaz.
- Yatırım yapmadan önce mutlaka SPK tarafından yetkilendirilmiş lisanslı yatırım danışmanlarına başvurun.

---

## 📄 Lisans

Bu proje [MIT](LICENSE) lisansı altındadır.

