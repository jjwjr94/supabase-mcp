# Security Guide

## Overview

The Supabase MCP HTTP Server includes multiple layers of security safeguards to protect your data and prevent unauthorized access or modifications.

## Security Features

### 1. Read-Only Mode

**Environment Variable**: `SUPABASE_READ_ONLY=true`

When enabled, this mode prevents all write operations including:
- `apply_migration` - Database schema changes
- `deploy_edge_function` - Function deployments
- `create_project` - New project creation
- `pause_project` / `restore_project` - Project lifecycle operations
- `create_branch` / `delete_branch` / `merge_branch` - Branching operations
- `update_storage_config` - Storage configuration changes

**Example**:
```bash
# Enable read-only mode
export SUPABASE_READ_ONLY=true
```

### 2. Project Scoping

**Environment Variable**: `SUPABASE_ALLOWED_PROJECTS=project1,project2`

Restricts access to specific Supabase projects only.

**Example**:
```bash
# Allow only specific projects
export SUPABASE_ALLOWED_PROJECTS=abc123def456,xyz789uvw012
```

### 3. Schema Restrictions

**Environment Variable**: `SUPABASE_ALLOWED_SCHEMAS=public,auth`

Limits database operations to specific schemas only.

**Example**:
```bash
# Allow only public and auth schemas
export SUPABASE_ALLOWED_SCHEMAS=public,auth
```

### 4. Table-Level Restrictions

**Environment Variable**: `SUPABASE_ALLOWED_TABLES=users,posts,comments`

Restricts access to specific tables only.

**Example**:
```bash
# Allow only specific tables
export SUPABASE_ALLOWED_TABLES=users,posts,comments
```

### 5. Operation Blocking

**Environment Variable**: `SUPABASE_BLOCKED_OPERATIONS=apply_migration,deploy_edge_function`

Explicitly blocks specific operations even if they would normally be allowed.

**Example**:
```bash
# Block specific operations
export SUPABASE_BLOCKED_OPERATIONS=apply_migration,deploy_edge_function,create_project
```

### 6. SQL Injection Prevention

The server includes basic SQL injection prevention by:
- Detecting dangerous SQL patterns (DROP, TRUNCATE, DELETE, UPDATE, INSERT, CREATE, ALTER, GRANT, REVOKE)
- Blocking write operations in read-only mode
- Sanitizing SQL queries before execution

## Security Configuration Examples

### Development Environment (Permissive)
```bash
SUPABASE_READ_ONLY=false
SUPABASE_ALLOWED_PROJECTS=
SUPABASE_ALLOWED_SCHEMAS=public
SUPABASE_ALLOWED_TABLES=
SUPABASE_BLOCKED_OPERATIONS=
```

### Production Environment (Restrictive)
```bash
SUPABASE_READ_ONLY=true
SUPABASE_ALLOWED_PROJECTS=prod-project-123
SUPABASE_ALLOWED_SCHEMAS=public
SUPABASE_ALLOWED_TABLES=users,posts,comments
SUPABASE_BLOCKED_OPERATIONS=apply_migration,deploy_edge_function
```

### Analytics Environment (Read-Only)
```bash
SUPABASE_READ_ONLY=true
SUPABASE_ALLOWED_PROJECTS=analytics-project-456
SUPABASE_ALLOWED_SCHEMAS=public,analytics
SUPABASE_ALLOWED_TABLES=
SUPABASE_BLOCKED_OPERATIONS=
```

## Security Endpoints

### Health Check with Security Info
```
GET /health
```

Returns security configuration status:
```json
{
  "status": "ok",
  "security": {
    "readOnly": true,
    "allowedProjects": 1,
    "allowedSchemas": ["public"],
    "blockedOperations": ["apply_migration"]
  }
}
```

### Security Configuration
```
GET /security
```

Returns detailed security configuration:
```json
{
  "readOnly": true,
  "allowedProjects": ["prod-project-123"],
  "allowedSchemas": ["public"],
  "allowedTables": ["users", "posts"],
  "blockedOperations": ["apply_migration"]
}
```

## Best Practices

### 1. Use Read-Only Mode for Production
```bash
export SUPABASE_READ_ONLY=true
```

### 2. Scope to Specific Projects
```bash
export SUPABASE_ALLOWED_PROJECTS=your-production-project-id
```

### 3. Limit Schema Access
```bash
export SUPABASE_ALLOWED_SCHEMAS=public
```

### 4. Block Dangerous Operations
```bash
export SUPABASE_BLOCKED_OPERATIONS=apply_migration,deploy_edge_function,create_project
```

### 5. Use Environment-Specific Configurations

**Development**:
```bash
# .env.development
SUPABASE_READ_ONLY=false
SUPABASE_ALLOWED_PROJECTS=dev-project-123
```

**Production**:
```bash
# .env.production
SUPABASE_READ_ONLY=true
SUPABASE_ALLOWED_PROJECTS=prod-project-456
SUPABASE_BLOCKED_OPERATIONS=apply_migration,deploy_edge_function
```

## Security Monitoring

### Logging
The server logs all operations with timestamps and IP addresses:
```
2025-09-15T18:59:43.272Z - POST /mcp - ::1
```

### Error Handling
Security violations are logged and returned as errors:
```json
{
  "id": "req_123",
  "type": "error",
  "error": "Operation 'apply_migration' is not allowed in read-only mode"
}
```

## Deployment Security

### Render Environment Variables
Set these in your Render dashboard:
- `SUPABASE_READ_ONLY=true`
- `SUPABASE_ALLOWED_PROJECTS=your-project-id`
- `SUPABASE_ALLOWED_SCHEMAS=public`
- `SUPABASE_BLOCKED_OPERATIONS=apply_migration,deploy_edge_function`

### Docker Security
```dockerfile
# Use non-root user
USER node

# Set security environment variables
ENV SUPABASE_READ_ONLY=true
ENV SUPABASE_ALLOWED_PROJECTS=your-project-id
```

## Testing Security

### Test Read-Only Mode
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-supabase-token: your_token" \
  -H "x-project-ref: your_project_ref" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "apply_migration",
      "arguments": {
        "project_id": "test",
        "name": "test_migration",
        "query": "CREATE TABLE test (id SERIAL PRIMARY KEY);"
      }
    }
  }'
```

Expected response:
```json
{
  "type": "error",
  "error": "Operation 'apply_migration' is not allowed in read-only mode"
}
```

### Test Project Scoping
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-supabase-token: your_token" \
  -H "x-project-ref: unauthorized-project" \
  -d '{"method": "tools/list", "params": {}}'
```

Expected response:
```json
{
  "type": "error",
  "error": "Access denied: Project unauthorized-project is not in the allowed projects list"
}
```

## Security Considerations

1. **Never expose production data** - Use development projects for testing
2. **Keep access tokens secure** - Use environment variables, not hardcoded values
3. **Regular security audits** - Review and update security configurations
4. **Monitor access logs** - Watch for unauthorized access attempts
5. **Use HTTPS in production** - Ensure all communications are encrypted
6. **Regular updates** - Keep dependencies and the server updated

## Emergency Procedures

### Lock Down Server
```bash
# Set all restrictive options
export SUPABASE_READ_ONLY=true
export SUPABASE_ALLOWED_PROJECTS=
export SUPABASE_BLOCKED_OPERATIONS=apply_migration,deploy_edge_function,create_project,pause_project,restore_project
```

### Revoke Access
```bash
# Remove all allowed projects (blocks all access)
export SUPABASE_ALLOWED_PROJECTS=
```

### Enable Debug Mode
```bash
# Check current security configuration
curl http://localhost:3000/security
```
