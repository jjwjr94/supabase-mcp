# Deployment Guide

## Overview

This repository contains a HTTP streaming version of the Supabase MCP Server that can be deployed on Render and other cloud platforms.

## Files Created/Modified

### Core Files
- `index-http-simple.ts` - Main HTTP server implementation
- `package.json` - Updated with HTTP streaming dependencies
- `tsconfig.json` - TypeScript configuration
- `render.yaml` - Render deployment configuration
- `Dockerfile` - Container deployment
- `docker-compose.yml` - Local development with Docker

### Configuration Files
- `env.example` - Environment variables template
- `.gitignore` - Git ignore rules
- `README.md` - Project documentation
- `test-http-server.js` - Test script for HTTP endpoints

## Deployment Options

### 1. Render (Recommended)

1. **Connect Repository**: Link your GitHub repository to Render
2. **Create Web Service**: Use the provided `render.yaml` configuration
3. **Set Environment Variables**:
   - `SUPABASE_ACCESS_TOKEN`: Your Supabase Personal Access Token
   - `SUPABASE_PROJECT_REF`: Your Supabase Project Reference
   - `NODE_ENV`: `production`
   - `PORT`: `10000`

4. **Deploy**: Render will automatically build and deploy

### 2. Docker Deployment

```bash
# Build the image
docker build -t supabase-mcp-http .

# Run the container
docker run -p 3000:3000 \
  -e SUPABASE_ACCESS_TOKEN=your_token \
  -e SUPABASE_PROJECT_REF=your_project_ref \
  supabase-mcp-http
```

### 3. Local Development

```bash
# Install dependencies
npm install

# Set up environment
cp env.example .env
# Edit .env with your credentials

# Build and start
npm run build
npm run start:http
```

## API Endpoints

### Health Check
```
GET /health
```

### MCP Protocol (Primary)
```
POST /mcp
Headers: x-supabase-token, x-project-ref
Body: { "method": "tools/list", "params": {} }
```

### Legacy REST Endpoints
```
GET /tools
POST /tools/execute
POST /tools/:toolName
```

## Testing

```bash
# Test the server
npm test

# Or manually test with curl
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-supabase-token: your_token" \
  -H "x-project-ref: your_project_ref" \
  -d '{"method": "tools/list", "params": {}}'
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Yes | Supabase Personal Access Token |
| `SUPABASE_PROJECT_REF` | Yes | Supabase Project Reference |
| `SUPABASE_READ_ONLY` | No | Enable read-only mode |
| `SUPABASE_FEATURES` | No | Comma-separated feature list |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |

## Security Notes

- Never expose production data
- Use development projects for testing
- Keep access tokens secure
- Consider read-only mode for production
- The server includes CORS and security middleware

## Integration Examples

### n8n Integration
Use the HTTP Request node with:
- Method: POST
- URL: `https://your-app.onrender.com/mcp`
- Headers: `x-supabase-token`, `x-project-ref`
- Body: MCP protocol JSON

### curl Examples
```bash
# List tools
curl -X POST https://your-app.onrender.com/mcp \
  -H "Content-Type: application/json" \
  -H "x-supabase-token: your_token" \
  -H "x-project-ref: your_project_ref" \
  -d '{"method": "tools/list", "params": {}}'

# Execute tool
curl -X POST https://your-app.onrender.com/mcp \
  -H "Content-Type: application/json" \
  -H "x-supabase-token: your_token" \
  -H "x-project-ref: your_project_ref" \
  -d '{"method": "tools/call", "params": {"name": "list_tables", "arguments": {}}}'
```

## Troubleshooting

1. **Build Errors**: Ensure all dependencies are installed with `npm install`
2. **Runtime Errors**: Check environment variables are set correctly
3. **Connection Issues**: Verify Supabase credentials and project reference
4. **CORS Issues**: Check the CORS configuration in the server code

## Support

For issues related to:
- Core MCP functionality: [Original Supabase MCP Repository](https://github.com/supabase-community/supabase-mcp)
- HTTP streaming implementation: This repository
