# WebGIS Monitoring Kesehatan Vegetasi Kabupaten Grobogan

Prototipe WebGIS untuk memantau kesehatan vegetasi di **19 kecamatan Kabupaten Grobogan** menggunakan **NDVI Sentinel-2** dan penilaian multi-kriteria **Simple Additive Weighting (SAW)**.

Proyek ini adalah implementasi dari karya ilmiah yang telah terbit di Jurnal Infotekmesin (lihat bagian [Sitasi](#sitasi)).

**Demo online:** [ISI_LINK_GITHUB_PAGES_DI_SINI]

<!-- Tambahkan 2-3 tangkapan layar di folder docs/ lalu tampilkan di sini, contoh: -->
<!-- ![Tampilan dual-map](docs/dual-map.png) -->

## Fitur

- **Dual-map tersinkronisasi:** peta kiri menampilkan NDVI aktual per periode, peta kanan menampilkan perubahan NDVI dibanding periode sebelumnya.
- **Deteksi anomali penurunan NDVI** (ΔNDVI ≤ -0,05) per kecamatan.
- **Penilaian SAW** dengan kriteria NDVI, curah hujan, kelembapan udara, dan suhu, dikategorikan Aman / Waspada / Kritis.
- **Popup dan panel ringkasan** per kecamatan (nilai NDVI, data cuaca, skor SAW, tren perubahan).
- **Pemilihan periode** tanpa memuat ulang halaman.

## Teknologi

- HTML, CSS, JavaScript (arsitektur modular: `app.js`, `map.js`, `saw.js`, `scoring.js`, `anomaly.js`)
- [Leaflet.js](https://leafletjs.com/) 1.9.4
- Python (pengolahan citra, skrip di folder `scripts/`)
- Data: GeoJSON dan JSON statis, dibaca di sisi klien dengan Fetch API

## Data dan sumber

- **Citra satelit:** Sentinel-2 Level-2A (kanal B04 dan B08, resolusi 10 m), empat tanggal: 14 September, 19 September, 24 September, dan 9 Oktober 2025. Sumber: Copernicus.
- **Batas wilayah:** 19 kecamatan Kabupaten Grobogan (GeoJSON).
- **Data cuaca:** suhu, kelembapan, dan curah hujan harian, sudah disimpan di dalam berkas `data/metrics_*.json`. Aplikasi tidak memanggil API eksternal untuk data cuaca.
- **Peta dasar:** © OpenStreetMap contributors.

## Metode singkat

1. NDVI = (NIR − Red) / (NIR + Red) dari kanal B08 dan B04.
2. Rata-rata NDVI per kecamatan diperoleh dengan zonal statistics.
3. Klasifikasi status NDVI: Tinggi (≥ 0,50), Sedang (0,30 sampai < 0,50), Rendah (< 0,30).
4. Skor SAW dihitung dengan bobot NDVI 0,50, curah hujan 0,20, kelembapan 0,20, dan suhu 0,10 (kriteria cost).
5. Anomali penurunan: ΔNDVI ≤ -0,05 antar periode.

## Struktur folder

```
webgis_final/
├── index.html
├── asset/
│   ├── css/style.css
│   └── js/ (app.js, map.js, saw.js, scoring.js, anomaly.js)
├── data/ (kecamatan.geojson, periods.json, metrics_*.json)
├── output_ndvi/ (overlay PNG dan bounds per tanggal)
└── scripts/ (pengolahan citra dengan Python)
```

## Menjalankan secara lokal

Karena aplikasi membaca berkas JSON dengan Fetch API, jalankan lewat server lokal (bukan klik dua kali pada `index.html`):

```bash
python -m http.server 8000
```

Lalu buka `http://localhost:8000`.

## Keterbatasan

- Prototipe statis, belum terintegrasi dengan data real-time.
- Data cuaca bersifat seragam per tanggal untuk seluruh kecamatan, sehingga variasi skor SAW antar kecamatan ditentukan oleh NDVI.
- Hanya empat tanggal pengamatan (September sampai Oktober 2025).
- Belum ada validasi lapangan.

## Sitasi

Jika Anda merujuk penelitian ini, silakan kutip artikel jurnalnya:

> Saputra, A. Y. A., Winarsih, N. A. S., Rohman, M. S., & Ratmana, D. O. (2026). Analisis Kesehatan Vegetasi Multi-Temporal Berbasis WebGIS Menggunakan NDVI Sentinel-2 dan Penilaian Multi-Kriteria SAW. *Infotekmesin*, 17(2), 302-311. https://doi.org/10.35970/infotekmesin.v17i2.3342

```bibtex
@article{saputra2026webgis,
  author  = {Saputra, Akner Yosha Ade and Winarsih, Nurul Anisa Sri and Rohman, Muhammad Syaifur and Ratmana, Danny Oka},
  title   = {Analisis Kesehatan Vegetasi Multi-Temporal Berbasis WebGIS Menggunakan NDVI Sentinel-2 dan Penilaian Multi-Kriteria SAW},
  journal = {Infotekmesin},
  volume  = {17},
  number  = {2},
  pages   = {302--311},
  year    = {2026},
  doi     = {10.35970/infotekmesin.v17i2.3342}
}
```

## Lisensi

Hak cipta © 2026 Akner Yosha Ade Saputra. **Seluruh hak dilindungi (all rights reserved).** Kode dipublikasikan untuk dilihat dan dievaluasi. Penggunaan ulang memerlukan izin tertulis. Lihat berkas [LICENSE](LICENSE).

Komponen pihak ketiga (Leaflet, OpenStreetMap, data Copernicus Sentinel) tetap mengikuti lisensi dan ketentuan masing-masing.

## Kontak

Akner Yosha Ade Saputra: akneryosha0@gmail.com | [LinkedIn](https://www.linkedin.com/in/akner-yosha-ade-saputra-a8a64b38a/)
