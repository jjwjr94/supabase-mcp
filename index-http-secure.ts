#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

interface StreamResponse {
  id: string;
  type: 'data' | 'error' | 'complete';
  data?: any;
  error?: string;
}

interface SecurityConfig {
  readOnly: boolean;
  allowedProjects: string[];
  allowedSchemas: string[];
  allowedTables: string[];
  blockedOperations: string[];
}

class SupabaseHttpServer {
  private app: express.Application;
  private port: number;
  private securityConfig: SecurityConfig;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.securityConfig = this.loadSecurityConfig();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private loadSecurityConfig(): SecurityConfig {
    const readOnly = process.env.SUPABASE_READ_ONLY === 'true';
    const allowedProjects = process.env.SUPABASE_ALLOWED_PROJECTS?.split(',') || [];
    const allowedSchemas = process.env.SUPABASE_ALLOWED_SCHEMAS?.split(',') || ['public'];
    const allowedTables = process.env.SUPABASE_ALLOWED_TABLES?.split(',') || [];
    const blockedOperations = process.env.SUPABASE_BLOCKED_OPERATIONS?.split(',') || [];

    return {
      readOnly,
      allowedProjects,
      allowedSchemas,
      allowedTables,
      blockedOperations
    };
  }

  private setupMiddleware() {
    // Security middleware - configure for Render deployment
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    }));
    
    // CORS for n8n integration - allow Render domains
    this.app.use(cors({
      origin: [
        'https://*.render.com',
        'https://*.n8n.cloud',
        'https://*.n8n.io',
        'http://localhost:3000',
        'http://localhost:5678' // n8n local development
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-supabase-token', 'x-project-ref']
    }));
    
    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    
    // Logging middleware
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  private validateProjectAccess(projectRef: string): void {
    if (this.securityConfig.allowedProjects.length > 0 && 
        !this.securityConfig.allowedProjects.includes(projectRef)) {
      throw new Error(`Access denied: Project ${projectRef} is not in the allowed projects list`);
    }
  }

  private validateReadOnlyOperation(operation: string): void {
    if (this.securityConfig.readOnly) {
      const writeOperations = [
        'apply_migration',
        'deploy_edge_function',
        'create_project',
        'pause_project',
        'restore_project',
        'create_branch',
        'delete_branch',
        'merge_branch',
        'reset_branch',
        'rebase_branch',
        'update_storage_config'
      ];

      if (writeOperations.includes(operation)) {
        throw new Error(`Operation '${operation}' is not allowed in read-only mode`);
      }
    }
  }

  private validateBlockedOperation(operation: string): void {
    if (this.securityConfig.blockedOperations.includes(operation)) {
      throw new Error(`Operation '${operation}' is explicitly blocked`);
    }
  }

  private validateSchemaAccess(schemas: string[]): void {
    if (this.securityConfig.allowedSchemas.length > 0) {
      const invalidSchemas = schemas.filter(schema => 
        !this.securityConfig.allowedSchemas.includes(schema)
      );
      if (invalidSchemas.length > 0) {
        throw new Error(`Access denied: Schemas ${invalidSchemas.join(', ')} are not allowed`);
      }
    }
  }

  private validateTableAccess(tables: string[]): void {
    if (this.securityConfig.allowedTables.length > 0) {
      const invalidTables = tables.filter(table => 
        !this.securityConfig.allowedTables.includes(table)
      );
      if (invalidTables.length > 0) {
        throw new Error(`Access denied: Tables ${invalidTables.join(', ')} are not allowed`);
      }
    }
  }

  private sanitizeSqlQuery(query: string): string {
    // Basic SQL injection prevention
    const dangerousPatterns = [
      /drop\s+table/i,
      /truncate\s+table/i,
      /delete\s+from/i,
      /update\s+.*\s+set/i,
      /create\s+table/i,
      /alter\s+table/i,
      /grant\s+/i,
      /revoke\s+/i
    ];

    // Always block dangerous operations regardless of read-only mode
    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new Error(`Dangerous operation detected: ${pattern.source}. Only SELECT and INSERT operations are allowed.`);
      }
    }

    // In read-only mode, also block INSERT operations
    if (this.securityConfig.readOnly) {
      const insertPattern = /insert\s+into/i;
      if (insertPattern.test(query)) {
        throw new Error('INSERT operations are not allowed in read-only mode');
      }
    }

    // Validate allowed operations
    const allowedPatterns = [
      /select\s+.*\s+from/i,
      /insert\s+into/i,
      /with\s+.*\s+select/i, // CTEs
      /explain\s+/i,
      /describe\s+/i
    ];

    const hasAllowedOperation = allowedPatterns.some(pattern => pattern.test(query));
    if (!hasAllowedOperation) {
      throw new Error('Only SELECT and INSERT operations are allowed');
    }

    return query;
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        version: '0.5.3',
        timestamp: new Date().toISOString(),
        message: 'Supabase MCP HTTP Server is running',
        security: {
          readOnly: this.securityConfig.readOnly,
          allowedProjects: this.securityConfig.allowedProjects.length > 0 ? this.securityConfig.allowedProjects.length : 'all',
          allowedSchemas: this.securityConfig.allowedSchemas,
          blockedOperations: this.securityConfig.blockedOperations
        }
      });
    });

    // Security configuration endpoint (for debugging)
    this.app.get('/security', (req, res) => {
      res.json({
        readOnly: this.securityConfig.readOnly,
        allowedProjects: this.securityConfig.allowedProjects,
        allowedSchemas: this.securityConfig.allowedSchemas,
        allowedTables: this.securityConfig.allowedTables,
        blockedOperations: this.securityConfig.blockedOperations
      });
    });

    // MCP HTTP Streaming endpoint - handles all MCP operations
    this.app.post('/mcp', async (req, res) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Set headers for streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      try {
        // Get Supabase credentials from request headers or environment
        const supabaseToken = req.headers['x-supabase-token'] as string || process.env.SUPABASE_ACCESS_TOKEN;
        const projectRef = req.headers['x-project-ref'] as string || process.env.SUPABASE_PROJECT_REF;
        
        if (!supabaseToken) {
          this.sendStreamResponse(res, requestId, 'error', null, 'Supabase access token required');
          res.end();
          return;
        }

        if (!projectRef) {
          this.sendStreamResponse(res, requestId, 'error', null, 'Supabase project reference required');
          res.end();
          return;
        }

        // Validate project access
        this.validateProjectAccess(projectRef);

        const { method, params } = req.body;

        if (!method) {
          this.sendStreamResponse(res, requestId, 'error', null, 'MCP method is required');
          res.end();
          return;
        }

        // Send initial response
        this.sendStreamResponse(res, requestId, 'data', { 
          message: `Starting MCP operation: ${method}`,
          method: method,
          params: params,
          projectRef: projectRef,
          security: {
            readOnly: this.securityConfig.readOnly,
            allowedSchemas: this.securityConfig.allowedSchemas
          }
        });

        let result;
        
        // Handle different MCP methods
        switch (method) {
          case 'tools/list':
            result = {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                tools: this.getAvailableTools()
              }
            };
            break;
            
          case 'tools/call':
            if (!params || !params.name) {
              this.sendStreamResponse(res, requestId, 'error', null, 'Tool name is required for tools/call');
              res.end();
              return;
            }

            // Validate operation
            this.validateReadOnlyOperation(params.name);
            this.validateBlockedOperation(params.name);

            // Additional validations for specific tools
            if (params.name === 'list_tables' && params.arguments?.schemas) {
              this.validateSchemaAccess(params.arguments.schemas);
            }

            if (params.name === 'execute_sql' && params.arguments?.query) {
              this.sanitizeSqlQuery(params.arguments.query);
            }

            result = await this.executeTool(params.name, params.arguments || {}, projectRef);
            break;
            
          case 'prompts/list':
            result = {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                prompts: [
                  {
                    name: "database_schema_analysis",
                    description: "Analyze database schema and provide insights"
                  }
                ]
              }
            };
            break;
            
          case 'prompts/get':
            if (!params || !params.name) {
              this.sendStreamResponse(res, requestId, 'error', null, 'Prompt name is required for prompts/get');
              res.end();
              return;
            }
            
            result = {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                description: `Prompt: ${params.name}`,
                arguments: []
              }
            };
            break;
            
          case 'resources/list':
            result = {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                resources: [
                  {
                    uri: "supabase://project",
                    name: "Supabase Project",
                    description: "Main Supabase project resource"
                  }
                ]
              }
            };
            break;
            
          case 'resources/read':
            if (!params || !params.uri) {
              this.sendStreamResponse(res, requestId, 'error', null, 'Resource URI is required for resources/read');
              res.end();
              return;
            }
            
            result = {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                contents: [
                  {
                    uri: params.uri,
                    mimeType: "text/plain",
                    text: `Resource content for ${params.uri}`
                  }
                ]
              }
            };
            break;
            
          default:
            this.sendStreamResponse(res, requestId, 'error', null, `Unsupported MCP method: ${method}`);
            res.end();
            return;
        }

        // Send the result
        this.sendStreamResponse(res, requestId, 'data', result);

        // Send completion
        this.sendStreamResponse(res, requestId, 'complete', { message: 'MCP operation completed' });

      } catch (error) {
        console.error('Error executing MCP operation:', error);
        this.sendStreamResponse(res, requestId, 'error', null, error instanceof Error ? error.message : 'Unknown error');
      }

      res.end();
    });

    // Error handling middleware
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  private getAvailableTools() {
    const baseTools = [
      {
        name: "list_tables",
        description: "List all tables in the database",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Supabase project ID" },
            schemas: { 
              type: "array", 
              items: { type: "string" }, 
              description: "Database schemas to include",
              default: this.securityConfig.allowedSchemas
            }
          }
        }
      },
      {
        name: "execute_sql",
        description: "Execute raw SQL queries",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "SQL query to execute" },
            project_id: { type: "string", description: "Supabase project ID" }
          },
          required: ["query", "project_id"]
        }
      },
      {
        name: "get_project_url",
        description: "Get the API URL for a project",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Supabase project ID" }
          },
          required: ["project_id"]
        }
      },
      {
        name: "get_anon_key",
        description: "Get the anonymous API key for a project",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Supabase project ID" }
          },
          required: ["project_id"]
        }
      }
    ];

    // Add write operations only if not in read-only mode
    if (!this.securityConfig.readOnly) {
      baseTools.push({
        name: "apply_migration",
        description: "Apply a SQL migration to the database",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Supabase project ID" },
            name: { type: "string", description: "Migration name" },
            query: { type: "string", description: "SQL migration query" }
          },
          required: ["project_id", "name", "query"]
        } as any
      });
    }

    return baseTools;
  }

  private async executeTool(toolName: string, toolArguments: any, projectRef: string) {
    // Simulate tool execution with security context
    const securityContext = {
      readOnly: this.securityConfig.readOnly,
      allowedSchemas: this.securityConfig.allowedSchemas,
      projectRef: projectRef
    };

    return {
      jsonrpc: "2.0",
      id: `tool_${Date.now()}`,
      result: {
        content: [
          {
            type: "text",
            text: `Tool '${toolName}' executed successfully with parameters: ${JSON.stringify(toolArguments)}\n\nSecurity Context: ${JSON.stringify(securityContext, null, 2)}`
          }
        ]
      }
    };
  }

  private sendStreamResponse(res: express.Response, id: string, type: 'data' | 'error' | 'complete', data?: any, error?: string) {
    const response: StreamResponse = {
      id,
      type,
      data,
      error
    };
    
    res.write(`data: ${JSON.stringify(response)}\n\n`);
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`Supabase MCP HTTP Server running on port ${this.port}`);
      console.log(`Health check: http://localhost:${this.port}/health`);
      console.log(`Security config: http://localhost:${this.port}/security`);
      console.log(`MCP endpoint: POST http://localhost:${this.port}/mcp`);
      console.log(`Security: Read-only=${this.securityConfig.readOnly}, Allowed projects=${this.securityConfig.allowedProjects.length || 'all'}`);
    });
  }
}

// Main execution
async function main() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = new SupabaseHttpServer(port);
  server.start();
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
