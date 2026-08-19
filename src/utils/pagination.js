function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getPagination(query = {}, { defaultLimit = 100, maxLimit = 200 } = {}) {
  const page = parsePositiveInt(query.page, 1);
  const limit = Math.min(parsePositiveInt(query.limit, defaultLimit), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { getPagination };
