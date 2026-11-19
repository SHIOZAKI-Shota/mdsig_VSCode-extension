# Changelog

## 0.2.0

- Uses `@mdsig/core` 0.0.5 (format 0.0.4).
- Signing as an email address (`method: directory`, SPEC 4.7) is enabled. The signer is lower-cased and the public key is embedded by default. Before signing, the extension checks that the key directory publishes the key and asks before signing with a key that is not published yet.
- New command "Register a Key with a Key Directory": sends the public key to the directory named by the email domain's `_mdsig` record, or to the first trusted directory. The key setup page links to it.
- A `tofu` key seen for the first time is no longer stored on its own: the CodeLens, hover, signature view, and sidebar show its fingerprint with "Trust…" (SPEC 4.4). New command "Manage Trusted Signers".
- The confirmation of new `tofu` keys and their fingerprints now come from `@mdsig/core` (`confirmNewTofuKeys`, `BlockResult.tofu`, `keyFingerprint`) instead of the extension's own store wrapper.
- Hidden comments, raw HTML, invisible characters, link reference definitions, mismatched links, and external images in the body are reported in the Problems panel (SPEC 9.5).
- The preview shows section markers as `§ <id>` instead of hidden comments.
- Passkey signatures show their `rp_id`.

## 0.1.0

- First version: verification with CodeLens, diagnostics, status bar, and hover; the signature view; the sidebar; the sign form and key setup; formatter warnings; hidden content in the Markdown preview.
