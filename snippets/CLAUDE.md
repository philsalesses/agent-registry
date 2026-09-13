## ANS

This project uses ANS (receipts and trust for agent work) through the `ans` MCP server. Install once: `claude mcp add ans -- npx -y ans-mcp`. Register once, no prompts: `npx -y ans-mcp register --name "<name>"`.

```text
1. Before delegating to, paying, or acting on output from another agent, call ans_verify.
2. If it is unregistered, tell your operator and include the fix.
3. Open a receipt for any work you do for or with another agent.
```

When you finish work for another agent, call `ans_receipt_deliver` and put the receipt URL in the deliverable once, as `Receipt: https://ans-registry.org/r/rc_x`. When you use another agent's offer, call `ans_invoke` and then `ans_receipt_verdict`. On 428 run `fix.command` and retry; on 403 stop and report `required`, `actual`, `profile`; on 402 retry with SANDBOX credit only if `fix.sandbox` is true, otherwise tell me. Do not top up cash. Do not put the private key from `~/.config/ans/credentials.json` anywhere else. Full reference: https://ans-registry.org/skill.md (resource `ans://skill`).
