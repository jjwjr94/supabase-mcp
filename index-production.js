const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'supabase-mcp-http-server'
  });
});

// Create Supabase MCP Server instance
let supabaseMcpServer = null;

// Custom transport for HTTP requests
class HttpTransport {
  constructor() {
    this.messageHandlers = [];
    this.started = false;
  }
  
  async start() {
    this.started = true;
    return Promise.resolve();
  }
  
  onMessage(handler) {
    this.messageHandlers.push(handler);
  }
  
  send(message) {
    // This will be handled by the HTTP endpoint
    return Promise.resolve();
  }
  
  async handleRequest(request) {
    // Process the request through all message handlers
    for (const handler of this.messageHandlers) {
      try {
        const response = await handler(request);
        if (response) {
          return response;
        }
      } catch (error) {
        console.error('Message handler error:', error);
      }
    }
    throw new Error('No handler found for request');
  }
}

async function initializeSupabaseMcpServer() {
  try {
    // Import the Supabase MCP server and platform using dynamic import for ES modules
    const { createSupabaseMcpServer } = await import('@supabase/mcp-server-supabase');
    const { createSupabaseApiPlatform } = await import('@supabase/mcp-server-supabase/platform/api');
    
    // Create the platform with API credentials
    const platform = createSupabaseApiPlatform({
      accessToken: process.env.SUPABASE_ACCESS_TOKEN
    });
    
    // Create the server with the platform
    supabaseMcpServer = createSupabaseMcpServer({
      platform: platform,
      projectId: process.env.SUPABASE_PROJECT_REF || 'default-project',
      readOnly: process.env.SUPABASE_READ_ONLY === 'true',
      features: process.env.SUPABASE_FEATURES ? process.env.SUPABASE_FEATURES.split(',') : undefined
    });
    
    // Create a custom transport
    const transport = new HttpTransport();
    
    // Connect the server to the transport
    await supabaseMcpServer.connect(transport);
    
    console.log('Supabase MCP Server initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Supabase MCP Server:', error);
    throw error;
  }
}

// MCP endpoint with streaming support
app.post('/mcp', async (req, res) => {
  const requestId = req.body.id || `req_${Date.now()}`;

  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, x-project-ref, x-supabase-key'
  });

  try {
    const { method, params } = req.body;
    const projectRef = req.headers['x-project-ref'] || process.env.SUPABASE_PROJECT_REF || 'default-project';
    const apiKey = req.headers['x-supabase-key'];

    if (!method) {
      res.write(`data: ${JSON.stringify({
        id: requestId,
        type: 'error',
        error: 'MCP method is required'
      })}\n\n`);
      res.end();
      return;
    }

    // Initialize server if not already done
    if (!supabaseMcpServer) {
      await initializeSupabaseMcpServer();
    }

    // Send initial response
    res.write(`data: ${JSON.stringify({
      id: requestId,
      type: 'data',
      data: {
        message: `Starting MCP operation: ${method}`,
        method: method,
        params: params,
        projectRef: projectRef,
        hasApiKey: !!apiKey
      }
    })}\n\n`);

    // Handle different MCP methods
    let result;
    
    if (method === 'initialize') {
      const initRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'initialize',
        params: params || {}
      };
      
      result = await supabaseMcpServer._requestHandlers.get('initialize')(initRequest);
      
    } else if (method === 'tools/list') {
      const listRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/list',
        params: {}
      };
      
      result = await supabaseMcpServer._requestHandlers.get('tools/list')(listRequest);
      
    } else if (method === 'tools/call') {
      const { name, arguments: toolArguments } = params;
      
      if (!name) {
        throw new Error('Tool name is required');
      }
      
      if (!toolArguments) {
        throw new Error('Tool arguments are required');
      }
      
      const callRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: name,
          arguments: toolArguments
        }
      };
      
      result = await supabaseMcpServer._requestHandlers.get('tools/call')(callRequest);
      
    } else {
      throw new Error(`Unknown MCP method: ${method}`);
    }

    // Send result
    res.write(`data: ${JSON.stringify({
      id: requestId,
      result: result
    })}\n\n`);

    // Send completion
    res.write(`data: ${JSON.stringify({
      id: requestId,
      type: 'complete'
    })}\n\n`);

  } catch (error) {
    console.error('MCP Error:', error);
    res.write(`data: ${JSON.stringify({
      id: requestId,
      type: 'error',
      error: error.message
    })}\n\n`);
  } finally {
    res.end();
  }
});

// Start server
app.listen(port, () => {
  console.log(`Supabase MCP HTTP Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`MCP endpoint: POST http://localhost:${port}/mcp`);
  console.log('Security: Read-only mode:', process.env.SUPABASE_READ_ONLY === 'true');
  console.log('Security: Allowed projects:', process.env.SUPABASE_ALLOWED_PROJECTS || 'all');
});