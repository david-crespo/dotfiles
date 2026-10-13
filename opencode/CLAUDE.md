# opencode config notes

## OpenRouter provider routing (privacy)

When configuring OpenRouter models in `opencode.json`, pin each model to a
`provider.only` allowlist of **privacy-preserving providers**: US-based
providers that do not train on request data — e.g. `deepinfra`, `novita`,
`fireworks`. (They don't offer true Zero Data Retention; they retain briefly for
abuse scanning and legal compliance, but they don't train.) Verify a provider's
stance before adding it; OpenRouter's `/api/v1/providers` endpoint exposes
HQ/datacenter but not the train flag, so check the provider's own policy or a
tracker like Opper.

Example (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "openrouter": {
      "models": {
        "moonshotai/kimi-k2.7-code": {
          "settings": {
            "provider": {
              "only": ["novita", "fireworks"],
              "allow_fallbacks": true
            }
          }
        }
      }
    }
  }
}
```

The rule: restrict to good providers (`allow_fallbacks: true` when multiple
providers in the allowlist host the model so fallback stays within the trusted
set); if none host the model, fail closed. Providers that have not met the bar
in the past: **Z.AI** (Singapore HQ, consumer policy permits training) and **Io
Net** (US HQ but decentralized; prompts run on third-party GPU nodes).
