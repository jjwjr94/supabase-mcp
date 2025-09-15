const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const https = require('https');

const app = express();
const port = process.env.PORT || 10000;

// Security configuration
const securityConfig = {
  readOnly: process.env.SUPABASE_READ_ONLY === 'true',
  allowedProjects: process.env.SUPABASE_ALLOWED_PROJECTS ? process.env.SUPABASE_ALLOWED_PROJECTS.split(',') : null,
  allowedSchemas: process.env.SUPABASE_ALLOWED_SCHEMAS ? process.env.SUPABASE_ALLOWED_SCHEMAS.split(',') : null,
  allowedTables: process.env.SUPABASE_ALLOWED_TABLES ? process.env.SUPABASE_ALLOWED_TABLES.split(',') : null,
  blockedOperations: process.env.SUPABASE_BLOCKED_OPERATIONS ? process.env.SUPABASE_BLOCKED_OPERATIONS.split(',') : []
};

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5678'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-project-ref']
}));
app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    message: 'Supabase MCP HTTP Server is running',
    security: {
      readOnly: securityConfig.readOnly,
      allowedProjects: securityConfig.allowedProjects ? securityConfig.allowedProjects.length : 'all',
      allowedSchemas: securityConfig.allowedSchemas ? securityConfig.allowedSchemas.length : 'all',
      allowedTables: securityConfig.allowedTables ? securityConfig.allowedTables.length : 'all'
    }
  });
});

