'use strict';
const pricing = require('./pricing');
const { roundMoney } = require('./money');

// Order total = subtotal - bulk discount - coupon + shipping + tax.
function orderTotal({ subtotal, region, weightKg = 0, coupon }) {
  const bulk = pricing.applyTierDiscount(subtotal);
  const afterBulk = subtotal - bulk;
  const couponOff = coupon ? pricing.couponDiscount(coupon, afterBulk) : 0;
  const net = afterBulk - couponOff;
  const ship = pricing['shipping' + region](net, weightKg);
  const tax = pricing['tax' + region](net);
  return { bulk, couponOff, ship, tax, total: roundMoney(net + ship + tax) };
}

module.exports = { orderTotal };
