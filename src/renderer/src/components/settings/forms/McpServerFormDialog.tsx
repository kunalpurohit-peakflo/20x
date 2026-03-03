import { useState, useEffect } from 'react'
import { Server, Globe, Loader2, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Checkbox } from '@/components/ui/Checkbox'
import { KeyValueEditor } from '../KeyValueEditor'
import { shellQuoteArg, parseShellArgs } from '../utils'
import { mcpServerApi } from '@/lib/ipc-client'
import type { McpServer, CreateMcpServerDTO, McpOAuthMetadata } from '@/types'

interface McpServerFormDialogProps {
  server?: McpServer
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateMcpServerDTO) => void
}

export function McpServerFormDialog({ server, open, onClose, onSubmit }: McpServerFormDialogProps) {
  const [name, setName] = useState(server?.name ?? '')
  const [type, setType] = useState<'local' | 'remote'>(server?.type ?? 'local')
  const [command, setCommand] = useState(server?.command ?? '')
  const [args, setArgs] = useState(server?.args.map(shellQuoteArg).join(' ') ?? '')
  const [environment, setEnvironment] = useState<Record<string, string>>(server?.environment ?? {})
  const [url, setUrl] = useState(server?.url ?? '')
  const [headers, setHeaders] = useState<Record<string, string>>(server?.headers ?? {})

  // OAuth state
  const serverOAuth = server?.oauth_metadata as McpOAuthMetadata | undefined
  const [oauthEnabled, setOauthEnabled] = useState(!!(serverOAuth?.client_id))
  const [oauthClientId, setOauthClientId] = useState(serverOAuth?.client_id ?? '')
  const [oauthClientSecret, setOauthClientSecret] = useState(serverOAuth?.client_secret ?? '')
  const [oauthAuthEndpoint, setOauthAuthEndpoint] = useState(serverOAuth?.authorization_endpoint ?? '')
  const [oauthTokenEndpoint, setOauthTokenEndpoint] = useState(serverOAuth?.token_endpoint ?? '')
  const [oauthScopes, setOauthScopes] = useState(serverOAuth?.scopes ?? '')
  const [isDiscovering, setIsDiscovering] = useState(false)

  useEffect(() => {
    if (open) {
      const oAuth = server?.oauth_metadata as McpOAuthMetadata | undefined
      setName(server?.name ?? '')
      setType(server?.type ?? 'local')
      setCommand(server?.command ?? '')
      setArgs(server?.args.map(shellQuoteArg).join(' ') ?? '')
      setEnvironment(server?.environment ?? {})
      setUrl(server?.url ?? '')
      setHeaders(server?.headers ?? {})
      setOauthEnabled(!!(oAuth?.client_id))
      setOauthClientId(oAuth?.client_id ?? '')
      setOauthClientSecret(oAuth?.client_secret ?? '')
      setOauthAuthEndpoint(oAuth?.authorization_endpoint ?? '')
      setOauthTokenEndpoint(oAuth?.token_endpoint ?? '')
      setOauthScopes(oAuth?.scopes ?? '')
    }
  }, [open, server?.id])

  const isValid = name.trim() && (type === 'local' ? command.trim() : url.trim())

  const handleDiscoverMetadata = async () => {
    if (!url.trim()) return
    setIsDiscovering(true)
    try {
      const metadata = await mcpServerApi.discoverOAuthMetadata(url.trim())
      if (metadata) {
        if (metadata.authorization_endpoint) setOauthAuthEndpoint(metadata.authorization_endpoint)
        if (metadata.token_endpoint) setOauthTokenEndpoint(metadata.token_endpoint)
      }
    } catch {
      // Silently ignore discovery failures
    } finally {
      setIsDiscovering(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return

    const data: CreateMcpServerDTO = { name: name.trim(), type }
    if (type === 'local') {
      data.command = command.trim()
      data.args = args.trim() ? parseShellArgs(args.trim()) : []
      if (Object.keys(environment).length > 0) data.environment = environment
    } else {
      data.url = url.trim()
      if (Object.keys(headers).length > 0) data.headers = headers

      // Include OAuth metadata if enabled
      if (oauthEnabled && oauthClientId.trim() && oauthAuthEndpoint.trim() && oauthTokenEndpoint.trim()) {
        data.oauth_metadata = {
          client_id: oauthClientId.trim(),
          client_secret: oauthClientSecret.trim(),
          authorization_endpoint: oauthAuthEndpoint.trim(),
          token_endpoint: oauthTokenEndpoint.trim(),
          scopes: oauthScopes.trim() || undefined
        }
      } else if (!oauthEnabled) {
        // Clear OAuth metadata when disabled
        data.oauth_metadata = undefined
      }
    }

    onSubmit(data)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{server ? 'Edit MCP Server' : 'New MCP Server'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="filesystem"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={type === 'local' ? 'default' : 'outline'}
                  onClick={() => setType('local')}
                  className="flex-1"
                >
                  <Server className="h-3.5 w-3.5 mr-1.5" /> Local
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={type === 'remote' ? 'default' : 'outline'}
                  onClick={() => setType('remote')}
                  className="flex-1"
                >
                  <Globe className="h-3.5 w-3.5 mr-1.5" /> Remote
                </Button>
              </div>
            </div>

            {type === 'local' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-command">Command</Label>
                  <Input
                    id="mcp-command"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-args">Arguments</Label>
                  <Input
                    id="mcp-args"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder='mcp-remote https://url --header "Authorization: Bearer token"'
                  />
                </div>
                <KeyValueEditor
                  label="Environment Variables"
                  value={environment}
                  onChange={setEnvironment}
                  keyPlaceholder="VAR_NAME"
                  valuePlaceholder="value"
                />
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-url">URL</Label>
                  <Input
                    id="mcp-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://mcp.example.com/sse"
                    required
                  />
                </div>
                <KeyValueEditor
                  label="Headers"
                  value={headers}
                  onChange={setHeaders}
                  keyPlaceholder="Header-Name"
                  valuePlaceholder="value"
                />

                {/* OAuth Configuration */}
                <div className="space-y-2 pt-1 border-t border-border">
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="mcp-oauth"
                      checked={oauthEnabled}
                      onCheckedChange={(checked) => setOauthEnabled(!!checked)}
                    />
                    <Label htmlFor="mcp-oauth" className="text-sm font-medium cursor-pointer">
                      Requires OAuth
                    </Label>
                  </div>

                  {oauthEnabled && (
                    <div className="space-y-2 pl-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!url.trim() || isDiscovering}
                        onClick={handleDiscoverMetadata}
                        className="text-xs"
                      >
                        {isDiscovering ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                        ) : (
                          <Search className="h-3 w-3 mr-1.5" />
                        )}
                        Auto-Discover Endpoints
                      </Button>

                      <div className="space-y-1.5">
                        <Label htmlFor="mcp-oauth-client-id" className="text-xs">Client ID</Label>
                        <Input
                          id="mcp-oauth-client-id"
                          value={oauthClientId}
                          onChange={(e) => setOauthClientId(e.target.value)}
                          placeholder="your-client-id"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mcp-oauth-client-secret" className="text-xs">Client Secret</Label>
                        <Input
                          id="mcp-oauth-client-secret"
                          value={oauthClientSecret}
                          onChange={(e) => setOauthClientSecret(e.target.value)}
                          placeholder="your-client-secret"
                          type="password"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mcp-oauth-auth-endpoint" className="text-xs">Authorization Endpoint</Label>
                        <Input
                          id="mcp-oauth-auth-endpoint"
                          value={oauthAuthEndpoint}
                          onChange={(e) => setOauthAuthEndpoint(e.target.value)}
                          placeholder="https://provider.com/oauth/authorize"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mcp-oauth-token-endpoint" className="text-xs">Token Endpoint</Label>
                        <Input
                          id="mcp-oauth-token-endpoint"
                          value={oauthTokenEndpoint}
                          onChange={(e) => setOauthTokenEndpoint(e.target.value)}
                          placeholder="https://provider.com/oauth/token"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mcp-oauth-scopes" className="text-xs">Scopes</Label>
                        <Input
                          id="mcp-oauth-scopes"
                          value={oauthScopes}
                          onChange={(e) => setOauthScopes(e.target.value)}
                          placeholder="read write (space-separated)"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!isValid}>
                {server ? 'Save' : 'Add'}
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
