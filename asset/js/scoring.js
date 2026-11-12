(function () {
  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isNaN(num) ? fallback : num;
  }

  function formatNdvi(value) {
    const num = safeNumber(value, NaN);
    if (Number.isNaN(num)) return '-';
    return num.toFixed(4);
  }

  function classifyNdviStatus(ndvi) {
    const value = safeNumber(ndvi, 0);

    if (value >= 0.5) return 'Vegetasi Tinggi';
    if (value >= 0.3) return 'Vegetasi Sedang';
    return 'Vegetasi Rendah';
  }

  function getStatusColor(status) {
    const value = String(status || '').toLowerCase();

    if (value.includes('tinggi') || value === 'baik') return '#2e7d32';
    if (value.includes('sedang')) return '#f9a825';
    if (value.includes('rendah') || value === 'buruk') return '#c62828';
    return '#607d8b';
  }

  function getStatusBadgeClass(status) {
    const value = String(status || '').toLowerCase();

    if (value.includes('tinggi') || value === 'baik') return 'badge badge-baik';
    if (value.includes('sedang')) return 'badge badge-sedang';
    if (value.includes('rendah') || value === 'buruk') return 'badge badge-buruk';
    return 'badge badge-netral';
  }

  window.ScoringUtils = {
    safeNumber,
    formatNdvi,
    classifyNdviStatus,
    getStatusColor,
    getStatusBadgeClass,
  };
})();