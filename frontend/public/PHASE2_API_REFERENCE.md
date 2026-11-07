# Phase 2 Admin System - API Reference

## 📡 Complete API Documentation

This reference provides comprehensive documentation for all Phase 2 Admin System APIs.

---

## 🔐 Authentication

All API endpoints require authentication using JWT tokens.

### **Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

### **Login Endpoint:**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@vungu.gov.zw",
  "password": "admin123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "email": "admin@vungu.gov.zw",
      "role": "admin",
      "permissions": ["read", "write", "admin"]
    }
  }
}
```

---

## 🧹 Data Cleaning Service

### **Get Data Cleaning Jobs**
```http
GET /api/data-cleaning/jobs
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Test Cleaning Job",
      "status": "completed",
      "created_at": "2026-01-21T10:00:00Z",
      "completed_at": "2026-01-21T10:15:00Z",
      "file_name": "sample_data.csv",
      "records_processed": 1000,
      "issues_found": 23,
      "success_rate": 97.7
    }
  ]
}
```

### **Create Data Cleaning Job**
```http
POST /api/data-cleaning/jobs
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "New Cleaning Job",
  "description": "Clean customer data",
  "file": "base64_encoded_file_content",
  "file_name": "customer_data.csv",
  "cleaning_options": {
    "remove_duplicates": true,
    "validate_geometry": true,
    "standardize_attributes": true,
    "fix_geometries": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "New Cleaning Job",
    "status": "pending",
    "created_at": "2026-01-21T11:00:00Z",
    "estimated_completion": "2026-01-21T11:30:00Z"
  }
}
```

### **Get Job Status**
```http
GET /api/data-cleaning/jobs/{jobId}
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "New Cleaning Job",
    "status": "running",
    "progress": 45,
    "records_processed": 450,
    "total_records": 1000,
    "issues_found": 12,
    "estimated_completion": "2026-01-21T11:15:00Z"
  }
}
```

### **Get Data Cleaning Statistics**
```http
GET /api/data-cleaning/statistics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_jobs": 156,
    "completed_jobs": 142,
    "failed_jobs": 3,
    "running_jobs": 2,
    "pending_jobs": 9,
    "success_rate": 91.0,
    "by_type": {
      "duplicate_detection": 45,
      "geometry_validation": 67,
      "attribute_standardization": 44
    },
    "issues_found": 1247,
    "records_processed": 156789
  }
}
```

---

## 🎨 QML Parser Service

### **Get QML Templates**
```http
GET /api/qml-templates
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Standard Point Style",
      "description": "Default point styling",
      "type": "point",
      "created_at": "2026-01-20T09:00:00Z",
      "updated_at": "2026-01-21T10:30:00Z",
      "is_active": true
    }
  ]
}
```

### **Create QML Template**
```http
POST /api/qml-templates
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Custom Line Style",
  "description": "Custom line styling",
  "type": "line",
  "qml_content": "<qgis style=\"...\">...</qgis>",
  "is_active": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "Custom Line Style",
    "description": "Custom line styling",
    "type": "line",
    "created_at": "2026-01-21T12:00:00Z",
    "is_active": true
  }
}
```

### **Validate QML Template**
```http
POST /api/qml-templates/validate
Authorization: Bearer <token>
Content-Type: application/json

