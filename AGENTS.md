# Intro Maker

## Canonical code and deployment

- The GitHub repository `calbogdanov-dotcom/intro-maker` is the source of truth. Work from its latest commits, use branches and pull requests, and sync changes to GitHub. Local folders are working checkouts.
- Production code is the `main` branch. `render.yaml` describes automatic Render deployments after CI checks pass. A committed Blueprint is not proof that a Render service is running; inspect the connected Render workspace and deployments.
- Before any domain cutover, verify the new host and migrate every stored record and media object, preserving iteration, slot and comment identities. Runtime data and secrets must stay out of GitHub.
- The existing production instance can remain on Sites during migration. Do not treat a temporary empty Render instance as a completed migration or point the domain at it before data verification.

## Product behavior

- Preserve the version 1 canvas animation renderer and existing motion behavior. Neutral ease-in, ease-out and speed settings must preserve original timing.
- Shared editing is intentional for the current hosted project. The Render Blueprint enables `INTRO_MAKER_SHARED_EDITING=true`: visitors can open the editor/uploader, save, upload and explicitly publish without signing in. Same-origin write checks and owner-only comment moderation remain required.
- Standalone private mode remains available when shared editing is disabled. Both modes require meaningful access tests when changing auth or routing.
- Preserve shared-save merging, same-item conflict protection and local unsaved work. Never retry a stale complete library snapshot against a new revision without merging.
- Publishing code and publishing a review iteration are different actions. Only explicit iteration publication changes review boards. Draft settings do not belong in published review records.
- Logo and jingle boards, media and feedback use separate namespaces. Preserve existing recording references, anonymous removal receipts and owner moderation.
- Keep generic bundled artwork in the public source. Client-specific logos, presets, uploads and feedback are migrated separately as runtime data.
- Run `npm test` and `npm run validate` for relevant changes. Do not edit the archived or separately installed native Mac apps as part of web changes.