// Supabase API helper functions
function makeSupabaseRequest(projectRef, apiKey, endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = `https://${projectRef}.supabase.co${endpoint}`;
    const options = {
      method: method,
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const req = https.request(url, options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Supabase API error: ${parsed.message || responseData}`));
          }
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Security validation functions
function validateProjectAccess(projectRef) {
  if (!securityConfig.allowedProjects) return true;
  return securityConfig.allowedProjects.includes(projectRef);
}

function validateApiKey(apiKey) {
  if (!apiKey) {
    throw new Error('API key is required');
  }
  // Basic validation - should be a JWT token
  if (!apiKey.startsWith('eyJ')) {
    throw new Error('Invalid API key format');
  }
  return true;
}

function validateReadOnlyOperation(toolName) {
  if (!securityConfig.readOnly) return true;
  const writeOperations = ['apply_migration', 'execute_sql_insert', 'execute_sql_update', 'execute_sql_delete'];
  return !writeOperations.includes(toolName);
}

function validateBlockedOperation(toolName) {
  return !securityConfig.blockedOperations.includes(toolName);
}

function sanitizeSqlQuery(query) {
  const upperQuery = query.toUpperCase().trim();
  
  // Always block dangerous operations
  const dangerousPatterns = [
    'DROP TABLE', 'TRUNCATE TABLE', 'DELETE FROM', 'UPDATE ', 'CREATE TABLE', 
    'ALTER TABLE', 'GRANT ', 'REVOKE ', 'DROP DATABASE', 'DROP SCHEMA'
  ];
  
  for (const pattern of dangerousPatterns) {
    if (upperQuery.includes(pattern)) {
      throw new Error(`Dangerous SQL operation blocked: ${pattern}`);
    }
  }
  
  // Block INSERT if in read-only mode
  if (securityConfig.readOnly && upperQuery.includes('INSERT INTO')) {
    throw new Error('INSERT operations are blocked in read-only mode');
  }
  
  // Allow SELECT, INSERT (if not read-only), WITH, EXPLAIN, DESCRIBE
  const allowedPatterns = ['SELECT ', 'INSERT INTO', 'WITH ', 'EXPLAIN ', 'DESCRIBE '];
  const isAllowed = allowedPatterns.some(pattern => upperQuery.startsWith(pattern));
  
  if (!isAllowed) {
    throw new Error('Only SELECT, INSERT, WITH, EXPLAIN, and DESCRIBE operations are allowed');
  }
  
  return query;
}

// MCP tools implementation
const mcpTools = {
  'tools/list': () => ({
    tools: [
      {
        name: 'execute_sql',
        description: 'Execute SQL queries on Supabase database',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'SQL query to execute' },
            project_id: { type: 'string', description: 'Supabase project reference' }
          },
          required: ['query', 'project_id']
        }
      },
      {
        name: 'list_tables',
        description: 'List all tables in the database',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'Supabase project reference' }
          },
          required: ['project_id']
        }
      },
      {
        name: 'describe_table',
        description: 'Get table schema and column information',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: { type: 'string', description: 'Name of the table' },
            project_id: { type: 'string', description: 'Supabase project reference' }
          },
          required: ['table_name', 'project_id']
        }
      }
    ]
  }),

  'execute_sql': async (params, apiKey) => {
    const { query, project_id } = params;
    
    if (!validateProjectAccess(project_id)) {
      throw new Error(`Access denied for project: ${project_id}`);
    }
    
    validateApiKey(apiKey);
    const sanitizedQuery = sanitizeSqlQuery(query);
    
    try {
      // Execute SQL query via Supabase REST API
      const result = await makeSupabaseRequest(
        project_id, 
        apiKey, 
        `/rest/v1/rpc/execute_sql`, 
        'POST', 
        { query: sanitizedQuery }
      );
      
      return {
        content: [{
          type: 'text',
          text: `SQL query executed successfully:\n\n${sanitizedQuery}\n\nResult: ${JSON.stringify(result, null, 2)}`
        }]
      };
    } catch (error) {
      // Fallback: try direct SQL execution via REST API
      try {
        const result = await makeSupabaseRequest(
          project_id, 
          apiKey, 
          `/rest/v1/`, 
          'POST', 
          { query: sanitizedQuery }
        );
        
        return {
          content: [{
            type: 'text',
            text: `SQL query executed successfully:\n\n${sanitizedQuery}\n\nResult: ${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (fallbackError) {
        throw new Error(`SQL execution failed: ${fallbackError.message}`);
      }
    }
  },

  'list_tables': async (params, apiKey) => {
    const { project_id } = params;
    
    if (!validateProjectAccess(project_id)) {
      throw new Error(`Access denied for project: ${project_id}`);
    }
    
    validateApiKey(apiKey);
    
    try {
      // Get table information from Supabase
      const result = await makeSupabaseRequest(
        project_id, 
        apiKey, 
        `/rest/v1/`, 
        'GET'
      );
      
      // Extract table names from the response
      const tables = result.map ? result.map(item => item.table_name || item.name).filter(Boolean) : [];
      
      return {
        content: [{
          type: 'text',
          text: `Tables in project ${project_id}:\n\n${tables.length > 0 ? tables.map(t => `- ${t}`).join('\n') : 'No tables found or accessible with current permissions'}`
        }]
      };
    } catch (error) {
      // Fallback: return a basic message
      return {
        content: [{
          type: 'text',
          text: `Could not retrieve table list for project ${project_id}. Error: ${error.message}`
        }]
      };
    }
  },

  'describe_table': async (params, apiKey) => {
    const { table_name, project_id } = params;
    
    if (!validateProjectAccess(project_id)) {
      throw new Error(`Access denied for project: ${project_id}`);
    }
    
    validateApiKey(apiKey);
    
    try {
      // Get table schema information from Supabase
      const result = await makeSupabaseRequest(
        project_id, 
        apiKey, 
        `/rest/v1/${table_name}?limit=1`, 
        'GET'
      );
      
      // Get column information from the first row or metadata
      const columns = result && result.length > 0 ? Object.keys(result[0]) : [];
      
      return {
        content: [{
          type: 'text',
          text: `Table: ${table_name}\nProject: ${project_id}\n\nColumns:\n${columns.length > 0 ? columns.map(col => `- ${col}`).join('\n') : 'No columns found or table not accessible'}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Could not retrieve schema for table ${table_name} in project ${project_id}. Error: ${error.message}`
        }]
      };
    }
  }
};

// MCP endpoint with streaming support
app.post('/mcp', async (req, res) => {
  const requestId = req.body.id || `req_${Date.now()}`;
  
  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
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

    // Validate API key for tool calls
    if (method === 'tools/call' && !apiKey) {
      res.write(`data: ${JSON.stringify({
        id: requestId,
        type: 'error',
        error: 'API key is required for tool calls'
      })}\n\n`);
      res.end();
      return;
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
        hasApiKey: !!apiKey,
        note: "API key authentication enabled"
      }
    })}\n\n`);

    // Execute the MCP method
    let result;
    
    if (method === 'tools/list') {
      result = mcpTools['tools/list']();
    } else if (method === 'tools/call') {
      const { name, arguments: toolArguments } = params;
      
      if (!validateReadOnlyOperation(name)) {
        throw new Error(`Operation '${name}' is blocked in read-only mode`);
      }
      
      if (!validateBlockedOperation(name)) {
        throw new Error(`Operation '${name}' is blocked by configuration`);
      }
      
      if (mcpTools[name]) {
        result = await mcpTools[name](toolArguments, apiKey);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
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
  }

  res.end();
});

// Start server
app.listen(port, () => {
  console.log(`Supabase MCP HTTP Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`MCP endpoint: POST http://localhost:${port}/mcp`);
  console.log(`Security: Read-only mode: ${securityConfig.readOnly}`);
  console.log(`Security: Allowed projects: ${securityConfig.allowedProjects ? securityConfig.allowedProjects.join(', ') : 'all'}`);
});