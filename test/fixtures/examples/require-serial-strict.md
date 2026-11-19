# Service Agreement

This agreement is made between **Example Corp** ("Provider") and **Alice** ("Client").

1. The Provider will deliver the service described in Appendix A.
2. The Client will pay the fees listed in Appendix B within 30 days.

| Item | Fee |
| --- | --- |
| Setup | 1,000 USD |
| Monthly | 200 USD |

日本語の本文も UTF-8 でそのまま署名されます。

<!-- md-signature
v: 0.0.4
method: git-hosting
signer: github.com/alice
key_fp: SHA256:bbXpuKG6zhzdmnxq256TlqzFBzRl2f6OOg722cYNbU8
role: author
ts: 2026-11-16T09:00:00Z
require: |
  order strict
  step 1
  dns:example.com approver
  step 2
  tofu:bob@laptop reviewer
alg: ed25519
hash: sha256:f06c734545219e83074ab04481e4b4715054a8f1ac88367c90d2ce24bc76705c
sig: |
  base64:gK6s0acsFLakc7FTrpMdAp11AzFm9U4cSH+XMbFFh/jhmuJqSSiCGYtoV6gr0jFCAVdaM
  OLqgF4YxgHu+/9RDw==
-->
<!-- md-signature
v: 0.0.4
method: tofu
signer: bob@laptop
pubkey: ed25519:/FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU=
role: reviewer
ts: 2026-11-16T09:20:00Z
alg: ed25519
hash: sha256:9f7c24a1910b49b1702ace609c8a3cb9a48221de98d4576ab0f70b3fb13d629e
sig: |
  base64:MSJl2O+xcQqAArlBeIUzlz7s/WT5UyhwXuACEGkw9A0DSqlYGkJS/ByVV17IdsaVweBih
  RpJKrnPqL8k/ykADg==
-->
<!-- md-signature
v: 0.0.4
method: dns
signer: example.com
selector: 2026
role: approver
ts: 2026-11-16T09:30:00Z
alg: ed25519
hash: sha256:7222e4cacaac658e339befb580eff07c5ded143c5ddb40a754b486978f54a8a8
sig: |
  base64:Zktu+v0kx2F38ehijL3HYRzi4v7rJJI5mtoQjrWbF7GBfCFHwpM7Sdss33B4FJc4rH79w
  pCqS6TBTqGQSWxDBg==
-->
