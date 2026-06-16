# opencode config notes

## OpenRouter provider routing (privacy)

`opencode.json` pins each OpenRouter model to a `provider.only` allowlist of
**privacy-preserving providers**: US-based providers that do not train on
request data — currently `deepinfra`, `novita`, `fireworks`. (They don't offer
true Zero Data Retention; they retain briefly for abuse scanning and legal
compliance, but they don't train.) Verify a provider's stance before adding it;
OpenRouter's `/api/v1/providers` endpoint exposes HQ/datacenter but not the
train flag, so check the provider's own policy or a tracker like Opper.

### Why `allow_fallbacks` differs per model

- **deepseek/deepseek-v4-pro** — `allow_fallbacks: true`. Multiple providers in
  the allowlist host it, so fallback stays within the trusted set.
- **moonshotai/kimi-k2.7-code** — `allow_fallbacks: true`. As of 2026-06, both
  DeepInfra and Novita host it (Fireworks does not), so fallback stays within
  the trusted set.
- **z-ai/glm-5.2** — `allow_fallbacks: false`. As of 2026-06, GLM-5.2 is only
  hosted by **Z.AI** (first-party, Singapore HQ, consumer policy permits
  training) and **Io Net** (US HQ but decentralized — prompts run on
  third-party GPU nodes). Neither meets the privacy bar. Pinning it to the same
  trusted allowlist with fallbacks **off** means the request is **rejected**
  rather than silently routed to a provider we don't trust. If one of the
  trusted providers starts hosting GLM-5.2, it begins working automatically with
  no config change.

The rule: restrict to good providers; if none host the model, fail closed.
