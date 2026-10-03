# Changesets

All `@codelitdev/*` packages release together under one version (the `fixed` group in `config.json`; see ADR 0006). Releases use plain versions without prerelease tags, so every publish moves the `latest` npm tag.

Every publishable change needs a Changeset that describes its public effect. When a change requires product work, list it under a "Product changes" heading so products can apply it after updating.
