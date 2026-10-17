Below is a digest of a TypeScript codebase called {{name}}, about {{size}} lines. {{context}} The digest has the agent docs, {{cli_line}}and for every source file its size, its leading comment, and its exported declarations with their doc comments. Function bodies and unexported code are not included.

Evaluate the architecture, with the most attention on {{focus}}.

- Does the model name the right concepts, at the right granularity? Are there concepts the code clearly deals in that the model is missing, or model types the code doesn't seem to use?
- Do the module boundaries match the concepts? Look for dependencies that run the wrong way, the same concept under two names, the same thing modeled twice, and abstractions that only have one user.
- Does the CLI's command tree match the model?
- What would you change first, and why?

Give numbered findings, most important first, each pointing at the files or declarations involved. You only have signatures and comments, so say when a finding is inferred rather than visible. Skip style nits. Be direct: if something is well designed, a sentence saying so is enough. Don't pad.
