---
name: nexus-question
description: Answer a question about how something works in the Oxide external API in Nexus
---

# Oxide external API Q&A

When answering a question about how something works in the API, you need look at relevant code by following the call chain down from the handlers of the relevant endpoints.

## Key paths

* `nexus/external-api/output/nexus_tags.txt`: concise list of all API endpoints. Helpful because the other files are very big. Find operation IDs in here and grep for them in the other files.
* `nexus/external-api/src/lib.rs`: Dropshot API trait definition showing paths, operation IDs, and request body, response body, and query param types
* `nexus/src/external_api/http_entrypoints.rs`: endpoint handler definitions
* `openapi/nexus/nexus-latest.json`: symlink to current API schema
* `nexus/tests/integration_tests`: you may need to look at integration tests to verify certain behaviors
