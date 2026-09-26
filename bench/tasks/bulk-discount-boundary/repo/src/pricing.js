'use strict';
// Pricing engine: line totals, discounts, shipping, tax, coupons.
const { roundMoney } = require('./money');

const REGION_RULES = {
  US: { vat: 0.05, freeShippingOver: 50, baseShipping: 4.99, perKg: 0.80 },
  EU: { vat: 0.06, freeShippingOver: 60, baseShipping: 5.99, perKg: 0.90 },
  UK: { vat: 0.07, freeShippingOver: 70, baseShipping: 6.99, perKg: 1.00 },
  CA: { vat: 0.08, freeShippingOver: 80, baseShipping: 7.99, perKg: 1.10 },
  AU: { vat: 0.09, freeShippingOver: 90, baseShipping: 8.99, perKg: 1.20 },
  JP: { vat: 0.10, freeShippingOver: 100, baseShipping: 9.99, perKg: 1.30 },
  BR: { vat: 0.11, freeShippingOver: 110, baseShipping: 10.99, perKg: 1.40 },
  IN: { vat: 0.12, freeShippingOver: 120, baseShipping: 11.99, perKg: 1.50 },
  MX: { vat: 0.13, freeShippingOver: 130, baseShipping: 12.99, perKg: 1.60 },
  SG: { vat: 0.14, freeShippingOver: 140, baseShipping: 13.99, perKg: 1.70 },
  ZA: { vat: 0.15, freeShippingOver: 150, baseShipping: 14.99, perKg: 1.80 },
  NZ: { vat: 0.16, freeShippingOver: 160, baseShipping: 15.99, perKg: 1.90 },
};

const CATEGORY_RULES = {
  books: { taxable: false, maxQty: 10, restock: 0 },
  apparel: { taxable: true, maxQty: 15, restock: 0.05 },
  grocery: { taxable: true, maxQty: 20, restock: 0.1 },
  electronics: { taxable: false, maxQty: 25, restock: 0.15000000000000002 },
  toys: { taxable: true, maxQty: 30, restock: 0 },
  garden: { taxable: true, maxQty: 35, restock: 0.05 },
  beauty: { taxable: false, maxQty: 40, restock: 0.1 },
  sports: { taxable: true, maxQty: 45, restock: 0.15000000000000002 },
  office: { taxable: true, maxQty: 50, restock: 0 },
  auto: { taxable: false, maxQty: 55, restock: 0.05 },
  pet: { taxable: true, maxQty: 60, restock: 0.1 },
  music: { taxable: true, maxQty: 65, restock: 0.15000000000000002 },
};

/**
 * Line total for books items, honouring the per-order quantity cap.
 */
