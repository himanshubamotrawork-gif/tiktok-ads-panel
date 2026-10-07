function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  get appUrl() {
    return required("APP_URL").replace(/\/+$/, "");
  },
  get tokenEncryptionKey() {
    return required("TOKEN_ENCRYPTION_KEY");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get tiktokMcpUrl() {
    return process.env.TIKTOK_MCP_URL || "https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat";
  },
  get tiktokRedirectUri() {
    return `${this.appUrl}/api/tiktok/oauth/callback`;
  },
};
