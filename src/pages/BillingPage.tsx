import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  billingAtom,
  billingOrderAtom,
  billingOrdersAtom,
  createTopUpAtom,
  type BillingOrder,
} from "@/atoms/billing";
import { checkoutAddress, parseTopUp } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, organizationAtom } from "@/lib/api";

const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const labels: Record<BillingOrder["status"], string> = {
  pending: "Awaiting payment",
  processing: "Payment received · adding credits",
  paid: "Credits added",
  expired: "Checkout expired",
  failed: "Payment failed",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  disputed: "Payment disputed",
};
export function BillingPage() {
  const selected = useAtomValue(organizationAtom);
  const { orderId } = useParams();
  const [query] = useSearchParams();
  const space = orderId ? query.get("space") : selected;
  if (!space) return <p className="p-10">Choose a space to view billing.</p>;
  return <BillingSpace key={space} space={space} orderId={orderId} />;
}
function BillingSpace({ space, orderId }: { space: string; orderId?: string }) {
  const configuration = useAtomValue(billingAtom(space));
  const refresh = useAtomRefresh(billingAtom(space));
  const orders = useAtomValue(billingOrdersAtom(space));
  const refreshOrders = useAtomRefresh(billingOrdersAtom(space));
  const create = useAtomSet(createTopUpAtom, { mode: "promise" });
  const [amount, setAmount] = useState("25");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<
    { amountCents: number; requestId: string } | undefined
  >(undefined);
  const cents = parseTopUp(amount);
  if (configuration._tag === "Failure")
    return (
      <div className="p-10">
        <p role="alert">{errorMessage(configuration.cause)}</p>
        <Button variant="secondary" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  if (configuration._tag !== "Success")
    return <p className="p-10">Loading billing…</p>;
  const data = configuration.value;
  const name = data.kind === "personal" ? "Your personal space" : data.name;
  const pay = () => {
    if (cents === undefined) return;
    // Retain the request ID after network errors so retrying cannot create another charge.
    if (pending.current?.amountCents !== cents)
      pending.current = { amountCents: cents, requestId: crypto.randomUUID() };
    setBusy(true);
    create({ space, ...pending.current })
      .then((order) => {
        if (order.checkoutUrl) {
          globalThis.location.assign(checkoutAddress(order.checkoutUrl));
        } else {
          toast.info("This order already exists. Check its status below.");
          refreshOrders();
        }
      })
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => setBusy(false));
  };
  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 overflow-y-auto p-6 md:p-10">
      <header>
        <p className="text-body-medium text-muted-foreground">{name}</p>
        <h1 className="text-headline-large font-semibold">Billing</h1>
        <p className="mt-2 text-muted-foreground">
          Credits belong to this space. They cannot be moved to another account.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Balance", data.balanceMicros],
          ["Held for work", data.heldMicros],
          ["Available", data.availableMicros],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-surface bg-card p-7"
          >
            <p className="text-body-medium text-muted-foreground">{label}</p>
            <p className="mt-3 text-headline-small font-medium">
              {dollars(Number(value) / 1_000_000)}
            </p>
          </div>
        ))}
      </div>
      {data.availableMicros <= 0 && (
        <p role="status" className="rounded-action-panel nested-controls bg-muted p-(--action-inset)">
          Add credits to use platform models in this space.
        </p>
      )}
      {orderId && (
        <OrderStatus
          key={orderId}
          space={space}
          id={orderId}
          onChange={() => {
            refresh();
            refreshOrders();
          }}
        />
      )}
      <section className="space-y-5 rounded-panel nested-controls bg-card p-(--surface-inset)">
        <h2 className="text-title-large font-medium">Add credits</h2>
        {!data.enabled ? (
          <p>
            Payments are not set up yet. Please contact the platform operator.
          </p>
        ) : !data.canTopUp ? (
          <p>You have read-only billing access.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {data.presets.map((value) => (
                <Button
                  disabled={busy}
                  key={value}
                  variant={cents === value ? "default" : "secondary"}
                  onClick={() => {
                    setAmount(String(value / 100));
                    setConfirm(false);
                  }}
                >
                  {dollars(value / 100)}
                </Button>
              ))}
            </div>
            <label className="block space-y-2">
              <span>Amount in USD</span>
              <Input
                className="max-w-64"
                inputMode="decimal"
                value={amount}
                disabled={busy}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setConfirm(false);
                }}
                aria-invalid={cents === undefined}
              />
            </label>
            <p className="text-body-medium text-muted-foreground">
              $5–$1,000 per payment. The full amount becomes credits. OpenBot
              pays the processing fee.
            </p>
            {confirm && cents !== undefined ? (
              <div className="space-y-3 rounded-action-panel nested-controls bg-muted p-(--action-inset)">
                <p>
                  Add <strong>{dollars(cents / 100)}</strong> to{" "}
                  <strong>{name}</strong>?
                </p>
                <p className="text-body-medium">
                  This payment will not add credits to any other space.
                </p>
                <div className="flex gap-2">
                  <Button disabled={busy} onClick={pay}>
                    {busy ? "Opening checkout…" : "Continue to Stripe"}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => setConfirm(false)}
                  >
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={busy || cents === undefined}
                onClick={() => setConfirm(true)}
              >
                Review payment
              </Button>
            )}
          </>
        )}
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-title-large font-medium">Payment orders</h2>
          <Button
            variant="ghost"
            onClick={() => {
              refresh();
              refreshOrders();
            }}
          >
            Refresh
          </Button>
        </div>
        {orders._tag === "Success" ? (
          orders.value.items.length === 0 ? (
            <p className="text-muted-foreground">No payments yet.</p>
          ) : (
            orders.value.items.map((order) => (
              <Link
                key={order.id}
                to={`/billing/orders/${order.id}?space=${encodeURIComponent(space)}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-action-panel nested-controls bg-muted p-(--action-inset)"
              >
                <span>
                  <span className="block font-medium">
                    {dollars(order.amountCents / 100)}
                  </span>
                  <time className="text-body-medium text-muted-foreground">
                    {new Date(order.createdAt).toLocaleString()}
                  </time>
                </span>
                <span className="text-body-medium">{labels[order.status]}</span>
              </Link>
            ))
          )
        ) : orders._tag === "Failure" ? (
          <p role="alert">{errorMessage(orders.cause)}</p>
        ) : (
          <p>Loading orders…</p>
        )}
      </section>
    </main>
  );
}
function OrderStatus({
  space,
  id,
  onChange,
}: {
  space: string;
  id: string;
  onChange: () => void;
}) {
  const atom = billingOrderAtom(JSON.stringify([space, id]));
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const status = result._tag === "Success" ? result.value.status : undefined;
  useEffect(() => {
    if (status !== "pending" && status !== "processing") return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [status, refresh]);
  useEffect(() => {
    if (status) onChangeRef.current();
  }, [status]);
  return (
    <section
      aria-live="polite"
      className="space-y-2 rounded-surface bg-muted p-(--surface-inset)"
    >
      <h2 className="text-title-large font-medium">
        {status ? labels[status] : "Checking payment…"}
      </h2>
      <p className="break-all text-body-small text-muted-foreground">Order {id}</p>
      {status === "pending" && (
        <p>
          We have not confirmed payment yet. Leaving checkout does not cancel a
          completed payment.
        </p>
      )}
      {status === "processing" && (
        <p>
          You can close this page. Your credits will be added automatically.
        </p>
      )}
      {result._tag === "Failure" && (
        <>
          <p role="alert">{errorMessage(result.cause)}</p>
          <Button onClick={refresh}>Check again</Button>
        </>
      )}
    </section>
  );
}
