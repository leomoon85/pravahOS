# PravahOS AVB 2.0 & Titan M2 Key Management

This directory manages the cryptographic signing keys for Android Verified Boot (AVB 2.0) and Titan M2 custom Root-of-Trust enrollment for the Google Pixel 7 ("panther").

## Security Policy

> [!CRITICAL]
> **Zero Private Key Storage**:
> Private keys (`*.pem`, `*.key`, `*.priv`) must **NEVER** be committed to the git repository.
> Only the public key digest / public key payload (`pravah_avb_custom_key.bin`) used for `fastboot flash avb_custom_key` is staged here for development convenience.

## Generating Production AVB Signing Keys

To generate a 4096-bit RSA key pair for AVB 2.0:
```bash
# Generate private key in a secure external key directory outside repo
openssl genrsa -out /secure/keys/pravah_avb_rsa4096.pem 4096

# Extract public key for AVB metadata
avbtool extract_public_key \
  --key /secure/keys/pravah_avb_rsa4096.pem \
  --output build/panther/keys/pravah_avb_custom_key.bin
```

## Signing Boot Images
When building production release images:
```bash
export PRAVAH_SIGNING_KEY_PATH="/secure/keys/pravah_avb_rsa4096.pem"
./build/panther/build_kernel.sh
```
