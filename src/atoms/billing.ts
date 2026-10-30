import { Effect, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { apiRuntime } from "@/lib/api";

export const BillingConfiguration = Schema.Struct({
  enabled: Schema.Boolean,
  canTopUp: Schema.Boolean,
  currency: Schema.Literal("usd"),
  minCents: Schema.Int,
  maxCents: Schema.Int,
  presets: Schema.Array(Schema.Int),
  balanceMicros: Schema.Number,
  heldMicros: Schema.Number,
  availableMicros: Schema.Number,
  organizationId: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["personal", "organization"]),
});
export const BillingOrder = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  createdBy: Schema.String,
  amountCents: Schema.Int,
  currency: Schema.Literal("usd"),
  creditedCents: Schema.Int,
  checkoutUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  status: Schema.Literals([
    "pending",
    "processing",
    "paid",
    "expired",
    "failed",
    "partially_refunded",
    "refunded",
    "disputed",
  ]),
});
export type BillingOrder = typeof BillingOrder.Type;
const request = (space: string, path: string, body?: unknown) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`/v1/cloud/billing${path}`, {
          signal,
          credentials: "same-origin",
          method: body === undefined ? "GET" : "POST",
          headers: {
            "OpenBot-Organization": space,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      catch: () => new Error("Billing could not be reached. Try again."),
    });
    if (!response.ok)
      return yield* Effect.fail(
        new Error(
          response.status === 403
            ? "You do not have access to billing in this space."
            : response.status === 404
              ? "Billing is not available on this server."
              : "Billing could not complete this request. Try again.",
        ),
      );
    return yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new Error("Billing sent an unreadable response."),
    });
  });
export const billingAtom = Atom.family((space: string) =>
  apiRuntime.atom(
    request(space, "").pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(BillingConfiguration)),
    ),
  ),
);
export const billingOrdersAtom = Atom.family((space: string) =>
  apiRuntime.atom(
    request(space, "/orders").pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            items: Schema.Array(BillingOrder),
            next: Schema.NullOr(Schema.String),
          }),
        ),
      ),
    ),
  ),
);
// Encode both identities in the family key; orders never use the selected space implicitly.
export const billingOrderAtom = Atom.family((key: string) => {
  const [space, order] = JSON.parse(key) as [string, string];
  return apiRuntime.atom(
    request(space!, `/orders/${encodeURIComponent(order!)}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(BillingOrder)),
    ),
  );
});
export const createTopUpAtom = apiRuntime.fn(
  Effect.fnUntraced(function* (input: {
    space: string;
    amountCents: number;
    requestId: string;
  }) {
    return yield* request(input.space, "/orders", {
      amountCents: input.amountCents,
      requestId: input.requestId,
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(BillingOrder)));
  }),
);
