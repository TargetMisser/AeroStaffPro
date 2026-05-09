## 2024-05-24 - Secure Storage Migration Data Lingering
**Vulnerability:** Legacy plaintext passwords migrated from AsyncStorage to SecureStore lingered in SQLite's unallocated space because `removeItem` does not zero out the physical storage.
**Learning:** AsyncStorage (SQLite-backed) marks rows as deleted but doesn't wipe them immediately. Sensitive plaintext data can be recovered from the device disk even after being "removed".
**Prevention:** Before removing sensitive data from unencrypted storage (like AsyncStorage), explicitly overwrite it with masked or empty values to forcefully overwrite the physical sectors.
