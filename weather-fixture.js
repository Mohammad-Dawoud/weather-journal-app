const observedAtSeconds = Date.UTC(2025, 0, 15, 12) / 1000;
const temperaturesF = new Map([
  ["02139", 37.4],
  ["10001", 43.7],
  ["90210", 68],
]);

// A separately authorized provider can implement the same ZIP and AbortSignal
// contract. Only normalized Fahrenheit temperature and UTC timestamp leave it.
async function lookupFixture(zip, { signal }) {
  signal.throwIfAborted();
  const temperatureF = temperaturesF.get(zip);
  return temperatureF === undefined
    ? null
    : { temperatureF, observedAtSeconds };
}

module.exports = { lookupFixture };
