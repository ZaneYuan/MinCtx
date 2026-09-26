'use strict';
// Hidden acceptance check: copied into the workspace only after the agent finishes.
const test = require('node:test');
const assert = require('node:assert');
const p = require('./src/pricing');
const { orderTotal } = require('./src/order');

test('tier thresholds are inclusive', () => {
  assert.strictEqual(p.applyTierDiscount(1000), 100);
  assert.strictEqual(p.applyTierDiscount(500), 25);
  assert.strictEqual(p.applyTierDiscount(2500), 375);
  assert.strictEqual(p.applyTierDiscount(5000), 1000);
});

test('behaviour away from thresholds is unchanged', () => {
  assert.strictEqual(p.applyTierDiscount(999.99), 50);
  assert.strictEqual(p.applyTierDiscount(499.99), 0);
  assert.strictEqual(p.applyTierDiscount(6000), 1200);
  assert.strictEqual(p.couponDiscount('SPRING10', 80), 8);
  assert.strictEqual(p.shippingUS(60, 2), 0);
});

test('order total uses the discount', () => {
  assert.strictEqual(orderTotal({ subtotal: 1000, region: 'US' }).bulk, 100);
});
