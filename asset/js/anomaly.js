(function () {
  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isNaN(num) ? fallback : num;
  }

  function classifyChange(delta, epsilon = 0.0001) {
    if (delta === null || delta === undefined || delta === '') {
      return 'Tidak Ada Data Pembanding';
    }

    const value = safeNumber(delta, 0);

    if (value > epsilon) return 'Meningkat';
    if (value < -epsilon) return 'Menurun';
    return 'Stabil';
  }

  function isAnomaly(delta, threshold = -0.05) {
    if (delta === null || delta === undefined || delta === '') return false;
    return safeNumber(delta, 0) <= threshold;
  }

  function getAnomalyLabel(delta, threshold = -0.05) {
    return isAnomaly(delta, threshold) ? 'Anomali Penurunan' : 'Normal';
  }

  function formatDelta(delta) {
    if (delta === null || delta === undefined || delta === '') {
      return '-';
    }

    const value = safeNumber(delta, 0);
    if (value > 0) return `+${value.toFixed(4)}`;
    return value.toFixed(4);
  }

  function getChangeBadgeClass(change) {
    const value = String(change || '').toLowerCase();

    if (value === 'meningkat') return 'badge badge-meningkat';
    if (value === 'menurun') return 'badge badge-menurun';
    if (value === 'stabil') return 'badge badge-stabil';
    return 'badge badge-netral';
  }

  function getAnomalyBadgeClass(label) {
    const value = String(label || '').toLowerCase();

    if (value === 'anomali penurunan') return 'badge badge-anomali';
    return 'badge badge-netral';
  }

  window.AnomalyUtils = {
    classifyChange,
    isAnomaly,
    getAnomalyLabel,
    formatDelta,
    getChangeBadgeClass,
    getAnomalyBadgeClass,
  };
})();