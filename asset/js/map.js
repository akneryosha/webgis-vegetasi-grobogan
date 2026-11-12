(function () {
  const MapState = {
    currentMap: null,
    changeMap: null,

    currentVectorLayer: null,
    changeVectorLayer: null,

    currentMetricLookup: new Map(),
    changeMetricLookup: new Map(),

    currentFeatureLayers: new Map(),
    changeFeatureLayers: new Map(),

    selectedFeatureKey: null,
    initialBoundsFitted: false,
    syncing: false,

    // NDVI raster overlay (peta kiri)
    ndviOverlayLayer: null,
    ndviOverlayVisible: true,
    ndviCurrentDate: null,

    // Polygon visibility (peta kiri)
    polygonVisible: true,
  };

  function getDetailElement() {
    return document.getElementById('detailContent');
  }

  function normalizeKey(value) {
    return String(value ?? '').trim().toUpperCase();
  }

  function formatDateID(dateString) {
    if (!dateString) return '-';
    const date = new Date(`${dateString}T00:00:00`);
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  function formatNumber(value, digits = 2, suffix = '') {
    if (value === null || value === undefined || value === '') return '-';
    const num = Number(value);
    if (Number.isNaN(num)) return '-';
    return `${num.toFixed(digits)}${suffix}`;
  }

  function formatSignedPercent(value) {
    if (value === null || value === undefined || value === '') return '-';
    const num = Number(value);
    if (Number.isNaN(num)) return '-';
    if (num > 0) return `+${num.toFixed(2)}%`;
    return `${num.toFixed(2)}%`;
  }

  function getFeatureId(feature) {
    const props = feature?.properties || {};
    const candidates = [
      props.id,
      props.ID,
      props.kode,
      props.KODE,
      props.kode_kecamatan,
      props.KODE_KEC,
      props.kd_kec,
      props.KD_KEC,
      props.code,
      props.CODE,
    ];

    for (const value of candidates) {
      if (value !== undefined && value !== null && value !== '') {
        return String(value);
      }
    }

    return '';
  }

  function getFeatureName(feature) {
    const props = feature?.properties || {};
    const candidates = [
      props.kecamatan,
      props.KECAMATAN,
      props.nama,
      props.NAMA,
      props.name,
      props.NAME,
      props.wadmkc,
      props.WADMKC,
      props.namobj,
      props.NAMOBJ,
    ];

    for (const value of candidates) {
      if (value !== undefined && value !== null && value !== '') {
        return String(value);
      }
    }

    return 'Wilayah';
  }

  function getFeatureKey(feature) {
    const id = normalizeKey(getFeatureId(feature));
    if (id) return id;
    return normalizeKey(getFeatureName(feature));
  }

  function buildMetricLookup(metrics) {
    const lookup = new Map();

    (metrics || []).forEach((metric) => {
      [metric.id, metric.kode, metric.kode_kecamatan, metric.kecamatan].forEach((key) => {
        const normalized = normalizeKey(key);
        if (normalized) {
          lookup.set(normalized, metric);
        }
      });
    });

    return lookup;
  }

  function getMetricForFeature(feature, mode) {
    const featureId = normalizeKey(getFeatureId(feature));
    const featureName = normalizeKey(getFeatureName(feature));

    const lookup =
      mode === 'current' ? MapState.currentMetricLookup : MapState.changeMetricLookup;

    if (featureId && lookup.has(featureId)) {
      return lookup.get(featureId);
    }

    if (featureName && lookup.has(featureName)) {
      return lookup.get(featureName);
    }

    return null;
  }

  function getConditionFillColor(metric) {
    if (!metric) return '#b0bec5';
    const status = metric.status || window.ScoringUtils.classifyNdviStatus(metric.ndvi_mean);
    return window.ScoringUtils.getStatusColor(status);
  }

  function getChangeFillColor(metric) {
    if (!metric) return '#90a4ae';

    if (metric.ndvi_delta === null || metric.ndvi_delta === undefined) {
      return '#90a4ae';
    }

    if (metric.is_anomaly) return '#8e0000';

    const label = String(metric.change_label || '').toLowerCase();

    if (label === 'meningkat') return '#2e7d32';
    if (label === 'stabil') return '#f9a825';
    if (label === 'menurun') return '#d84315';

    return '#90a4ae';
  }

  function buildStyle(feature, mode, selected = false) {
    const metric = getMetricForFeature(feature, mode);
    const fillColor = mode === 'current'
      ? getConditionFillColor(metric)
      : getChangeFillColor(metric);

    return {
      color: selected ? '#111827' : '#455a64',
      weight: selected ? 3 : 1.2,
      opacity: 1,
      fillColor,
      fillOpacity: selected ? 0.82 : 0.64,
    };
  }

  function formatWeather(metric) {
    return {
      temperature:
        metric?.temperature !== undefined && metric?.temperature !== null
          ? `${Number(metric.temperature).toFixed(2)} °C`
          : '-',
      humidity:
        metric?.humidity !== undefined && metric?.humidity !== null
          ? `${Number(metric.humidity).toFixed(2)} %`
          : '-',
      rainfall:
        metric?.rainfall !== undefined && metric?.rainfall !== null
          ? `${Number(metric.rainfall).toFixed(2)} mm`
          : '-',
      windspeed:
        metric?.windspeed_kmh !== undefined && metric?.windspeed_kmh !== null
          ? `${Number(metric.windspeed_kmh).toFixed(2)} km/jam`
          : '-',
    };
  }

  function getPreviousStatus(metric) {
    if (
      metric?.previous_ndvi_mean === null ||
      metric?.previous_ndvi_mean === undefined ||
      metric?.previous_ndvi_mean === ''
    ) {
      return 'Tidak Ada Data Pembanding';
    }

    return window.ScoringUtils.classifyNdviStatus(metric.previous_ndvi_mean);
  }

  function getDeltaPercent(metric) {
    if (
      metric?.previous_ndvi_mean === null ||
      metric?.previous_ndvi_mean === undefined ||
      metric?.previous_ndvi_mean === ''
    ) {
      return null;
    }

    const prev = Number(metric.previous_ndvi_mean);
    const curr = Number(metric.ndvi_mean);

    if (Number.isNaN(prev) || Number.isNaN(curr) || prev === 0) {
      return null;
    }

    return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(2));
  }

  function getChangeSeverity(metric) {
    if (metric?.ndvi_delta === null || metric?.ndvi_delta === undefined) {
      return 'Belum Ada Pembanding';
    }

    const delta = Number(metric.ndvi_delta);
    if (Number.isNaN(delta)) return 'Belum Ada Pembanding';

    if (delta >= 0.05) return 'Kenaikan Kuat';
    if (delta > 0.01) return 'Kenaikan Ringan';
    if (delta >= -0.01) return 'Relatif Stabil';
    if (delta > -0.05) return 'Penurunan Ringan';
    return 'Penurunan Tajam';
  }

  function getChangeSeverityClass(metric) {
    const severity = String(getChangeSeverity(metric)).toLowerCase();

    if (severity.includes('kenaikan')) return 'badge badge-meningkat';
    if (severity.includes('stabil')) return 'badge badge-stabil';
    if (severity.includes('penurunan ringan')) return 'badge badge-menurun';
    if (severity.includes('penurunan tajam')) return 'badge badge-anomali';
    return 'badge badge-netral';
  }

  function getSawStatusClass(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'aman') return 'badge badge-baik';
    if (value === 'waspada') return 'badge badge-sedang';
    if (value === 'kritis') return 'badge badge-buruk';
    return 'badge badge-netral';
  }

  function getChangeInterpretation(metric) {
    if (!metric) return 'Data perubahan belum tersedia.';

    if (metric.ndvi_delta === null || metric.ndvi_delta === undefined) {
      return 'Periode ini adalah data awal sehingga belum ada tanggal pembanding.';
    }

    const currentStatus = metric.status || window.ScoringUtils.classifyNdviStatus(metric.ndvi_mean);
    const previousStatus = getPreviousStatus(metric);

    if (metric.is_anomaly) {
      return `Terjadi penurunan NDVI yang cukup tajam dibanding periode sebelumnya. Walaupun kondisi saat ini berada pada kategori ${currentStatus.toLowerCase()}, arah perubahannya menunjukkan pelemahan vegetasi yang perlu diperhatikan lebih lanjut.`;
    }

    if (metric.change_label === 'Meningkat') {
      return `Nilai NDVI mengalami kenaikan dari periode sebelumnya. Ini menunjukkan kondisi vegetasi di wilayah ini cenderung membaik dari status ${previousStatus.toLowerCase()} menuju ${currentStatus.toLowerCase()}.`;
    }

    if (metric.change_label === 'Menurun') {
      return 'Nilai NDVI menurun dibanding periode sebelumnya, tetapi belum masuk kategori anomali tajam. Artinya vegetasi mulai melemah dan perlu dipantau pada periode berikutnya.';
    }

    if (metric.change_label === 'Stabil') {
      return 'Nilai NDVI relatif stabil dibanding periode sebelumnya. Perubahan kecil ini menunjukkan kondisi vegetasi belum mengalami pergeseran yang berarti.';
    }

    return 'Belum ada interpretasi perubahan karena data pembanding belum tersedia.';
  }

  function getMonitoringRecommendation(metric) {
    if (!metric) return 'Lengkapi data terlebih dahulu.';
    if (metric.ndvi_delta === null || metric.ndvi_delta === undefined) {
      return 'Gunakan periode berikutnya sebagai pembanding untuk mulai membaca tren perubahan vegetasi.';
    }
    if (metric.is_anomaly) {
      return 'Prioritaskan monitoring lapangan karena terdeteksi penurunan cukup tajam. Cek kemungkinan fase panen, lahan dibajak, stres air, atau faktor lain di lapangan.';
    }
    if (metric.change_label === 'Menurun') {
      return 'Lanjutkan pemantauan pada periode berikutnya untuk memastikan apakah penurunan bersifat sementara atau berlanjut.';
    }
    if (metric.change_label === 'Meningkat') {
      return 'Pertahankan pemantauan rutin karena tren vegetasi menunjukkan perbaikan.';
    }
    return 'Kondisi relatif stabil. Tetap lakukan monitoring periodik untuk mendeteksi perubahan lebih dini.';
  }

  function buildCurrentPopup(feature, metric) {
    const nama = getFeatureName(feature);

    if (!metric) {
      return `
        <div class="popup-content">
          <h3 class="popup-title">${nama}</h3>
          <div class="popup-row"><span>Data:</span> Tidak tersedia</div>
        </div>
      `;
    }

    const weather = formatWeather(metric);

    return `
      <div class="popup-content">
        <h3 class="popup-title">${nama}</h3>
        <div class="popup-chip chip-current">Kondisi Saat Itu</div>
        <div class="popup-row"><span>ID:</span> ${metric.id ?? getFeatureId(feature) ?? '-'}</div>
        <div class="popup-row"><span>Tanggal aktif:</span> ${formatDateID(metric.current_period)}</div>
        <div class="popup-row"><span>NDVI saat ini:</span> ${window.ScoringUtils.formatNdvi(metric.ndvi_mean)}</div>
        <div class="popup-row"><span>Status NDVI:</span> ${metric.status ?? '-'}</div>
        <div class="popup-row"><span>Suhu:</span> ${weather.temperature}</div>
        <div class="popup-row"><span>Kelembapan:</span> ${weather.humidity}</div>
        <div class="popup-row"><span>Curah hujan:</span> ${weather.rainfall}</div>
        <div class="popup-row"><span>Angin:</span> ${weather.windspeed}</div>
        <div class="popup-row"><span>Skor SAW:</span> ${metric.score !== undefined ? Number(metric.score).toFixed(4) : '-'}</div>
        <div class="popup-row"><span>Status SAW:</span> ${metric.saw_status ?? '-'}</div>
      </div>
    `;
  }

  function buildChangePopup(feature, metric) {
    const nama = getFeatureName(feature);

    if (!metric) {
      return `
        <div class="popup-content">
          <h3 class="popup-title">${nama}</h3>
          <div class="popup-row"><span>Data:</span> Tidak tersedia</div>
        </div>
      `;
    }

    const previousStatus = getPreviousStatus(metric);
    const deltaPercent = getDeltaPercent(metric);
    const severity = getChangeSeverity(metric);
    const anomalyRow = metric.is_anomaly
      ? `<div class="popup-row"><span>Status anomali:</span> <span class="${window.AnomalyUtils.getAnomalyBadgeClass(metric.anomaly_label)}">${metric.anomaly_label}</span></div>`
      : '';

    return `
      <div class="popup-content popup-content-compare">
        <h3 class="popup-title">${nama}</h3>
        <div class="popup-chip chip-compare">Analisis Perubahan</div>

        <div class="popup-row"><span>Delta NDVI:</span> <span class="${window.AnomalyUtils.getChangeBadgeClass(metric.change_label)}">${window.AnomalyUtils.formatDelta(metric.ndvi_delta)} (${metric.change_label ?? '-'})</span></div>
        <div class="popup-row"><span>Persen perubahan:</span> ${formatSignedPercent(deltaPercent)}</div>
        <div class="popup-row"><span>Tingkat perubahan:</span> <span class="${getChangeSeverityClass(metric)}">${severity}</span></div>
        ${anomalyRow}

        <div class="popup-section-title">Transisi Kondisi</div>
        <div class="popup-row"><span>Status sebelumnya:</span> ${previousStatus}</div>
        <div class="popup-row"><span>Status sekarang:</span> ${metric.status ?? '-'}</div>

        <div class="popup-note">
          ${getChangeInterpretation(metric)}
        </div>
      </div>
    `;
  }

  function buildPopupContent(feature, metric, mode) {
    return mode === 'change'
      ? buildChangePopup(feature, metric)
      : buildCurrentPopup(feature, metric);
  }

  function buildCurrentDetailBlock(feature, metric) {
    const nama = getFeatureName(feature);
    const wilayahId = getFeatureId(feature);
    const props = feature?.properties || {};

    if (!metric) {
      return `
        <div class="detail-sync-card">
          <div class="detail-mode-title">Detail Kondisi Saat Itu</div>
          <div class="detail-table">
            <div class="label">Kecamatan</div><div>${nama}</div>
            <div class="label">ID</div><div>${wilayahId || '-'}</div>
            <div class="label">Data</div><div>Tidak tersedia</div>
          </div>
        </div>
      `;
    }

    const weather = formatWeather(metric);
    const kabupaten = props.kabupaten || props.KABUPATEN || props.wadmkk || 'Grobogan';
    const provinsi = props.provinsi || props.PROVINSI || props.wadmpr || 'Jawa Tengah';

    return `
      <div class="detail-sync-card">
        <div class="detail-mode-title">Detail Kondisi Saat Itu</div>
        <div class="detail-table">
          <div class="label">Kecamatan</div><div>${nama}</div>
          <div class="label">ID</div><div>${metric.id ?? wilayahId ?? '-'}</div>
          <div class="label">Kabupaten</div><div>${kabupaten}</div>
          <div class="label">Provinsi</div><div>${provinsi}</div>

          <div class="label">Tanggal Aktif</div><div>${formatDateID(metric.current_period)}</div>
          <div class="label">NDVI Mean</div><div>${window.ScoringUtils.formatNdvi(metric.ndvi_mean)}</div>
          <div class="label">Status NDVI</div><div><span class="${window.ScoringUtils.getStatusBadgeClass(metric.status)}">${metric.status}</span></div>

          <div class="label">Suhu</div><div>${weather.temperature}</div>
          <div class="label">Suhu Minimum</div><div>${formatNumber(metric.temperature_min, 2, ' °C')}</div>
          <div class="label">Suhu Maksimum</div><div>${formatNumber(metric.temperature_max, 2, ' °C')}</div>
          <div class="label">Kelembapan</div><div>${weather.humidity}</div>
          <div class="label">Curah Hujan</div><div>${weather.rainfall}</div>
          <div class="label">Kecepatan Angin</div><div>${weather.windspeed}</div>

          <div class="label">Skor SAW</div><div>${metric.score !== undefined ? Number(metric.score).toFixed(4) : '-'}</div>
          <div class="label">Status SAW</div><div><span class="${getSawStatusClass(metric.saw_status)}">${metric.saw_status ?? '-'}</span></div>
        </div>
      </div>
    `;
  }

  function buildChangeDetailBlock(feature, metric) {
    const nama = getFeatureName(feature);
    const wilayahId = getFeatureId(feature);

    if (!metric) {
      return `
        <div class="detail-sync-card">
          <div class="detail-mode-title">Detail Analisis Perubahan</div>
          <div class="detail-table">
            <div class="label">Kecamatan</div><div>${nama}</div>
            <div class="label">ID</div><div>${wilayahId || '-'}</div>
            <div class="label">Data</div><div>Tidak tersedia</div>
          </div>
        </div>
      `;
    }

    const previousStatus = getPreviousStatus(metric);
    const deltaPercent = getDeltaPercent(metric);
    const severity = getChangeSeverity(metric);
    const anomalyBlock = metric.is_anomaly
      ? `
        <div class="detail-analysis-card card-anomaly">
          <div class="detail-analysis-title">Status Anomali</div>
          <div class="detail-analysis-body">
            <span class="${window.AnomalyUtils.getAnomalyBadgeClass(metric.anomaly_label)}">${metric.anomaly_label}</span>
            <p>Wilayah ini mengalami penurunan NDVI yang cukup tajam dibanding periode sebelumnya.</p>
          </div>
        </div>
      `
      : '';

    return `
      <div class="detail-sync-card">
        <div class="detail-mode-title">Detail Analisis Perubahan</div>

        <div class="detail-compare-grid">
          <div class="compare-card">
            <span class="compare-label">NDVI Sebelumnya</span>
            <strong>${
              metric.previous_ndvi_mean !== null && metric.previous_ndvi_mean !== undefined
                ? window.ScoringUtils.formatNdvi(metric.previous_ndvi_mean)
                : '-'
            }</strong>
            <small>${metric.previous_period ? formatDateID(metric.previous_period) : 'Belum ada pembanding'}</small>
          </div>

          <div class="compare-card">
            <span class="compare-label">NDVI Sekarang</span>
            <strong>${window.ScoringUtils.formatNdvi(metric.ndvi_mean)}</strong>
            <small>${formatDateID(metric.current_period)}</small>
          </div>

          <div class="compare-card">
            <span class="compare-label">Delta NDVI</span>
            <strong>${window.AnomalyUtils.formatDelta(metric.ndvi_delta)}</strong>
            <small>${metric.change_label ?? '-'}</small>
          </div>

          <div class="compare-card">
            <span class="compare-label">Persen Perubahan</span>
            <strong>${formatSignedPercent(deltaPercent)}</strong>
            <small>${severity}</small>
          </div>
        </div>

        <div class="detail-analysis-card">
          <div class="detail-analysis-title">Ringkasan Perubahan</div>
          <div class="detail-table detail-table-compact">
            <div class="label">Kecamatan</div><div>${nama}</div>
            <div class="label">ID</div><div>${metric.id ?? wilayahId ?? '-'}</div>
            <div class="label">Tanggal Aktif</div><div>${formatDateID(metric.current_period)}</div>
            <div class="label">Tanggal Pembanding</div><div>${
              metric.previous_period ? formatDateID(metric.previous_period) : 'Belum ada pembanding'
            }</div>
            <div class="label">Status Sebelumnya</div><div>${previousStatus}</div>
            <div class="label">Status Sekarang</div><div><span class="${window.ScoringUtils.getStatusBadgeClass(metric.status)}">${metric.status}</span></div>
            <div class="label">Kategori Perubahan</div><div><span class="${window.AnomalyUtils.getChangeBadgeClass(metric.change_label)}">${metric.change_label}</span></div>
            <div class="label">Tingkat Perubahan</div><div><span class="${getChangeSeverityClass(metric)}">${severity}</span></div>
          </div>
        </div>

        ${anomalyBlock}

        <div class="detail-analysis-card">
          <div class="detail-analysis-title">Interpretasi Sistem</div>
          <div class="detail-analysis-body">
            <p>${getChangeInterpretation(metric)}</p>
          </div>
        </div>

        <div class="detail-analysis-card">
          <div class="detail-analysis-title">Rekomendasi Monitoring</div>
          <div class="detail-analysis-body">
            <p>${getMonitoringRecommendation(metric)}</p>
          </div>
        </div>
      </div>
    `;
  }

  function renderSynchronizedDetail(featureKey) {
    const detailEl = getDetailElement();
    if (!detailEl) return;

    const currentLayer = MapState.currentFeatureLayers.get(featureKey);
    const changeLayer = MapState.changeFeatureLayers.get(featureKey);
    const referenceLayer = currentLayer || changeLayer;

    if (!referenceLayer) {
      detailEl.innerHTML = 'Data wilayah tidak ditemukan.';
      return;
    }

    const feature = referenceLayer.feature;
    const currentMetric = getMetricForFeature(feature, 'current');
    const changeMetric = getMetricForFeature(feature, 'change');

    detailEl.innerHTML = `
      <div class="detail-sync-grid">
        ${buildCurrentDetailBlock(feature, currentMetric)}
        ${buildChangeDetailBlock(feature, changeMetric)}
      </div>
    `;
  }

  function clearSelectedStyles() {
    if (MapState.selectedFeatureKey) {
      const currentLayer = MapState.currentFeatureLayers.get(MapState.selectedFeatureKey);
      const changeLayer = MapState.changeFeatureLayers.get(MapState.selectedFeatureKey);

      if (currentLayer) currentLayer.setStyle(buildStyle(currentLayer.feature, 'current', false));
      if (changeLayer) changeLayer.setStyle(buildStyle(changeLayer.feature, 'change', false));
    }
  }

  function selectFeature(featureKey) {
    clearSelectedStyles();
    MapState.selectedFeatureKey = featureKey;

    const currentLayer = MapState.currentFeatureLayers.get(featureKey);
    const changeLayer = MapState.changeFeatureLayers.get(featureKey);

    if (currentLayer) {
      currentLayer.setStyle(buildStyle(currentLayer.feature, 'current', true));
      currentLayer.bringToFront();
    }

    if (changeLayer) {
      changeLayer.setStyle(buildStyle(changeLayer.feature, 'change', true));
      changeLayer.bringToFront();
    }
  }

  function openPopupSafely(layer, mode) {
    if (!layer) return;

    layer.openPopup();

    const activeMap = mode === 'change' ? MapState.changeMap : MapState.currentMap;

    setTimeout(() => {
      const popup = layer.getPopup();
      if (!popup) return;

      const latlng = popup.getLatLng();
      activeMap.panInside(latlng, {
        paddingTopLeft: [32, 32],
        paddingBottomRight: [32, 32],
      });
    }, 120);
  }

  function openSynchronizedPopups(featureKey) {
    const currentLayer = MapState.currentFeatureLayers.get(featureKey);
    const changeLayer = MapState.changeFeatureLayers.get(featureKey);

    if (currentLayer) openPopupSafely(currentLayer, 'current');
    if (changeLayer) openPopupSafely(changeLayer, 'change');
  }

  function handleFeatureClick(featureKey) {
    selectFeature(featureKey);
    renderSynchronizedDetail(featureKey);
    openSynchronizedPopups(featureKey);
  }

  function attachFeatureEvents(feature, layer, mode) {
    const featureKey = getFeatureKey(feature);

    layer.on('mouseover', function () {
      if (MapState.selectedFeatureKey !== featureKey) {
        layer.setStyle({
          weight: 2,
          color: '#263238',
          fillOpacity: 0.76,
        });
      }
    });

    layer.on('mouseout', function () {
      if (MapState.selectedFeatureKey !== featureKey) {
        layer.setStyle(buildStyle(feature, mode, false));
      }
    });

    layer.on('click', function () {
      handleFeatureClick(featureKey);
    });
  }

  function bindPopupWithOptions(layer, html) {
    layer.bindPopup(html, {
      maxWidth: 380,
      minWidth: 250,
      autoPan: true,
      keepInView: true,
      closeButton: true,
      autoPanPaddingTopLeft: L.point(24, 24),
      autoPanPaddingBottomRight: L.point(24, 24),
      className: 'custom-leaflet-popup',
    });
  }

  function makeVectorLayer(geojson, mode) {
    const featureLayerMap =
      mode === 'current' ? MapState.currentFeatureLayers : MapState.changeFeatureLayers;

    featureLayerMap.clear();

    return L.geoJSON(geojson, {
      style: function (feature) {
        return buildStyle(feature, mode, false);
      },
      onEachFeature: function (feature, layer) {
        const featureKey = getFeatureKey(feature);
        const metric = getMetricForFeature(feature, mode);

        featureLayerMap.set(featureKey, layer);
        bindPopupWithOptions(layer, buildPopupContent(feature, metric, mode));
        attachFeatureEvents(feature, layer, mode);
      },
    });
  }

  // =========================================================
  // NDVI RASTER OVERLAY
  // Menampilkan overlay PNG hasil generate_ndvi.py di peta kiri.
  // Path: output_ndvi/{date}/ndvi_overlay.png + ndvi_bounds.json
  // =========================================================

  async function loadNdviOverlay(date) {
    if (!MapState.currentMap) return;

    // Hapus overlay lama jika ada
    if (MapState.ndviOverlayLayer) {
      MapState.currentMap.removeLayer(MapState.ndviOverlayLayer);
      MapState.ndviOverlayLayer = null;
    }

    if (!date) return;

    MapState.ndviCurrentDate = date;

    // Coba load dari folder per-tanggal dulu, fallback ke root output_ndvi
    const basePaths = [
      `output_ndvi/${date}`,
      `output_ndvi`,
    ];

    for (const base of basePaths) {
      const boundsUrl = `${base}/ndvi_bounds.json`;
      const overlayUrl = `${base}/ndvi_overlay.png`;

      try {
        const res = await fetch(boundsUrl);
        if (!res.ok) continue;

        const bounds = await res.json();

        const leafletBounds = bounds.leaflet_bounds || [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ];

        MapState.ndviOverlayLayer = L.imageOverlay(overlayUrl, leafletBounds, {
          opacity: 0.65,
          interactive: false,
          className: 'ndvi-raster-overlay',
        });

        if (MapState.ndviOverlayVisible) {
          MapState.ndviOverlayLayer.addTo(MapState.currentMap);
        }

        // Update tombol toggle
        const btn = document.getElementById('btnNdviOverlay');
        if (btn) {
          btn.textContent = MapState.ndviOverlayVisible
            ? '🛰 Sembunyikan NDVI Raster'
            : '🛰 Tampilkan NDVI Raster';
          btn.classList.toggle('overlay-active', MapState.ndviOverlayVisible);
        }

        return; // Berhasil load, stop loop
      } catch (_) {
        // Lanjut ke fallback
      }
    }

    // Tidak ada overlay yang bisa dimuat — sembunyikan tombol
    const btn = document.getElementById('btnNdviOverlay');
    if (btn) btn.style.display = 'none';
  }

  function toggleNdviOverlay() {
    if (!MapState.currentMap) return;

    MapState.ndviOverlayVisible = !MapState.ndviOverlayVisible;

    if (MapState.ndviOverlayLayer) {
      if (MapState.ndviOverlayVisible) {
        MapState.ndviOverlayLayer.addTo(MapState.currentMap);
      } else {
        MapState.currentMap.removeLayer(MapState.ndviOverlayLayer);
      }
    }

    const btn = document.getElementById('btnNdviOverlay');
    if (btn) {
      btn.textContent = MapState.ndviOverlayVisible
        ? '🛰 Sembunyikan NDVI Raster'
        : '🛰 Tampilkan NDVI Raster';
      btn.classList.toggle('overlay-active', MapState.ndviOverlayVisible);
    }
  }

  function addBaseLayer(mapInstance) {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapInstance);
  }

  function syncMaps(sourceMap, targetMap) {
    sourceMap.on('moveend zoomend', function () {
      if (MapState.syncing) return;
      MapState.syncing = true;
      targetMap.setView(sourceMap.getCenter(), sourceMap.getZoom(), { animate: false });
      requestAnimationFrame(() => {
        MapState.syncing = false;
      });
    });
  }

  function createMaps() {
    MapState.currentMap = L.map('mapCurrent', {
      zoomControl: true,
    }).setView([-7.12, 110.92], 10);

    MapState.changeMap = L.map('mapChange', {
      zoomControl: true,
    }).setView([-7.12, 110.92], 10);

    addBaseLayer(MapState.currentMap);
    addBaseLayer(MapState.changeMap);

    syncMaps(MapState.currentMap, MapState.changeMap);
    syncMaps(MapState.changeMap, MapState.currentMap);

    const detailEl = getDetailElement();
    if (detailEl) {
      detailEl.innerHTML =
        'Klik satu kecamatan di salah satu peta. Detail kondisi dan analisis perubahan untuk kecamatan yang sama akan tampil otomatis bersama.';
    }
  }

  function renderMapData(geojson, metrics, options = {}) {
    if (!MapState.currentMap || !MapState.changeMap) return;

    MapState.currentMetricLookup = buildMetricLookup(metrics);
    MapState.changeMetricLookup = buildMetricLookup(metrics);

    if (MapState.currentVectorLayer) {
      MapState.currentMap.removeLayer(MapState.currentVectorLayer);
      MapState.currentVectorLayer = null;
    }

    if (MapState.changeVectorLayer) {
      MapState.changeMap.removeLayer(MapState.changeVectorLayer);
      MapState.changeVectorLayer = null;
    }

    MapState.selectedFeatureKey = null;
    MapState.currentFeatureLayers.clear();
    MapState.changeFeatureLayers.clear();

    MapState.currentVectorLayer = makeVectorLayer(geojson, 'current').addTo(MapState.currentMap);
    MapState.changeVectorLayer = makeVectorLayer(geojson, 'change').addTo(MapState.changeMap);

    // Load NDVI raster overlay untuk tanggal aktif (peta kiri)
    const activeDate = options?.currentPeriod?.value || null;
    loadNdviOverlay(activeDate);

    if (!MapState.initialBoundsFitted) {
      const bounds = MapState.currentVectorLayer.getBounds();

      MapState.currentMap.fitBounds(bounds, { padding: [20, 20] });
      MapState.changeMap.fitBounds(bounds, { padding: [20, 20] });

      MapState.initialBoundsFitted = true;
    }
  }

  function togglePolygon() {
    if (!MapState.currentMap) return;

    MapState.polygonVisible = !MapState.polygonVisible;

    if (MapState.currentVectorLayer) {
      if (MapState.polygonVisible) {
        MapState.currentVectorLayer.addTo(MapState.currentMap);
      } else {
        MapState.currentMap.removeLayer(MapState.currentVectorLayer);
      }
    }

    const btn = document.getElementById('btnPolygon');
    if (btn) {
      btn.textContent = MapState.polygonVisible
        ? '🗺 Sembunyikan Polygon'
        : '🗺 Tampilkan Polygon';
      btn.classList.toggle('overlay-active', MapState.polygonVisible);
    }
  }

  window.MapUtils = {
    createMaps,
    renderMapData,
    renderDetail: renderSynchronizedDetail,
    toggleNdviOverlay,
    togglePolygon,
  };
})();