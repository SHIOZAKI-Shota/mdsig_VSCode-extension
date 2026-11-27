# Changelog

## 0.3.0

- Uses `@mdsig/core` 0.1.1 (format 0.1). Documents signed with format 0.0.x are reported as unsupported.
- Invisible characters are found by `@mdsig/core`: tag characters, ZWJ, ZWNJ, variation selectors, and Hangul fillers are now reported, except where they belong to an emoji or to a word in a script that uses joiners (Arabic, Indic, and others). Required signatures are described with the library's wording.
- Messages from the library (warnings, failure details, agreement details, signing errors) are shown in Japanese when VS Code runs in Japanese. A signature that could not be checked yet is told apart from one that is not valid in the Required tab.
- New agreement results: "Could not fully check" when a member list or the network needed for `require` was not available (`undetermined`), and "Not verified" when `require` uses rules this version does not support (`unsupported`). Both used to show as Verified.
- The Required tab is grouped by the signature that set `require`: order mode, steps, `any=`, patterns (`dns:*.example.com`), roles, `user_verified`, `member_of`, and `pubkey`, which block satisfied each line, and why other signatures did not count.
- The time of a signature comes from a later `tsa` block (`time`), in the CodeLens, hover, and signature view.
- `display_name` is shown next to the verified signer and marked "(self-declared)". The sign form has a display name field.
- New Table tab: for documents with `<!-- mdsig:signatures -->`, the signature table built from the verification result. The preview shows a placeholder at the marker instead of a table, and the marker is no longer reported as a hidden comment.
- Document-wide warnings from verification (an unclosed code fence, ignored table markers) are shown in the signature view and the Problems panel; warnings about one signature are in its hover and card.
- The sign form builds `require` values in the 0.1 syntax (`step`, `step any=2`, `order mode=…`, `role=`), explains the value as you type, and refuses to sign with errors. Signers are written in their canonical lower-case form and checked before signing; a document that ends inside an open code fence cannot be signed.
- With a timestamp, signing appends a separate `tsa` block after the signature block.
- Passkey details show user verification and whether the passkey is synced.
- Local resources are read from the percent-decoded path the core passes; paths containing `:` or `\` are refused.

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
