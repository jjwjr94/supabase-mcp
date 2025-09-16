# Supabase MCP HTTP Server

> HTTP streaming version of the Supabase MCP Server for deployment on Render and other cloud platforms.

This is a fork of the [official Supabase MCP Server](https://github.com/supabase-community/supabase-mcp) that adds HTTP streaming capabilities, making it suitable for deployment on cloud platforms like Render, Railway, or any Node.js hosting service.

## Features

- **HTTP Streaming**: Full MCP protocol support over HTTP with Server-Sent Events
- **Cloud Ready**: Optimized for deployment on Render and other cloud platforms
- **CORS Support**: Configured for integration with n8n and other automation tools
- **Security**: Helmet.js security middleware and proper CORS configuration
- **Backward Compatibility**: Legacy REST endpoints for easy integration

## Authentication

The Supabase MCP server requires a **Personal Access Token** from your Supabase account to access the Management API. This is different from your project's API keys.

### Getting Your Supabase Personal Access Token

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Click on your profile/account settings
3. Navigate to **Access Tokens**
4. Create a new Personal Access Token
5. Copy the token and pass it via the `x-supabase-key` header in your requests

### Security Design

- **No stored credentials**: The server doesn't store any access tokens
- **Per-request authentication**: Each request must include the PAT in the header
- **Multi-tenant support**: Different clients can use different PATs
- **Better security**: Tokens are not persisted in environment variables

### Getting Your Project Information

1. Go to your project in the Supabase Dashboard
2. Navigate to **Settings** > **General**
3. Copy the **Project Reference** (set as `SUPABASE_PROJECT_REF`)
4. Copy the **Database Password** (set as `SUPABASE_DB_PASSWORD`)
5. Copy the **Region** (set as `SUPABASE_REGION`)

## Quick Start

### Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/jjwjr94/supabase-mcp.git
   cd supabase-mcp
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp env.example .env
   # Edit .env with your Supabase credentials
   ```

3. **Build and start the server:**
   ```bash
   npm run build
   npm run start:http
   ```

4. **Test the server:**
   ```bash
   npm test
   ```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_PROJECT_REF` | No | Default Supabase Project Reference (can be overridden by header) |
| `SUPABASE_DB_PASSWORD` | No | Your Supabase Database Password |
| `SUPABASE_REGION` | No | Your Supabase Region (e.g., us-east-1) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Your Supabase Service Role Key |
| `SUPABASE_READ_ONLY` | No | Set to 'true' for read-only mode |
| `SUPABASE_FEATURES` | No | Comma-separated list of features to enable |
| `PORT` | No | Server port (default: 3000) |

### Required Headers

| Header | Required | Description |
|--------|----------|-------------|
| `x-supabase-key` | Yes | Your Supabase Personal Access Token |
| `x-project-ref` | Yes | Your Supabase Project Reference |

## API Endpoints

### Health Check
```
GET /health
```

### MCP Protocol (Primary)
```
POST /mcp
```

### Legacy REST Endpoints
```
GET /tools
POST /tools/execute
POST /tools/:toolName
```

## Deployment on Render

1. Connect your GitHub repository to Render
2. Create a new Web Service with the provided `render.yaml`
3. Set environment variables
4. Deploy!

## License

Apache-2.0 License
