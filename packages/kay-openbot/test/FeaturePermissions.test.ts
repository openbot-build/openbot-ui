import assert from "node:assert/strict"
import { test } from "node:test"
import catalog from "../src/FeatureCatalog.json" with { type: "json" }
import { visibleCatalog } from "../src/FeaturePermissions.ts"

const ids = (input: Omit<Parameters<typeof visibleCatalog>[0], "catalog">) =>
	new Set(visibleCatalog({ catalog, ...input }).map((entry) => entry.id))

test("the visible catalog follows core capabilities, not role names or read-to-write inference", () => {
	const member = ids({
		platformAdmin: false,
		resources: [{ kind: "Organization", actions: ["read"] }],
	})
	assert.ok(member.has("organization.getOrganization"))
	assert.ok(member.has("organization.listRoles"))
	assert.ok(member.has("modelProviders.getModelCatalog"))
	assert.ok(member.has("chats.sendMessage"))
	assert.ok(!member.has("organization.listMembers"))
	assert.ok(!member.has("organization.updateOrganization"))
	assert.ok(!member.has("organization.createRole"))
	assert.ok(!member.has("modelProviders.listModels"))
	assert.ok(!member.has("platform.getPlatformSettings"))
	const readOnly = ids({
		platformAdmin: false,
		resources: [
			{ kind: "Organization", actions: ["read"] },
			{ kind: "Member", actions: ["read"] },
			{ kind: "ModelProvider", actions: ["read"] },
			{ kind: "Usage", actions: ["read"] },
		],
	})
	assert.ok(readOnly.has("organization.listMembers"))
	assert.ok(readOnly.has("modelProviders.listModels"))
	assert.ok(readOnly.has("usage.getUsage"))
	assert.ok(!readOnly.has("organization.updateMember"))
	assert.ok(!readOnly.has("modelProviders.createModel"))
	assert.ok(!readOnly.has("budgets.createBudget"))
	const scopedAdmin = ids({
		platformAdmin: true,
		resources: [{ kind: "Role", actions: ["write"] }],
	})
	assert.ok(scopedAdmin.has("organization.createRole"))
	assert.ok(scopedAdmin.has("platform.updatePlatformSettings"))
	assert.ok(!scopedAdmin.has("organization.updateOrganization"))
	assert.ok(!scopedAdmin.has("organization.updateMember"))
})
