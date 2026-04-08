const filters = {
  from: "2023-01-01T00:00:00.000Z",
  to: "2023-12-31T23:59:59.999Z",
  limit: 100
};
const json = JSON.stringify({ filters }).replace(/</g, '\\u003c');
console.log(json);
