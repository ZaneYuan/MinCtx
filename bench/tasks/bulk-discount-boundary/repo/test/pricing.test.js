'use strict';
const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/pricing');

test('coupons', () => {
  assert.strictEqual(p.couponDiscount('WELCOME5', 30), 5);
  assert.strictEqual(p.couponDiscount('spring10', 80), 8);
  assert.strictEqual(p.couponDiscount('SPRING10', 40), 0);
});

test('shipping is free above the threshold', () => {
  assert.strictEqual(p.shippingUS(60, 2), 0);
  assert.ok(p.shippingUS(10, 2) > 0);
});

test('bulk tiers for large orders', () => {
  assert.strictEqual(p.applyTierDiscount(6000), 1200);
  assert.strictEqual(p.applyTierDiscount(100), 0);
});
