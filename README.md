# Supabase MCP HTTP Server

> HTTP streaming version of the Supabase MCP Server for deployment on Render and other cloud platforms.

This is a fork of the [official Supabase MCP Server](https://github.com/supabase-community/supabase-mcp) that adds HTTP streaming capabilities, making it suitable for deployment on cloud platforms like Render, Railway, or any Node.js hosting service.

## Features

- **HTTP Streaming**: Full MCP protocol support over HTTP with Server-Sent Events
- **Cloud Ready**: Optimized for deployment on Render and other cloud platforms
- **CORS Support**: Configured for integration with n8n and other automation tools
- **Security**: Helmet.js security middleware and proper CORS configuration
- **Backward Compatibility**: Legacy REST endpoints for easy integration

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
| `SUPABASE_ACCESS_TOKEN` | Yes | Your Supabase Personal Access Token |
| `SUPABASE_PROJECT_REF` | Yes | Your Supabase Project Reference |
| `SUPABASE_READ_ONLY` | No | Set to 'true' for read-only mode |
| `SUPABASE_FEATURES` | No | Comma-separated list of features to enable |
| `PORT` | No | Server port (default: 3000) |

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
