// ROX AI — src/modules/teams
// Extension point for "Teams", "Organizations", and "Workspaces"
// (flags: teams, organizations, workspaces). Three separate flags
// because they can ship in stages (an org can exist with one default
// workspace before real multi-workspace support lands) but they share
// one module and one schema family (organizations -> workspaces ->
// workspace_members, see 12_extension_schema.sql) since a workspace
// without an org is not a case the data model needs to support.
//
// Every table this project already has (profiles, generation_jobs,
// credit_audit_log) gained a nullable org_id/workspace_id column in
// 12_extension_schema.sql specifically so this module can start
// scoping queries by org/workspace later without an ALTER TABLE on a
// live, populated table.

async function listOrganizationsForUser(/* userId */) {
  return [];
}

async function createOrganization(/* name, ownerUserId */) {
  throw Object.assign(new Error('Organizations are not implemented yet.'), { code: 'not_implemented' });
}

async function listWorkspaces(/* orgId */) {
  return [];
}

module.exports = { listOrganizationsForUser, createOrganization, listWorkspaces };
