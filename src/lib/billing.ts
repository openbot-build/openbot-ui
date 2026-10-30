/** Parse whole cents without rounding money that the person did not enter. */
export const parseTopUp = (value: string): number | undefined => {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [dollars, fraction = ""] = value.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 500 && cents <= 100000
    ? cents
    : undefined;
};

export const checkoutAddress = (value: string): string => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "checkout.stripe.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("The checkout address is not valid.");
  return url.href;
};
