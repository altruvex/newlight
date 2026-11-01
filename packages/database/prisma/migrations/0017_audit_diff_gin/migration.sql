-- 0017  Index the audit diff for price history
--
-- Every price change is one `product.bulk_reprice` row in admin_audit_log whose diff lists
-- {sku, from, to}. The product page's price history asks "which rows mention this SKU" with a
-- jsonb containment test (`diff @> {"changes":[{"sku": …}]}`). Without an index that test runs
-- against every reprice row ever written, and the log only grows. A GIN index with
-- jsonb_path_ops answers containment directly and is the smallest GIN variant (it supports @>
-- only, which is all this query uses).
--
-- The table is small and admin-written; a plain CREATE INDEX briefly blocks audit inserts while
-- it builds, which is acceptable here.

CREATE INDEX "admin_audit_log_diff_idx" ON "admin_audit_log" USING GIN ("diff" jsonb_path_ops);
