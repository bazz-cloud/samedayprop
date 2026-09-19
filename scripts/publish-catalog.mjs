/**
 * Publish any plan whose terms changed in code since the last deploy.
 *
 * Runs on every deploy, not just an empty database: approving a lifetime cap or
 * moving a risk figure in plans.ts otherwise never reaches the published plan
 * versions, and the payout engine keeps enforcing the old terms.
 *
 * Old versions are superseded, never edited. Orders point at the version they
 * were sold under, so an existing customer's contract is not rewritten.
 */
const { publishCatalogIfEmpty, publishCatalogRevisions } = await import(
  '../src/server/services/catalog-service.ts'
);

const first = await publishCatalogIfEmpty();
if (first.plans > 0 || first.addons > 0) {
  console.log(`Published ${first.plans} plan versions and ${first.addons} add-on versions.`);
}

const revisions = await publishCatalogRevisions();
if (revisions.length === 0) {
  console.log('Catalog is current; no plan terms changed.');
} else {
  console.log(`Published ${revisions.length} plan revision(s):`);
  for (const r of revisions) console.log(`  ${r.planKey}: v${r.fromVersion} -> v${r.toVersion}`);
}
process.exit(0);