{
  "qml_content": "<qgis style=\"...\">...</qgis>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "is_valid": true,
    "errors": [],
    "warnings": [
      "Unused property: 'custom_property'"
    ],
    "parsed_elements": {
      "symbols": 3,
      "layers": 3,
      "properties": 12
    }
  }
}
```

### **Get QML Statistics**
```http
GET /api/qml-templates/statistics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 23,
    "by_type": {
      "point": 8,
      "line": 7,
      "polygon": 6,
      "raster": 2
    },
    "active_templates": 18,
    "inactive_templates": 5,
    "most_used": "Standard Point Style"
  }
}
```

---

## 🔄 Approval Workflow Service

### **Get Workflows**
```http
GET /api/workflows
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Data Upload Approval",
      "description": "Approve data uploads",
      "status": "active",
      "current_stage": "manager_review",
      "created_at": "2026-01-20T08:00:00Z",
      "total_stages": 3,
      "completed_stages": 1
    }
  ]
}
```

### **Create Workflow**
```http
POST /api/workflows
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Document Approval",
  "description": "Approve important documents",
  "type": "document_approval",
  "stages": [
    {
      "name": "initial_review",
      "assignee": "reviewer@vungu.gov.zw",
      "required_approvals": 1
    },
    {
      "name": "manager_approval",
      "assignee": "manager@vungu.gov.zw",
      "required_approvals": 1
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "Document Approval",
    "status": "active",
    "created_at": "2026-01-21T13:00:00Z",
    "workflow_id": "DOC_2026_001"
  }
}
```

### **Get Workflow Statistics**
```http
GET /api/workflows/statistics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 45,
    "active": 12,
    "pending_requests": 8,
    "by_type": {
      "data_upload": 23,
      "style_change": 15,
      "batch_process": 7
    },
    "average_completion_time": "2.5 days",
    "success_rate": 94.2
  }
}
```

---

## ⚡ Batch Processing Service

### **Get Batch Jobs**
```http
GET /api/batch/jobs
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Bulk Data Import",
      "type": "bulk_import",
      "status": "completed",
      "created_at": "2026-01-21T09:00:00Z",
      "completed_at": "2026-01-21T11:30:00Z",
      "records_processed": 50000,
      "success_rate": 99.8
    }
  ]
}
```

### **Create Batch Job**
```http
POST /api/batch/jobs
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Bulk Export",
  "type": "bulk_export",
  "parameters": {
    "format": "geojson",
    "filter": "date >= '2026-01-01'",
    "output_path": "/exports/bulk_export_2026.geojson"
  },
  "priority": "normal"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "Bulk Export",
    "type": "bulk_export",
    "status": "queued",
    "created_at": "2026-01-21T14:00:00Z",
    "estimated_completion": "2026-01-21T16:00:00Z",
    "job_id": "BATCH_2026_001"
  }
}
```

### **Get Batch Statistics**
```http
GET /api/batch/statistics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_jobs": 89,
    "completed_jobs": 76,
    "failed_jobs": 3,
    "running_jobs": 2,
    "pending_jobs": 8,
    "success_rate": 85.4,
    "by_type": {
      "bulk_import": 34,
      "bulk_export": 28,
      "data_cleaning": 18,
      "style_application": 9
    },
    "average_processing_time": "1.8 hours"
  }
}
```

---

## 🔒 Security Service

### **Get Security Metrics**
```http
GET /api/security/metrics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_events": 1247,
    "failed_logins": 23,
    "suspicious_activities": 5,
    "blocked_ips": 3,
    "critical_events": 2,
    "high_severity": 15,
    "medium_severity": 89,
    "low_severity": 1141,
    "rate_limit_hits": 8,
    "data_access_events": 156,
    "privilege_escalation": 1,
    "configuration_changes": 12
  }
}
```

### **Log Security Event**
```http
POST /api/security/audit-log
Authorization: Bearer <token>
Content-Type: application/json

{
  "event_type": "data_access",
  "severity": "low",
  "details": {
    "action": "User accessed sensitive data",
    "resource": "/api/data-cleaning/jobs",
    "user_agent": "Mozilla/5.0..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "event_id": "SEC_1642771234567_ABC123",
    "timestamp": "2026-01-21T15:30:00Z",
    "logged": true
  }
}
```

### **Get Blocked IPs**
```http
GET /api/security/blocked-ips
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "ip_address": "192.168.1.100",
      "reason": "Multiple failed login attempts",
      "blocked_at": "2026-01-21T14:00:00Z",
      "blocked_until": "2026-01-21T16:00:00Z",
      "is_active": true
    }
  ]
}
```

### **Test Rate Limiting**
```http
POST /api/security/test-rate-limit
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "test_results": {
      "requests_sent": 10,
      "requests_blocked": 3,
      "rate_limit_active": true,
      "limits": {
        "auth_requests": "15 per minute",
        "api_requests": "100 per minute",
        "upload_requests": "5 per minute"
      }
    }
  }
}
```

---

## 📊 System Information

### **Get System Status**
```http
GET /api/system/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "2.1.0",
    "uptime": "15 days, 7 hours, 23 minutes",
    "services": {
      "database": "healthy",
      "redis": "healthy",
      "file_storage": "healthy"
    },
    "performance": {
      "cpu_usage": 23.5,
      "memory_usage": 67.8,
      "disk_usage": 45.2,
      "active_connections": 127
    }
  }
}
```

### **Get Health Check**
```http
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-21T16:00:00Z",
  "version": "2.1.0",
  "environment": "production"
}
```

---

## 📝 Error Responses

All APIs return consistent error responses:

### **Standard Error Format:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input parameters",
    "details": {
      "field": "email",
      "issue": "Invalid email format"
    },
    "timestamp": "2026-01-21T16:00:00Z",
    "request_id": "REQ_1642771234567"
  }
}
```

