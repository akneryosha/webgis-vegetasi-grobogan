(function () {
  const AppState = {
    geojson: null,
    periods: [],
    currentDate: null,
    currentMetrics: [],
  };

  const els = {
    periodSelect: document.getElementById('periodSelect'),
    selectedDateText: document.getElementById('selectedDateText'),
    totalKecamatan: document.getElementById('totalKecamatan'),
    countBaik: document.getElementById('countBaik'),
    countSedang: document.getElementById('countSedang'),
    countBuruk: document.getElementById('countBuruk'),
  };

  function safeArray(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.periods)) return data.periods;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isNaN(num) ? fallback : num;
  }

  function normalizePeriodItem(item) {
    const value = item?.value || item?.date || item?.id || '';
    const label = item?.label || value;
    return { value, label };
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

  function metricKey(item) {
    const keys = [
      item?.id,
      item?.ID,
      item?.kode,
      item?.kode_kecamatan,
      item?.kecamatan,
    ];

    for (const key of keys) {
      if (key !== undefined && key !== null && key !== '') {
        return String(key).trim().toUpperCase();
      }
    }

    return '';
  }

  function metricMap(metrics) {
    const map = new Map();

    (metrics || []).forEach((item) => {
      const key = metricKey(item);
      if (key) {
        map.set(key, item);
      }
    });

    return map;
  }

  async function fetchJson(path) {
    const response = await fetch(path);

    if (!response.ok) {
      throw new Error(`Gagal memuat file: ${path}`);
    }

    return response.json();
  }

  async function loadBaseData() {
    const [geojsonData, periodsData] = await Promise.all([
      fetchJson('data/kecamatan.geojson'),
      fetchJson('data/periods.json'),
    ]);

    AppState.geojson = geojsonData;
    AppState.periods = safeArray(periodsData)
      .map(normalizePeriodItem)
      .filter((item) => item.value);
  }

  async function loadMetricsByDate(date) {
    return fetchJson(`data/metrics_${date}.json`);
  }

  function findPeriod(date) {
    return AppState.periods.find((item) => item.value === date) || null;
  }

  function findPreviousPeriod(date) {
    const index = AppState.periods.findIndex((item) => item.value === date);
    if (index <= 0) return null;
    return AppState.periods[index - 1];
  }

  function enrichMetrics(currentMetrics, previousMetrics, currentPeriod, previousPeriod) {
    const prevMap = metricMap(previousMetrics);

    return (currentMetrics || []).map((item) => {
      const current = { ...item };
      const previous = prevMap.get(metricKey(current)) || null;

      current.ndvi_mean = safeNumber(current.ndvi_mean, 0);
      current.status = window.ScoringUtils.classifyNdviStatus(current.ndvi_mean);

      current.temperature =
        current.temperature !== undefined && current.temperature !== null
          ? safeNumber(current.temperature, 0)
          : null;

      current.temperature_min =
        current.temperature_min !== undefined && current.temperature_min !== null
          ? safeNumber(current.temperature_min, 0)
          : null;

      current.temperature_max =
        current.temperature_max !== undefined && current.temperature_max !== null
          ? safeNumber(current.temperature_max, 0)
          : null;

      current.humidity =
        current.humidity !== undefined && current.humidity !== null
          ? safeNumber(current.humidity, 0)
          : null;

      current.rainfall =
        current.rainfall !== undefined && current.rainfall !== null
          ? safeNumber(current.rainfall, 0)
          : null;

      current.windspeed_kmh =
        current.windspeed_kmh !== undefined && current.windspeed_kmh !== null
          ? safeNumber(current.windspeed_kmh, 0)
          : null;

      current.current_period = currentPeriod?.value || null;
      current.previous_period = previousPeriod?.value || null;
      current.current_period_label = currentPeriod?.label || currentPeriod?.value || null;
      current.previous_period_label = previousPeriod?.label || previousPeriod?.value || null;

      if (previous) {
        const prevNdvi = safeNumber(previous.ndvi_mean, 0);
        current.previous_ndvi_mean = prevNdvi;
        current.ndvi_delta = Number((current.ndvi_mean - prevNdvi).toFixed(4));
      } else {
        current.previous_ndvi_mean = null;
        current.ndvi_delta = null;
      }

      current.change_label = window.AnomalyUtils.classifyChange(current.ndvi_delta);
      current.is_anomaly = window.AnomalyUtils.isAnomaly(current.ndvi_delta, -0.05);
      current.anomaly_label = current.is_anomaly
        ? window.AnomalyUtils.getAnomalyLabel(current.ndvi_delta, -0.05)
        : null;

      current.score = window.SawUtils.computeSawScore(current);
      current.saw_status = window.SawUtils.classifySawScore(current.score);

      return current;
    });
  }

  function populatePeriodSelect() {
    if (!els.periodSelect) return;

    els.periodSelect.innerHTML = '';

    AppState.periods.forEach((period) => {
      const option = document.createElement('option');
      option.value = period.value;
      option.textContent = period.label;
      els.periodSelect.appendChild(option);
    });
  }

  function updateSidebarSummary(currentPeriod, previousPeriod, metrics) {
    const total = metrics.length;
    const baik = metrics.filter((m) => String(m.status).toLowerCase().includes('tinggi')).length;
    const sedang = metrics.filter((m) => String(m.status).toLowerCase().includes('sedang')).length;
    const buruk = metrics.filter((m) => String(m.status).toLowerCase().includes('rendah')).length;

    if (els.totalKecamatan) els.totalKecamatan.textContent = total;
    if (els.countBaik) els.countBaik.textContent = baik;
    if (els.countSedang) els.countSedang.textContent = sedang;
    if (els.countBuruk) els.countBuruk.textContent = buruk;

    if (els.selectedDateText) {
      if (previousPeriod) {
        els.selectedDateText.innerHTML = `
          Tanggal aktif: <strong>${formatDateID(currentPeriod?.value)}</strong><br>
          Dibandingkan dengan: <strong>${formatDateID(previousPeriod?.value)}</strong>
        `;
      } else {
        els.selectedDateText.innerHTML = `
          Tanggal aktif: <strong>${formatDateID(currentPeriod?.value)}</strong><br>
          Periode ini adalah <strong>data awal</strong>, sehingga belum ada pembanding sebelumnya.
        `;
      }
    }
  }

  async function applyPeriod(date) {
    if (!date) return;

    const currentPeriod = findPeriod(date);
    const previousPeriod = findPreviousPeriod(date);

    const currentMetricsRaw = await loadMetricsByDate(date);
    const previousMetricsRaw = previousPeriod
      ? await loadMetricsByDate(previousPeriod.value)
      : [];

    const enrichedMetrics = enrichMetrics(
      currentMetricsRaw,
      previousMetricsRaw,
      currentPeriod,
      previousPeriod
    );

    AppState.currentDate = date;
    AppState.currentMetrics = enrichedMetrics;

    updateSidebarSummary(currentPeriod, previousPeriod, enrichedMetrics);

    window.MapUtils.renderMapData(AppState.geojson, enrichedMetrics, {
      currentPeriod,
      previousPeriod,
    });
  }

  async function initApp() {
    try {
      window.MapUtils.createMaps();
      await loadBaseData();
      populatePeriodSelect();

      if (els.periodSelect) {
        els.periodSelect.addEventListener('change', async function (event) {
          await applyPeriod(event.target.value);
        });
      }

      if (AppState.periods.length > 0 && els.periodSelect) {
        els.periodSelect.value = AppState.periods[0].value;
        await applyPeriod(AppState.periods[0].value);
      }
    } catch (error) {
      console.error(error);
      alert('Gagal memuat data WebGIS. Periksa file kecamatan.geojson, periods.json, dan metrics.');
    }
  }

  initApp();
})();