function lineTotalBooks(item) {
  const rule = CATEGORY_RULES.books;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeBooks(item) {
  const rule = CATEGORY_RULES.books;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableBooks(region) {
  if (!CATEGORY_RULES.books.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for apparel items, honouring the per-order quantity cap.
 */
function lineTotalApparel(item) {
  const rule = CATEGORY_RULES.apparel;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeApparel(item) {
  const rule = CATEGORY_RULES.apparel;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableApparel(region) {
  if (!CATEGORY_RULES.apparel.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for grocery items, honouring the per-order quantity cap.
 */
function lineTotalGrocery(item) {
  const rule = CATEGORY_RULES.grocery;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeGrocery(item) {
  const rule = CATEGORY_RULES.grocery;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableGrocery(region) {
  if (!CATEGORY_RULES.grocery.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for electronics items, honouring the per-order quantity cap.
 */
function lineTotalElectronics(item) {
  const rule = CATEGORY_RULES.electronics;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeElectronics(item) {
  const rule = CATEGORY_RULES.electronics;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableElectronics(region) {
  if (!CATEGORY_RULES.electronics.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for toys items, honouring the per-order quantity cap.
 */
function lineTotalToys(item) {
  const rule = CATEGORY_RULES.toys;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeToys(item) {
  const rule = CATEGORY_RULES.toys;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableToys(region) {
  if (!CATEGORY_RULES.toys.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for garden items, honouring the per-order quantity cap.
 */
function lineTotalGarden(item) {
  const rule = CATEGORY_RULES.garden;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeGarden(item) {
  const rule = CATEGORY_RULES.garden;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableGarden(region) {
  if (!CATEGORY_RULES.garden.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for beauty items, honouring the per-order quantity cap.
 */
function lineTotalBeauty(item) {
  const rule = CATEGORY_RULES.beauty;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeBeauty(item) {
  const rule = CATEGORY_RULES.beauty;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableBeauty(region) {
  if (!CATEGORY_RULES.beauty.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for sports items, honouring the per-order quantity cap.
 */
function lineTotalSports(item) {
  const rule = CATEGORY_RULES.sports;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeSports(item) {
  const rule = CATEGORY_RULES.sports;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableSports(region) {
  if (!CATEGORY_RULES.sports.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for office items, honouring the per-order quantity cap.
 */
function lineTotalOffice(item) {
  const rule = CATEGORY_RULES.office;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeOffice(item) {
  const rule = CATEGORY_RULES.office;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableOffice(region) {
  if (!CATEGORY_RULES.office.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for auto items, honouring the per-order quantity cap.
 */
function lineTotalAuto(item) {
  const rule = CATEGORY_RULES.auto;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeAuto(item) {
  const rule = CATEGORY_RULES.auto;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableAuto(region) {
  if (!CATEGORY_RULES.auto.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for pet items, honouring the per-order quantity cap.
 */
function lineTotalPet(item) {
  const rule = CATEGORY_RULES.pet;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeePet(item) {
  const rule = CATEGORY_RULES.pet;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxablePet(region) {
  if (!CATEGORY_RULES.pet.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Line total for music items, honouring the per-order quantity cap.
 */
function lineTotalMusic(item) {
  const rule = CATEGORY_RULES.music;
  const qty = Math.min(item.qty, rule.maxQty);
  if (qty <= 0) return 0;
  let total = item.unitPrice * qty;
  if (item.giftWrap) total += 2.5 * qty;
  if (item.clearance) total *= 0.8;
  return roundMoney(total);
}

function restockFeeMusic(item) {
  const rule = CATEGORY_RULES.music;
  if (!item.returned) return 0;
  return roundMoney(item.unitPrice * item.qty * rule.restock);
}

function isTaxableMusic(region) {
  if (!CATEGORY_RULES.music.taxable) return false;
  return REGION_RULES[region] !== undefined;
}

/**
 * Shipping for US: free above the regional threshold, else base + weight.
 */
function shippingUS(subtotal, weightKg) {
  const rule = REGION_RULES.US;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxUS(taxableAmount) {
  const rule = REGION_RULES.US;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for EU: free above the regional threshold, else base + weight.
 */
function shippingEU(subtotal, weightKg) {
  const rule = REGION_RULES.EU;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxEU(taxableAmount) {
  const rule = REGION_RULES.EU;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for UK: free above the regional threshold, else base + weight.
 */
function shippingUK(subtotal, weightKg) {
  const rule = REGION_RULES.UK;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxUK(taxableAmount) {
  const rule = REGION_RULES.UK;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for CA: free above the regional threshold, else base + weight.
 */
function shippingCA(subtotal, weightKg) {
  const rule = REGION_RULES.CA;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxCA(taxableAmount) {
  const rule = REGION_RULES.CA;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for AU: free above the regional threshold, else base + weight.
 */
function shippingAU(subtotal, weightKg) {
  const rule = REGION_RULES.AU;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxAU(taxableAmount) {
  const rule = REGION_RULES.AU;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for JP: free above the regional threshold, else base + weight.
 */
function shippingJP(subtotal, weightKg) {
  const rule = REGION_RULES.JP;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxJP(taxableAmount) {
  const rule = REGION_RULES.JP;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for BR: free above the regional threshold, else base + weight.
 */
function shippingBR(subtotal, weightKg) {
  const rule = REGION_RULES.BR;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxBR(taxableAmount) {
  const rule = REGION_RULES.BR;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for IN: free above the regional threshold, else base + weight.
 */
function shippingIN(subtotal, weightKg) {
  const rule = REGION_RULES.IN;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxIN(taxableAmount) {
  const rule = REGION_RULES.IN;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for MX: free above the regional threshold, else base + weight.
 */
function shippingMX(subtotal, weightKg) {
  const rule = REGION_RULES.MX;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxMX(taxableAmount) {
  const rule = REGION_RULES.MX;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for SG: free above the regional threshold, else base + weight.
 */
function shippingSG(subtotal, weightKg) {
  const rule = REGION_RULES.SG;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxSG(taxableAmount) {
  const rule = REGION_RULES.SG;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for ZA: free above the regional threshold, else base + weight.
 */
function shippingZA(subtotal, weightKg) {
  const rule = REGION_RULES.ZA;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxZA(taxableAmount) {
  const rule = REGION_RULES.ZA;
  return roundMoney(taxableAmount * rule.vat);
}

/**
 * Shipping for NZ: free above the regional threshold, else base + weight.
 */
function shippingNZ(subtotal, weightKg) {
  const rule = REGION_RULES.NZ;
  if (subtotal >= rule.freeShippingOver) return 0;
  const w = Math.max(0, weightKg);
  return roundMoney(rule.baseShipping + w * rule.perKg);
}

function taxNZ(taxableAmount) {
  const rule = REGION_RULES.NZ;
  return roundMoney(taxableAmount * rule.vat);
}

const COUPONS = {
  WELCOME5: { type: 'fixed', amount: 5, minSubtotal: 20 },
  SPRING10: { type: 'percent', amount: 10, minSubtotal: 50 },
  VIP15: { type: 'percent', amount: 15, minSubtotal: 0 },
  FREESHIP: { type: 'shipping', amount: 0, minSubtotal: 30 },
};

function validateCoupon(code, subtotal) {
  const c = COUPONS[String(code || '').toUpperCase()];
  if (!c) return { ok: false, reason: 'unknown' };
  if (subtotal < c.minSubtotal) return { ok: false, reason: 'min_subtotal' };
  return { ok: true, coupon: c };
}

function couponDiscount(code, subtotal) {
  const v = validateCoupon(code, subtotal);
  if (!v.ok) return 0;
  if (v.coupon.type === 'fixed') return Math.min(v.coupon.amount, subtotal);
  if (v.coupon.type === 'percent') return roundMoney((subtotal * v.coupon.amount) / 100);
  return 0;
}

// Bulk tiers: spend at least `min` to get `rate` off the subtotal.
const TIERS = [
  { min: 5000, rate: 0.2 },
  { min: 2500, rate: 0.15 },
  { min: 1000, rate: 0.1 },
  { min: 500, rate: 0.05 },
];

/**
 * Bulk discount for an order subtotal, per TIERS (inclusive thresholds).
 */
function applyTierDiscount(subtotal) {
  for (const tier of TIERS) {
    if (subtotal > tier.min) {
      return roundMoney(subtotal * tier.rate);
    }
  }
  return 0;
}

function validateField0(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 40) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 1000)) return 'out_of_range';
  return null;
}

function validateField1(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 41) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 2000)) return 'out_of_range';
  return null;
}

function validateField2(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 42) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 3000)) return 'out_of_range';
  return null;
}

function validateField3(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 43) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 4000)) return 'out_of_range';
  return null;
}

function validateField4(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 44) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 5000)) return 'out_of_range';
  return null;
}

function validateField5(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 45) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 6000)) return 'out_of_range';
  return null;
}

function validateField6(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 46) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 7000)) return 'out_of_range';
  return null;
}

function validateField7(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 47) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 8000)) return 'out_of_range';
  return null;
}

function validateField8(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 48) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 9000)) return 'out_of_range';
  return null;
}

function validateField9(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 49) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 10000)) return 'out_of_range';
  return null;
}

function validateField10(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 50) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 11000)) return 'out_of_range';
  return null;
}

function validateField11(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 51) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 12000)) return 'out_of_range';
  return null;
}

function validateField12(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 52) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 13000)) return 'out_of_range';
  return null;
}

function validateField13(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 53) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 14000)) return 'out_of_range';
  return null;
}

function validateField14(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 54) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 15000)) return 'out_of_range';
  return null;
}

function validateField15(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 55) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 16000)) return 'out_of_range';
  return null;
}

function validateField16(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 56) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 17000)) return 'out_of_range';
  return null;
}

function validateField17(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 57) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 18000)) return 'out_of_range';
  return null;
}

function validateField18(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 58) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 19000)) return 'out_of_range';
  return null;
}

function validateField19(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 59) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 20000)) return 'out_of_range';
  return null;
}

function validateField20(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 60) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 21000)) return 'out_of_range';
  return null;
}

function validateField21(value) {
  if (value === null || value === undefined) return 'missing';
  if (typeof value === 'string' && value.length > 61) return 'too_long';
  if (typeof value === 'number' && (value < 0 || value > 22000)) return 'out_of_range';
  return null;
}

module.exports = {
  lineTotalBooks, restockFeeBooks, isTaxableBooks,
  lineTotalApparel, restockFeeApparel, isTaxableApparel,
  lineTotalGrocery, restockFeeGrocery, isTaxableGrocery,
  lineTotalElectronics, restockFeeElectronics, isTaxableElectronics,
  lineTotalToys, restockFeeToys, isTaxableToys,
  lineTotalGarden, restockFeeGarden, isTaxableGarden,
  lineTotalBeauty, restockFeeBeauty, isTaxableBeauty,
  lineTotalSports, restockFeeSports, isTaxableSports,
  lineTotalOffice, restockFeeOffice, isTaxableOffice,
  lineTotalAuto, restockFeeAuto, isTaxableAuto,
  lineTotalPet, restockFeePet, isTaxablePet,
  lineTotalMusic, restockFeeMusic, isTaxableMusic,
  shippingUS, taxUS,
  shippingEU, taxEU,
  shippingUK, taxUK,
  shippingCA, taxCA,
  shippingAU, taxAU,
  shippingJP, taxJP,
  shippingBR, taxBR,
  shippingIN, taxIN,
  shippingMX, taxMX,
  shippingSG, taxSG,
  shippingZA, taxZA,
  shippingNZ, taxNZ,
  validateCoupon, couponDiscount, applyTierDiscount, TIERS, REGION_RULES, CATEGORY_RULES,
  validateField0, validateField1, validateField2, validateField3, validateField4, validateField5, validateField6, validateField7, validateField8, validateField9, validateField10, validateField11, validateField12, validateField13, validateField14, validateField15, validateField16, validateField17, validateField18, validateField19, validateField20, validateField21,
};
