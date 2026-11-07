# Security

Do not post API keys, user workspaces, private character data, or unredacted logs in public issues. A reproducible issue should use synthetic data and a separate `MORI_DATA_DIR`.

For sensitive vulnerability reports, use this repository's GitHub private vulnerability reporting option when available. If it is unavailable, open an issue requesting a private contact without disclosing exploit details or secrets.

Mori stores provider keys separately using Electron `safeStorage` when secure encryption is available. Exported character bundles and workspace backups exclude those keys. Review generated or imported content before enabling it; external API calls use the provider configuration selected by the user.
