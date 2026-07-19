# Security policy

Report vulnerabilities or exposed credentials privately to the repository owner. Do not include keys, access tokens, personal locations, licence plates, or user photos in a public issue.

## Client keys and Firebase

`src/config/keys.js` must remain untracked. Use the example file only as a template.

Client-side Firebase configuration is not a substitute for access control. Enforce authorization in Firebase Security Rules, enable App Check where practical, and restrict the Google Maps/Directions key by application and API.

If a key was ever committed, deleting the current file does not remove it from history. Rotate or restrict the key immediately, review usage/billing, then follow GitHub's sensitive-data removal process and coordinate with every contributor who has a clone.
