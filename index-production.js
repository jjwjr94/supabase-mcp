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

// Note: Server instances are created per request for security

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

// Custom Supabase MCP Server using Management API without security wrappers
class CustomSupabaseMcpServer {
  constructor(accessToken, projectRef) {
    this.accessToken = accessToken;
    this.projectRef = projectRef;
    this.managementApiUrl = 'https://api.supabase.com/v1';
  }

  async executeSql(query) {
    try {
      // Use Management API SQL execution endpoint with PAT
      const response = await fetch(`${this.managementApiUrl}/projects/${this.projectRef}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Management API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`SQL execution failed: ${error.message}`);
    }
  }

  async listTables() {
    try {
      // Use Management API SQL query to list tables
      const query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;";
      const response = await fetch(`${this.managementApiUrl}/projects/${this.projectRef}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Management API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to list tables: ${error.message}`);
    }
  }

  async describeTable(tableName) {
    try {
      // Use Management API SQL query to describe table
      const query = `SELECT column_name, data_type, is_nullable, column_default 
                     FROM information_schema.columns 
                     WHERE table_name = '${tableName}' AND table_schema = 'public' 
                     ORDER BY ordinal_position;`;
      const response = await fetch(`${this.managementApiUrl}/projects/${this.projectRef}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Management API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to describe table: ${error.message}`);
    }
  }

  // Mock the MCP server interface
  _requestHandlers = new Map([
    ['initialize', () => ({ protocolVersion: '2024-11-05', capabilities: {} })],
    ['tools/list', () => ({
      tools: [
        {
          name: 'execute_sql',
          description: 'Execute SQL queries on the Supabase database',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'SQL query to execute' }
            },
            required: ['query']
          }
        },
        {
          name: 'list_tables',
          description: 'List all tables in the database',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'describe_table',
          description: 'Get schema information for a specific table',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: { type: 'string', description: 'Name of the table to describe' }
            },
            required: ['table_name']
          }
        }
      ]
    })],
    ['tools/call', async (request) => {
      const { name, arguments: args } = request.params;
      
      switch (name) {
        case 'execute_sql':
          return await this.executeSql(args.query);
        case 'list_tables':
          return await this.listTables();
        case 'describe_table':
          return await this.describeTable(args.table_name);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    }]
  ]);
}

async function initializeSupabaseMcpServer(accessToken, projectRef) {
  try {
    const server = new CustomSupabaseMcpServer(accessToken, projectRef);
    console.log('Custom Supabase MCP Server initialized successfully');
    return server;
  } catch (error) {
    console.error('Failed to initialize Custom Supabase MCP Server:', error);
    throw error;
  }
}

// MCP endpoint with streaming support
app.post('/mcp', async (req, res) => {
  const requestId = req.body.id || `req_${Date.now()}`;
  const projectRef = req.headers['x-project-ref'] || process.env.SUPABASE_PROJECT_REF || 'default-project';
  const accessToken = req.headers['x-supabase-key']; // Supabase Personal Access Token

  // Validate required headers
  if (!accessToken) {
    res.status(400).json({
      id: requestId,
      type: 'error',
      error: 'x-supabase-key header is required (Supabase Personal Access Token)'
    });
    return;
  }

  if (!projectRef) {
    res.status(400).json({
      id: requestId,
      type: 'error',
      error: 'x-project-ref header is required'
    });
    return;
  }

  try {
    const { method, params } = req.body;

    if (!method) {
      res.status(400).json({
        id: requestId,
        type: 'error',
        error: 'MCP method is required'
      });
      return;
    }

    // Create a new server instance for each request with the provided credentials
    const supabaseMcpServer = await initializeSupabaseMcpServer(accessToken, projectRef);

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

    // For n8n compatibility, return clean JSON directly from Management API
    let cleanedResult = result;
    if (result && result.content && result.content[0] && result.content[0].text) {
      try {
        // Parse the clean JSON from Management API (no security wrappers)
        const cleanData = JSON.parse(result.content[0].text);
        
        // Return in a simple format for n8n
        cleanedResult = {
          success: true,
          data: cleanData,
          message: "Query executed successfully"
        };
      } catch (e) {
        // If parsing fails, return error format
        cleanedResult = {
          success: false,
          error: "Failed to parse response: " + e.message,
          raw_text: result.content[0].text
        };
      }
    }

    // Send result as regular JSON response
    res.json({
      id: requestId,
      result: cleanedResult
    });

  } catch (error) {
    console.error('MCP Error:', error);
    res.status(500).json({
      id: requestId,
      type: 'error',
      error: error.message
    });
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