// GET /api/cards — returns the list of supported credit cards for the UI dropdown
const { creditCards } = require('./_lib');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const list = Object.entries(creditCards).map(([id, c]) => ({
    id,
    name:     c.name,
    currency: c.currencyShort,
    color:    c.color
  }));
  res.json(list);
};
