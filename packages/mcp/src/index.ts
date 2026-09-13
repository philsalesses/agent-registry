/**
 * ans-mcp as a library: the same tools the `ans-mcp` stdio server and the
 * remote /mcp endpoint expose, for embedding in your own MCP server.
 */
export { AnsApiError, AnsHttp, DEFAULT_API_URL, DEFAULT_WEB_URL, serverPathname, type AnsHttpOptions, type AnsIdentity, type AnsRequestOptions, type AuthMode, type FetchLike } from './shared/client';
export {
  ANS_MCP_VERSION,
  ANS_POLICY_RULES,
  ANS_SERVER_INSTRUCTIONS,
  ANS_SKILL_SHORT,
  RECEIPT_LINE_RULE,
  ToolRefusal,
  agentRefFrom,
  cleanReceiptText,
  deriveHandle,
  handleWithSuffix,
  memorySpendLedger,
  offerRefFrom,
  receiptIdFrom,
  registerAnsTools,
  type AnsToolsContext,
  type AnsToolsHandle,
  type RegisteredCredentials,
  type SpendLedger,
} from './shared/tools';
export { backupCredentials, capMicrosOf, defaultCredentialsPath, fileSpendLedger, readCredentials, validateCredentials, writeCredentials, type AnsCredentials, type CredentialsRead } from './credentials';
export { createStdioServer, runStdioServer, type StdioServerOptions } from './server';
