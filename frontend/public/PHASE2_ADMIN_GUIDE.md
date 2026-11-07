# 🎯 Phase 2 Admin Guide - Data Processing Operations

## 📋 Table of Contents
1. [System Administration](#system-administration)
2. [Service Management](#service-management)
3. [Monitoring & Analytics](#monitoring--analytics)
4. [Security Administration](#security-administration)
5. [Performance Optimization](#performance-optimization)
6. [Backup & Recovery](#backup--recovery)
7. [Troubleshooting Guide](#troubleshooting-guide)
8. [Maintenance Procedures](#maintenance-procedures)

---

## 🖥️ System Administration

### Service Status Monitoring
The Phase 2 system provides comprehensive monitoring of all four core services:

#### Service Health Indicators
- **🟢 Operational**: Service running normally
- **🟡 Degraded**: Service running with issues
- **🔴 Critical**: Service unavailable
- **⚪ Unknown**: Service status cannot be determined

#### Monitoring Dashboard
Access via: `http://localhost:5173/admin/phase2`

**Key Metrics to Monitor:**
- Service uptime percentage
- Request response times
- Error rates
- Resource utilization
- Queue depths for batch jobs

### Database Administration

#### Connection Pool Management
```typescript
// Monitor connection pool status
SELECT 
  state,
  COUNT(*) as connections,
  AVG(EXTRACT(EPOCH FROM (NOW() - query_start))) as avg_duration
FROM pg_stat_activity 
WHERE datname = 'vungu_master_db'
GROUP BY state;
```

#### Index Performance
```sql
-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;
```

#### Table Statistics
```sql
-- Monitor table sizes and growth
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes
FROM pg_stat_user_tables 
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 🔄 Service Management

### Data Cleaning Service Administration

#### Job Queue Management
```bash
# Check active jobs
curl -H "Authorization: Bearer admin-token" \
  http://localhost:3001/api/admin/data-cleaning/jobs?status=running

# Check job statistics
curl -H "Authorization: Bearer admin-token" \
  http://localhost:3001/api/admin/data-cleaning/statistics
```

#### Performance Tuning
```typescript
// Optimize job processing
const cleaningConfig = {
  batchSize: 1000,        // Records per batch
  maxConcurrency: 4,      // Parallel jobs
  timeoutMs: 300000,      // 5 minutes per job
  retryAttempts: 3        // Retry failed jobs
};
```

#### Common Administrative Tasks

##### 1. Clear Stuck Jobs
```sql
-- Reset stuck jobs to pending
UPDATE data_cleaning_jobs 
SET status = 'pending', 
    started_at = NULL,
    completed_at = NULL
WHERE status = 'running' 
AND started_at < NOW() - INTERVAL '1 hour';
```

##### 2. Archive Old Jobs
```sql
-- Archive completed jobs older than 30 days
CREATE TABLE data_cleaning_jobs_archive AS 
SELECT * FROM data_cleaning_jobs 
WHERE status = 'completed' 
AND completed_at < NOW() - INTERVAL '30 days';

DELETE FROM data_cleaning_jobs 
WHERE status = 'completed' 
AND completed_at < NOW() - INTERVAL '30 days';
```

### QML Parser Service Administration

#### Template Management
```bash
# List all templates
curl -H "Authorization: Bearer admin-token" \
  http://localhost:3001/api/admin/qml-templates

# Validate template
curl -X POST \
  -H "Authorization: Bearer admin-token" \
  -H "Content-Type: application/json" \
  -d '{"qml_content": "..."}' \
  http://localhost:3001/api/admin/qml-templates/validate
```

#### Storage Optimization
```sql
-- Monitor template storage
SELECT 
  style_type,
  COUNT(*) as template_count,
  AVG(LENGTH(qml_content)) as avg_size,
  SUM(LENGTH(qml_content)) as total_size
FROM qml_templates 
GROUP BY style_type;
```

### Approval Workflow Service Administration

#### Workflow Configuration
```typescript
// Monitor workflow performance
const workflowMetrics = {
  averageCompletionTime: '2.5 days',
  bottleneckSteps: ['technical_review'],
  approvalRate: 0.85,
  rejectionReasons: {
    'data_quality': 0.4,
    'missing_docs': 0.3,
    'compliance': 0.3
  }
};
```

#### User Management
```sql
-- Check user permissions
SELECT 
  u.username,
  u.email,
  r.name as role,
  COUNT(wr.id) as pending_reviews
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
LEFT JOIN workflow_requests wr ON u.id = wr.assigned_to AND wr.status = 'pending'
GROUP BY u.id, r.name;
```

### Batch Processing Service Administration

#### Queue Management
```bash
# Check queue status
curl -H "Authorization: Bearer admin-token" \
  http://localhost:3001/api/admin/batch/queue

# Pause queue processing
curl -X POST \
  -H "Authorization: Bearer admin-token" \
  http://localhost:3001/api/admin/batch/queue/pause

# Resume queue processing
curl -X POST \
  -H "Authorization: Bearer admin-token" \
  http://localhost:3001/api/admin/batch/queue/resume
```

#### Resource Allocation
```typescript
// Configure batch processing resources
const batchConfig = {
  maxConcurrentJobs: 5,
  memoryPerJob: '512MB',
  cpuPerJob: '0.5 cores',
  diskSpacePerJob: '1GB',
  timeoutPerJob: 3600000 // 1 hour
};
```

---

## 📊 Monitoring & Analytics

### Real-time Monitoring

#### System Metrics Dashboard
```typescript
interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    total: number;
    used: number;
    available: number;
  };
  disk: {
    total: number;
    used: number;
    available: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
}
```

#### Service-specific Metrics

##### Data Cleaning Metrics
```sql
-- Daily cleaning statistics
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
FROM data_cleaning_jobs 
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

##### QML Processing Metrics
```sql
-- QML template usage statistics
SELECT 
  qt.name,
  qt.style_type,
  COUNT(qv.id) as validation_count,
  COUNT(qv.id) FILTER (WHERE qv.is_valid = true) as valid_count,
  AVG(EXTRACT(EPOCH FROM (qv.completed_at - qv.started_at))) as avg_validation_time
FROM qml_templates qt
LEFT JOIN qml_validations qv ON qt.id = qv.template_id
WHERE qv.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY qt.id, qt.name, qt.style_type;
```

##### Workflow Metrics
```sql
-- Workflow performance analysis
SELECT 
  w.name,
  w.workflow_type,
  COUNT(wr.id) as total_requests,
  COUNT(wr.id) FILTER (WHERE wr.status = 'approved') as approved,
  COUNT(wr.id) FILTER (WHERE wr.status = 'rejected') as rejected,
  AVG(EXTRACT(EPOCH FROM (wr.completed_at - wr.created_at))) as avg_completion_time
FROM approval_workflows w
LEFT JOIN workflow_requests wr ON w.id = wr.workflow_id
WHERE wr.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY w.id, w.name, w.workflow_type;
```

### Alert Configuration

#### Critical Alerts
```typescript
const alertThresholds = {
  errorRate: 0.05,           // 5% error rate
  responseTime: 5000,        // 5 seconds
  queueDepth: 100,           // 100 jobs in queue
  diskUsage: 0.85,          // 85% disk usage
  memoryUsage: 0.90,        // 90% memory usage
  cpuUsage: 0.95            // 95% CPU usage
};
```

#### Alert Channels
- **Email**: Automatic email notifications
- **Slack**: Integration with Slack channels
- **SMS**: Critical alerts via SMS
- **Dashboard**: In-app notifications

---

## 🔒 Security Administration

### Security Monitoring

#### Daily Security Review
```sql
-- Daily security summary
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE severity = 'critical') as critical,
  COUNT(*) FILTER (WHERE severity = 'high') as high,
  COUNT(*) FILTER (WHERE event_type = 'LOGIN_FAILED') as failed_logins,
  COUNT(DISTINCT ip_address) as unique_ips
FROM security_audit_log 
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

#### Suspicious Activity Detection
```sql
-- Identify suspicious IPs
SELECT 
  ip_address,
  COUNT(*) as event_count,
  COUNT(*) FILTER (WHERE event_type = 'LOGIN_FAILED') as failed_logins,
  MAX(created_at) as last_activity,
  STRING_AGG(DISTINCT event_type, ', ') as event_types
FROM security_audit_log 
WHERE created_at >= CURRENT_DATE - INTERVAL '24 hours'
GROUP BY ip_address
HAVING COUNT(*) > 50 OR COUNT(*) FILTER (WHERE event_type = 'LOGIN_FAILED') > 5
ORDER BY event_count DESC;
```

### Access Control

#### User Role Management
```sql
-- Review user permissions
SELECT 
  u.username,
  u.email,
  u.last_login,
  r.name as role,
  ARRAY_AGG(p.name) as permissions
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE u.is_active = true
GROUP BY u.id, r.name
ORDER BY u.last_login DESC;
```

#### IP Whitelisting
```sql
-- Manage IP whitelist
INSERT INTO blocked_ips (ip_address, reason, severity, expires_at)
VALUES ('192.168.1.100', 'Suspicious activity pattern', 'high', NOW() + INTERVAL '7 days');

-- View current blocks
SELECT * FROM blocked_ips WHERE is_active = true;
```

---

## ⚡ Performance Optimization

### Database Optimization

#### Query Performance
```sql
-- Identify slow queries
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
WHERE mean_time > 1000 
ORDER BY mean_time DESC
LIMIT 10;
```

#### Index Optimization
```sql
-- Missing indexes suggestion
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats 
WHERE schemaname = 'public'
AND n_distinct > 100
ORDER BY n_distinct DESC;
```

### Application Performance

#### Caching Strategy
```typescript
// Redis caching configuration
const cacheConfig = {
  userSessions: { ttl: 3600, maxSize: 1000 },
  apiResponses: { ttl: 300, maxSize: 10000 },
  qmlTemplates: { ttl: 7200, maxSize: 500 },
  jobStatus: { ttl: 60, maxSize: 5000 }
};
```

#### Load Balancing
```typescript
// Service load balancing
const loadBalancer = {
  dataCleaning: { instances: 3, maxRequests: 100 },
  qmlParser: { instances: 2, maxRequests: 50 },
  workflows: { instances: 2, maxRequests: 75 },
  batchProcessing: { instances: 1, maxRequests: 25 }
};
```

---

## 💾 Backup & Recovery

### Database Backup Strategy

#### Automated Backups
```bash
#!/bin/bash
# Daily backup script
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/vungu"
DB_NAME="vungu_master_db"

# Create backup
pg_dump -h localhost -U postgres -d $DB_NAME > $BACKUP_DIR/vungu_$DATE.sql

# Compress backup
gzip $BACKUP_DIR/vungu_$DATE.sql

# Remove backups older than 30 days
find $BACKUP_DIR -name "vungu_*.sql.gz" -mtime +30 -delete
```

#### Point-in-Time Recovery
```sql
-- Enable WAL archiving
ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = 'cp %p /backups/wal/%f';
SELECT pg_reload_conf();

-- Create restore point
SELECT pg_create_restore_point('before_major_update');
```

### Service State Backup

#### Configuration Backup
```bash
# Backup service configurations
tar -czf /backups/config_$(date +%Y%m%d).tar.gz \
  /opt/vungu/config/ \
  /opt/vungu/.env \
  /opt/vungu/docker-compose.yml
```

#### Job State Recovery
```sql
-- Backup running jobs
CREATE TABLE jobs_backup AS 
SELECT * FROM data_cleaning_jobs WHERE status = 'running';

-- Backup batch queue
CREATE TABLE batch_queue_backup AS 
SELECT * FROM batch_jobs WHERE status IN ('pending', 'running');
```

---

## 🔧 Troubleshooting Guide

### Common Issues and Solutions

#### Service Unavailable
**Symptoms**: 503 errors, connection refused
**Causes**: Service crash, port conflict, resource exhaustion
**Solutions**:
1. Check service logs: `docker logs service-name`
2. Verify port availability: `netstat -tulpn | grep :3001`
3. Check system resources: `top`, `df -h`, `free -m`
4. Restart service: `docker restart service-name`

#### Database Connection Issues
**Symptoms**: Connection timeout, authentication errors
**Causes**: Max connections reached, network issues, credentials
**Solutions**:
1. Check connection count: `SELECT count(*) FROM pg_stat_activity;`
2. Verify network connectivity: `telnet localhost 5432`
3. Reset connection pool: Restart application
4. Check credentials: Verify .env configuration

#### Job Processing Stuck
**Symptoms**: Jobs not progressing, queue growing
**Causes**: Resource contention, deadlocks, configuration errors
**Solutions**:
1. Check job status: `SELECT * FROM data_cleaning_jobs WHERE status = 'running';`
2. Monitor system resources: `htop`, `iotop`
3. Reset stuck jobs: Update status to 'pending'
4. Check error logs: Application logs, database logs

#### Performance Degradation
**Symptoms**: Slow response times, timeouts
**Causes**: High load, missing indexes, large datasets
**Solutions**:
1. Identify bottlenecks: Query performance analysis
2. Add missing indexes: Based on query patterns
3. Optimize configuration: Increase memory, adjust timeouts
4. Scale resources: Add CPU, memory, or instances

### Debugging Tools

#### Application Logs
```bash
# View real-time logs
docker logs -f vungu-backend

# Filter by service
docker logs vungu-backend | grep "data-cleaning"

# Error logs only
docker logs vungu-backend 2>&1 | grep -i error
```

#### Database Queries
```sql
-- Active queries
SELECT 
  pid,
  now() - pg_stat_activity.query_start AS duration,
  query,
  state
FROM pg_stat_activity 
WHERE state = 'active';

-- Lock monitoring
SELECT 
  blocked_locks.pid AS blocked_pid,
  blocked_activity.usename AS blocked_user,
  blocking_locks.pid AS blocking_pid,
  blocking_activity.usename AS blocking_user,
  blocked_activity.query AS blocked_statement,
  blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

---

## 🔄 Maintenance Procedures

### Daily Maintenance

#### Health Checks
```bash
#!/bin/bash
# Daily health check script

# Check service status
curl -f http://localhost:3001/api/admin/health || echo "Service DOWN"

# Check database connectivity
pg_isready -h localhost -p 5432 || echo "Database DOWN"

# Check disk space
df -h | grep -E "/$|/opt" | awk '{print $5}' | sed 's/%//' | while read usage; do
  if [ $usage -gt 85 ]; then
    echo "Disk usage high: $usage%"
  fi
done

# Check memory usage
free | grep Mem | awk '{printf "%.0f%%\n", $3/$2 * 100.0}' | while read usage; do
  if [ ${usage%?} -gt 90 ]; then
    echo "Memory usage high: $usage"
  fi
done
```

#### Log Rotation
```bash
# Configure logrotate
cat > /etc/logrotate.d/vungu << EOF
/opt/vungu/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 vungu vungu
    postrotate
        docker kill -s USR1 vungu-backend
    endscript
}
EOF
```

### Weekly Maintenance

#### Performance Review
```sql
-- Weekly performance report
SELECT 
  'Data Cleaning' as service,
  COUNT(*) as total_jobs,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs
FROM data_cleaning_jobs 
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'

UNION ALL

SELECT 
  'QML Parser' as service,
  COUNT(*) as total_validations,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration,
  COUNT(*) FILTER (WHERE is_valid = false) as failed_validations
FROM qml_validations 
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days';
```

#### Security Audit
```sql
-- Weekly security review
SELECT 
  event_type,
  COUNT(*) as occurrences,
  COUNT(DISTINCT ip_address) as unique_ips,
  COUNT(*) FILTER (WHERE severity IN ('high', 'critical')) as high_severity
FROM security_audit_log 
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY event_type
ORDER BY occurrences DESC;
```

### Monthly Maintenance

#### System Updates
```bash
# Update system packages
apt update && apt upgrade -y

# Update Docker images
docker pull vungu/backend:latest
docker pull vungu/frontend:latest

# Restart services with new images
docker-compose down
docker-compose up -d
```

#### Data Archiving
```sql
-- Archive old data
-- Move completed jobs older than 90 days to archive
CREATE TABLE data_cleaning_jobs_archive_2024_01 AS 
SELECT * FROM data_cleaning_jobs 
WHERE status = 'completed' 
AND completed_at BETWEEN '2024-01-01' AND '2024-01-31';

DELETE FROM data_cleaning_jobs 
WHERE id IN (SELECT id FROM data_cleaning_jobs_archive_2024_01);
```

---

## 📞 Emergency Procedures

### Service Outage Response

#### Immediate Actions (First 5 minutes)
1. **Assess Impact**: Determine affected services and users
2. **Communicate**: Notify stakeholders of the issue
3. **Isolate**: Prevent further damage if possible
4. **Document**: Start incident log

#### Investigation (First 30 minutes)
1. **Check Logs**: Review application and system logs
2. **Verify Resources**: Check CPU, memory, disk, network
3. **Test Connectivity**: Verify database and external services
4. **Recent Changes**: Review recent deployments or configuration changes

#### Resolution (First 2 hours)
1. **Implement Fix**: Apply identified solution
2. **Monitor**: Watch for recovery and stability
3. **Verify**: Test all affected functionality
4. **Communicate**: Update stakeholders on resolution

### Data Recovery Procedures

#### Database Corruption
1. **Stop Services**: Prevent further data damage
2. **Assess Damage**: Determine extent of corruption
3. **Restore Backup**: Use most recent clean backup
4. **Verify Data**: Check data integrity
5. **Resume Services**: Gradually restore functionality

#### Data Loss Prevention
1. **Regular Backups**: Automated daily backups
2. **Point-in-Time Recovery**: WAL archiving enabled
3. **Replication**: Consider read replica for failover
4. **Testing**: Regular restore testing

---

## 📈 Performance Benchmarks

### Target Performance Metrics

#### Response Times
- **API Endpoints**: < 500ms (95th percentile)
- **Database Queries**: < 100ms (average)
- **File Uploads**: < 5 seconds per 10MB
- **Report Generation**: < 30 seconds

#### Throughput
- **Concurrent Users**: 100+
- **API Requests**: 1000/minute
- **File Uploads**: 50/minute
- **Batch Jobs**: 10 concurrent

#### Resource Utilization
- **CPU Usage**: < 70% (average)
- **Memory Usage**: < 80% (average)
- **Disk Usage**: < 85% (maximum)
- **Network**: < 80% (peak)

### Monitoring Alerts

#### Critical Alerts
- Service unavailable > 5 minutes
- Error rate > 5%
- Database connection failures
- Disk usage > 90%
- Memory usage > 95%

#### Warning Alerts
- Response time > 1 second
- Queue depth > 50 jobs
- CPU usage > 85%
- Failed login attempts > 10/hour

---

## 🎯 Conclusion

This admin guide provides comprehensive procedures for managing the Phase 2 data processing system. Regular monitoring, maintenance, and proactive management will ensure optimal performance and reliability.

Key takeaways for administrators:
1. **Monitor Continuously**: Use the dashboard and alerts
2. **Maintain Regularly**: Follow daily, weekly, monthly procedures
3. **Plan for Emergencies**: Have response procedures ready
4. **Optimize Proactively**: Monitor performance and optimize regularly
5. **Stay Secure**: Regular security reviews and updates

For additional support or advanced troubleshooting, consult the technical documentation or contact the system architecture team.

**System Administration Excellence = Proactive Management + Rapid Response + Continuous Improvement** 🚀
