'use strict';

function roundMoney(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

module.exports = { roundMoney };
