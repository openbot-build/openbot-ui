import assert from "node:assert/strict"
import { test } from "node:test"
import * as Identity from "../src/compatibility/Identity.ts"

const account = {
	userId: "stable-user",
	profile: { email: "fixture@example.test" },
	expiresAt: "2027-01-01T00:00:00Z",
	memberships: [
		{ organizationId: "another-organization", status: "active" },
		{ organizationId: "kay", status: "active" },
	],
}

test("Kay selects its configured native membership and keeps the stable account ID", () => {
	assert.deepEqual(Identity.session(account, "kay").identity, {
		userId: "stable-user",
		organizationId: "kay",
	})
	assert.throws(
		() => Identity.session(account, undefined),
		Identity.OrganizationUnavailable,
	)
	assert.throws(
		() => Identity.session(account, "missing"),
		Identity.MembershipDenied,
	)
	assert.throws(
		() =>
			Identity.session(
				{
					...account,
					memberships: [
						account.memberships[0],
						{ organizationId: "kay", status: "suspended" },
					],
				},
				"kay",
			),
		Identity.MembershipDenied,
	)
	assert.throws(
		() => Identity.session({ ...account, memberships: [] }, "kay"),
		Identity.MembershipDenied,
	)
})

test("revocation can identify a verified account after all memberships are removed", () => {
	assert.equal(
		Identity.accountId({ ...account, memberships: [] }),
		"stable-user",
	)
	assert.throws(() => Identity.accountId({ identity: { userId: "forged" } }))
})

test("verified provider avatars are preserved without accepting executable or credential-bearing URLs", () => {
	const image = "https://auth.example.test/avatar/user.png?version=2"
	const verified = Identity.session(
		{ ...account, profile: { name: "Sage", picture: image } },
		"kay",
	)
	assert.equal(Identity.avatarUrl(verified.profile), image)
	assert.equal(Identity.avatarUrl({ image }), image)
	for (const picture of [
		null,
		{},
		"",
		"javascript:alert(1)",
		"data:image/svg+xml,<svg/>",
		"https://user:secret@example.test/avatar",
		"/private/avatar",
		"not a URL",
	])
		assert.equal(Identity.avatarUrl({ picture }), null)
})

// A real, decoded 256 x 256 JPEG, encoded from a solid-color PNG with ImageIO.
const uploadedAvatar =
	"data:image/jpeg;base64," +
	"/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQA" +
	"AAABAAABAKADAAQAAAABAAABAAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmA" +
	"CZjs+EJ+/8AAEQgBAAEAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQE" +
	"AAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldY" +
	"WVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk" +
	"5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMR" +
	"BAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdo" +
	"aWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz" +
	"9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8P" +
	"D//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQA" +
	"EP/aAAwDAQACEQMRAD8A4+iiiv2Q/NwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA" +
	"KKKKACiiigD/0OPooor9kPzcKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAo" +
	"oooA/9Hj6KKK/ZD83CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/S" +
	"4+iiiv2Q/NwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0+Pooor9" +
	"kPzcKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9Tj6KKK/ZD83Cii" +
	"igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/V4+iiiv2Q/NwooooAKKKK" +
	"ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1uPooor9kPzcKKKKACiiigAooooA" +
	"KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9fj6KKK/ZD83CiiigAooooAKKKKACiiigAo" +
	"oooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Q4+iiiv2Q/NwooooAKKKKACiiigAooooAKKKKACii" +
	"igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0ePooor9kPzcKKKKACiiigAooooAKKKKACiiigAooooAKKKK" +
	"ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9Lj6KKK/ZD83CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA" +
	"KKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/T4+iiiv2Q/NwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAo" +
	"oooAKKKKACiiigAooooAKKKKACiiigD/1OPooor9kPzcKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii" +
	"igAooooAKKKKACiiigAooooA/9Xj6KKK/ZD83CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKK" +
	"ACiiigAooooAKKKKAP/W4+iiiv2Q/NwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA" +
	"KKKKACiiigD/2Q=="

test("a verified KAI uploaded JPEG remains the same avatar through the session adapter", () => {
	const verified = Identity.session(
		{ ...account, profile: { picture: uploadedAvatar } },
		"kay",
	)
	assert.equal(Identity.avatarUrl(verified.profile), uploadedAvatar)
	assert.equal(Identity.avatarUrl({ image: uploadedAvatar }), uploadedAvatar)
})

test("uploaded avatars reject noncanonical, non-JPEG and oversized data", () => {
	const prefix = "data:image/jpeg;base64,"
	const encoded = uploadedAvatar.slice(prefix.length)
	const jpeg = Buffer.from(encoded, "base64")
	const altered = Buffer.from(jpeg)
	altered[1] = 0
	const badPadding = encoded.slice(0, -3) + "R=="
	assert.equal(Buffer.from(badPadding, "base64").toString("base64"), encoded)
	for (const picture of [
		prefix,
		prefix + encoded.slice(0, -1),
		prefix + encoded + "\n",
		prefix + badPadding,
		prefix + Buffer.from("<svg onload=alert(1) />").toString("base64"),
		prefix + altered.toString("base64"),
		prefix + jpeg.subarray(0, -2).toString("base64"),
		prefix + Buffer.concat([jpeg, Buffer.from("<html>")]).toString("base64"),
		"data:image/png;base64," + encoded,
		"data:image/jpeg;charset=utf-8;base64," + encoded,
		"data:text/html;base64," + encoded,
	])
		assert.equal(Identity.avatarUrl({ picture }), null)
	// The first overflow has the same encoded length as the allowed byte limit.
	for (const length of [2 * 1024 * 1024 + 1, 2 * 1024 * 1024 + 4]) {
		const oversized = Buffer.alloc(length)
		jpeg.copy(oversized)
		oversized[length - 2] = 0xff
		oversized[length - 1] = 0xd9
		assert.equal(
			Identity.avatarUrl({ picture: prefix + oversized.toString("base64") }),
			null,
		)
	}
})
