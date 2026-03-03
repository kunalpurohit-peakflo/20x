/**
 * MCP Server OAuth Provider
 *
 * Generic OAuth 2.0 provider for MCP servers.
 * Unlike Linear/HubSpot providers, this provider reads OAuth endpoints
 * dynamically from the MCP server's stored oauth_metadata configuration.
 *
 * Uses localhost redirect (like HubSpot) since MCP servers are generic
 * and don't have a custom URL scheme.
 */

import type { OAuthProvider, TokenResponse } from '../oauth-provider'

export class McpOAuthProvider implements OAuthProvider {
  readonly id = 'mcp-server'
  readonly requiresLocalhost = true

  generateAuthUrl(
    config: Record<string, unknown>,
    state: string,
    challenge: string,
    redirectUri?: string
  ): string {
    const params = new URLSearchParams({
      client_id: config.client_id as string,
      redirect_uri: redirectUri || 'http://localhost:3000/callback',
      response_type: 'code',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })

    if (config.scopes) {
      params.set('scope', config.scopes as string)
    }

    return `${config.authorization_endpoint as string}?${params}`
  }

  async exchangeCode(
    code: string,
    verifier: string,
    config: Record<string, unknown>,
    redirectUri?: string
  ): Promise<TokenResponse> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: config.client_id as string,
      redirect_uri: redirectUri || 'http://localhost:3000/callback',
      code,
      code_verifier: verifier
    }

    // Include client_secret if provided (some MCP servers require it)
    if (config.client_secret) {
      body.client_secret = config.client_secret as string
    }

    const response = await fetch(config.token_endpoint as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`MCP OAuth token exchange failed: ${response.status} ${errorText}`)
    }

    return await response.json()
  }

  async refreshToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    tokenEndpoint?: string
  ): Promise<TokenResponse> {
    if (!tokenEndpoint) {
      throw new Error('Token endpoint required for MCP OAuth refresh')
    }

    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken
    }

    if (clientSecret) {
      body.client_secret = clientSecret
    }

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`MCP OAuth token refresh failed: ${response.status} ${errorText}`)
    }

    return await response.json()
  }
}
