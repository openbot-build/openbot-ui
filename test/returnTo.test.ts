import assert from "node:assert/strict"
import { test } from "node:test"
import { safeReturn } from "../src/lib/returnTo.ts"
test("login returns stay on this origin after URL normalization", () => {
 for (const value of [null, "https://other.example", "//other.example", "/\\other.example", "/\n/other.example"]) assert.equal(safeReturn(value), "/")
 assert.equal(safeReturn("/invitations?invitation=one"), "/invitations?invitation=one")
 assert.equal(safeReturn("/admin#users"), "/admin#users")
})
