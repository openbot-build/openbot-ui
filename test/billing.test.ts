import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutAddress, parseTopUp } from "../src/lib/billing.ts";

test("top-ups use exact cents within the payment limits", () => {
  for (const [value, cents] of [
    ["5", 500],
    ["10.01", 1001],
    ["25.5", 2550],
    ["1000.00", 100000],
  ] as const)
    assert.equal(parseTopUp(value), cents);
  for (const value of [
    "",
    "4.99",
    "1000.01",
    "10.999",
    "1e2",
    "-10",
    "NaN",
    "10,00",
    "9007199254740999",
  ])
    assert.equal(parseTopUp(value), undefined);
});

test("checkout redirects use the Stripe HTTPS host", () => {
  assert.equal(
    checkoutAddress("https://checkout.stripe.com/c/pay/test"),
    "https://checkout.stripe.com/c/pay/test",
  );
  for (const url of [
    "http://checkout.stripe.com/pay",
    "https://checkout.stripe.com.evil.test/pay",
    "javascript:alert(1)",
    "https://evil.test@checkout.stripe.com/pay",
    "https://checkout.stripe.com:444/pay",
  ])
    assert.throws(() => checkoutAddress(url));
});
