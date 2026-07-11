---
description: "Encrypt ForwardWidget JS modules via API"
---

# ForwardWidget Module Encryption

Encrypt JS module files using the ForwardWidget encryption API.

## Steps

1. Confirm the target file(s) contain `WidgetMetadata`
2. For each file, call:
   ```bash
   /usr/bin/curl -s -X POST https://widgetencrypt.inchmade.ai --data-binary @<filepath> -o <filepath>
   ```
3. Verify the output starts with `FWENC1`
4. Report the result

## Arguments

`$ARGUMENTS` — one or more file paths to encrypt (space separated). Files are encrypted in place.

## Example

```
/fw-encrypt widgets/tmdb.js
/fw-encrypt widgets/tmdb.js widgets/bangumi.js
```
