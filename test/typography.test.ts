import assert from "node:assert/strict"
import { test } from "node:test"
import { cn } from "../src/lib/cn.ts"

test("type roles keep text colors and allow size overrides", () => {
    assert.equal(cn("text-body-medium text-muted-foreground", "text-title-large"), "text-muted-foreground text-title-large")
    assert.equal(cn("text-label-large", "text-primary-foreground"), "text-label-large text-primary-foreground")
    assert.equal(cn("text-body-large md:text-body-medium", "md:text-title-small"), "text-body-large md:text-title-small")
})