### **Common Error Codes:**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Invalid input parameters |
| UNAUTHORIZED | 401 | Authentication required |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource conflict |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |
| SERVICE_UNAVAILABLE | 503 | Service temporarily unavailable |

---

## 🔧 Rate Limiting

API endpoints are rate-limited to prevent abuse:

### **Rate Limits:**
- **Authentication endpoints**: 15 requests per minute
- **API endpoints**: 100 requests per minute  
- **Upload endpoints**: 5 requests per minute
- **Security endpoints**: 50 requests per minute

### **Rate Limit Headers:**
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1642771800
```

### **Rate Limit Exceeded Response:**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded",
    "details": {
      "limit": 100,
      "window": "60 seconds",
      "retry_after": 45
    }
  }
}
```

---

## 🌐 CORS Configuration

The API supports Cross-Origin Resource Sharing (CORS):

### **Allowed Origins:**
- `http://localhost:5173` (Development)
- `http://localhost:5175` (Development)
- `https://vungu.gov.zw` (Production)

### **CORS Headers:**
```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 86400
```

---

## 📚 SDK Examples

### **JavaScript/TypeScript:**
```typescript
class Phase2API {
  private baseURL: string;
  private token: string;

  constructor(baseURL: string, token: string) {
    this.baseURL = baseURL;
    this.token = token;
  }

  async createCleaningJob(jobData: any) {
    const response = await fetch(`${this.baseURL}/api/data-cleaning/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(jobData)
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getJobStatus(jobId: number) {
    const response = await fetch(`${this.baseURL}/api/data-cleaning/jobs/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });

    const result = await response.json();
    return result.data;
  }
}

// Usage
const api = new Phase2API('http://localhost:3001', 'your-jwt-token');
const job = await api.createCleaningJob({
  name: 'Test Job',
  file: 'base64_content'
});
```

### **Python:**
```python
import requests
import json

class Phase2API:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
    
    def create_cleaning_job(self, job_data):
        response = requests.post(
            f'{self.base_url}/api/data-cleaning/jobs',
            headers=self.headers,
            json=job_data
        )
        
        if response.status_code != 200:
            raise Exception(f'API Error: {response.text}')
        
        return response.json()['data']
    
    def get_job_status(self, job_id):
        response = requests.get(
            f'{self.base_url}/api/data-cleaning/jobs/{job_id}',
            headers=self.headers
        )
        
        return response.json()['data']

# Usage
api = Phase2API('http://localhost:3001', 'your-jwt-token')
job = api.create_cleaning_job({
    'name': 'Test Job',
    'file': 'base64_content'
})
```

---

## 🧪 Testing APIs

### **Using curl:**
```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@vungu.gov.zw","password":"admin123"}'

# Get jobs (with token)
curl -X GET http://localhost:3001/api/data-cleaning/jobs \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Create job
curl -X POST http://localhost:3001/api/data-cleaning/jobs \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Job","description":"Test"}'
```

### **Using Postman:**
1. **Import collection**: Use provided Postman collection
2. **Set environment variables**:
   - `base_url`: `http://localhost:3001`
   - `token`: Your JWT token
3. **Use pre-request script** for auto-authentication

---

## 📈 Monitoring and Analytics

### **API Metrics:**
- Request count by endpoint
- Response time distribution
- Error rate by endpoint
- User activity patterns
- Rate limiting statistics

### **Monitoring Endpoints:**
```http
GET /api/metrics/requests
GET /api/metrics/performance  
GET /api/metrics/users
GET /api/metrics/errors
```

---

## 🔍 Debugging

### **Request IDs:**
All API requests include a unique request ID for tracing:

```http
X-Request-ID: REQ_1642771234567_ABC123
```

### **Debug Headers:**
```http
X-Debug-Mode: true
X-Include-Timing: true
```

### **Logging Levels:**
- `error`: Critical errors only
- `warn`: Warnings and errors
- `info`: General information
- `debug`: Detailed debugging

---

## 📋 Changelog

### **Version 2.1.0** (2026-01-21)
- Added security audit endpoints
- Improved error handling
- Enhanced rate limiting
- Added batch processing APIs

### **Version 2.0.0** (2026-01-01)
- Complete API rewrite
- JWT authentication
- Rate limiting implementation
- CORS support

---

*Last updated: January 21, 2026*  
*Version: 2.1.0*  
*For the latest API version, check the system status endpoint.*
