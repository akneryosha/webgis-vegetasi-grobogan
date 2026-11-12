(function () {
  function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isNaN(num) ? fallback : num;
  }

  function normalizeBenefit(value, min, max) {
    const num = safeNumber(value, 0);
    if (max === min) return 1;
    return clamp01((num - min) / (max - min));
  }

  function normalizeCost(value, min, max) {
    const num = safeNumber(value, 0);
    if (max === min) return 1;
    return clamp01((max - num) / (max - min));
  }

  function computeSawScore(metric, options = {}) {
    const weights = {
      ndvi: 0.5,
      rainfall: 0.2,
      humidity: 0.2,
      temperature: 0.1,
      ...(options.weights || {}),
    };

    const ndviNorm = normalizeBenefit(
      safeNumber(metric.ndvi_mean, 0),
      options.ndviMin ?? 0,
      options.ndviMax ?? 1
    );

    const rainfallNorm = normalizeBenefit(
      safeNumber(metric.rainfall, 0),
      options.rainfallMin ?? 0,
      options.rainfallMax ?? 30
    );

    const humidityNorm = normalizeBenefit(
      safeNumber(metric.humidity, 0),
      options.humidityMin ?? 40,
      options.humidityMax ?? 100
    );

    const temperatureNorm = normalizeCost(
      safeNumber(metric.temperature, 0),
      options.temperatureMin ?? 20,
      options.temperatureMax ?? 40
    );

    const score =
      ndviNorm * weights.ndvi +
      rainfallNorm * weights.rainfall +
      humidityNorm * weights.humidity +
      temperatureNorm * weights.temperature;

    return Number(score.toFixed(4));
  }

  function classifySawScore(score) {
    const value = safeNumber(score, 0);

    if (value >= 0.7) return 'Aman';
    if (value >= 0.4) return 'Waspada';
    return 'Kritis';
  }

  function getSawColor(status) {
    const value = String(status || '').toLowerCase();

    if (value === 'aman') return '#2e7d32';
    if (value === 'waspada') return '#f9a825';
    if (value === 'kritis') return '#c62828';
    return '#607d8b';
  }

  window.SawUtils = {
    clamp01,
    normalizeBenefit,
    normalizeCost,
    computeSawScore,
    classifySawScore,
    getSawColor,
  };
})();