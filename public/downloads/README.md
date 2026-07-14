# Generated endpoint downloads

`npm run agent:build:windows` places the universal self-contained Windows x64 agent and its SHA-256 file here. Generated executables and checksums are intentionally ignored by Git. The Docker build produces the same base executable before the Next.js production build; the authenticated download API appends a scoped enrollment package to create each zero-touch endpoint download.
