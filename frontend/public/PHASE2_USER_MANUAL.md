# 🎯 Phase 2 Admin System - User Manual

## 📋 Table of Contents
1. [System Overview](#system-overview)
2. [Getting Started](#getting-started)
3. [Data Cleaning Service](#data-cleaning-service)
4. [QML Parser Service](#qml-parser-service)
5. [Approval Workflow Service](#approval-workflow-service)
6. [Batch Processing Service](#batch-processing-service)
7. [Security Features](#security-features)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## 🌟 System Overview

Phase 2 of the Vungu Spatial Data Administration system provides advanced data processing capabilities for spatial data management. The system includes four core services:

- **🧹 Data Cleaning Service** - Automated data quality improvement
- **🎨 QML Parser Service** - Style template management and validation
- **🔄 Approval Workflow Service** - Multi-level review processes
- **⚡ Batch Processing Service** - Large-scale data processing

---

## 🚀 Getting Started

### Access Requirements
- **URL**: `http://localhost:5173/admin`
- **Credentials**: Admin login required
- **Browser**: Chrome, Firefox, Safari, Edge (latest versions)

### First Login
1. Navigate to the admin panel
2. Login with your admin credentials
3. You'll see the main dashboard with Phase 2 features

### Navigation
- **Main Dashboard**: Overview of all services
- **Phase 2 Dashboard**: Advanced features and statistics
- **Quick Actions**: Direct access to common tasks

---

## 🧹 Data Cleaning Service

### Overview
The Data Cleaning Service automatically identifies and fixes common data quality issues in spatial datasets.

### Features
- **Duplicate Detection**: Identifies and removes duplicate records
- **Geometry Validation**: Checks for invalid geometries
- **Attribute Standardization**: Normalizes data formats
- **Quality Metrics**: Provides detailed quality reports

### How to Use

#### 1. Create a Cleaning Job
1. Navigate to the Phase 2 Dashboard
2. Click "Create Cleaning Job" in the Data Cleaning section
3. Select the cleaning type:
   - `duplicate_detection` - Find and remove duplicates
   - `geometry_validation` - Fix invalid geometries
   - `attribute_standardization` - Standardize data formats
4. Configure the cleaning parameters
5. Click "Create Job"

#### 2. Monitor Job Progress
- Jobs appear in the "Recent Jobs" list
- Status updates: pending → running → completed/failed
- Real-time progress indicators

#### 3. Review Results
- **Success Rate**: Percentage of records processed successfully
- **Issues Found**: Number and type of issues detected
- **Fixed Records**: Count of resolved issues
- **Download Results**: Export cleaned data

### Job Configuration

#### Duplicate Detection
```json
{
  "cleaningType": "duplicate_detection",
  "config": {
    "matchFields": ["name", "geometry"],
    "tolerance": 0.001,
    "action": "remove_duplicates"
  }
}
```

#### Geometry Validation
```json
{
  "cleaningType": "geometry_validation",
  "config": {
    "fixInvalidGeometries": true,
    "validateTopology": true,
    "snapTolerance": 0.0001
  }
}
```

#### Attribute Standardization
```json
{
  "cleaningType": "attribute_standardization",
  "config": {
    "fields": ["name", "type", "description"],
    "caseNormalization": "title",
    "trimWhitespace": true
  }
}
```

---

## 🎨 QML Parser Service

### Overview
The QML Parser Service manages QGIS style templates, providing validation, conversion, and preview capabilities.

### Features
- **Template Management**: Upload, organize, and manage QML templates
- **Style Validation**: Check QML syntax and compatibility
- **Preview System**: Visual preview of styles on sample data
- **Batch Processing**: Apply styles to multiple layers

### How to Use

#### 1. Upload QML Template
1. Go to Phase 2 Dashboard → QML Parser Service
2. Click "Upload Template"
3. Select QML file from your computer
4. Choose template type:
   - `point` - Point features
   - `line` - Line features
   - `polygon` - Polygon features
   - `raster` - Raster styles
5. Add description and tags
6. Click "Upload"

#### 2. Validate QML
1. Select a template from the list
2. Click "Validate QML"
3. Review validation results:
   - ✅ Syntax check
   - ✅ Compatibility check
   - ✅ Required properties
   - ❌ Errors and warnings

#### 3. Preview Style
1. Choose a template
2. Click "Preview"
3. View style on sample geometries
4. Adjust parameters if needed

#### 4. Apply Style to Layer
1. Select template and target layer
2. Click "Apply Style"
3. Monitor processing progress
4. Download styled layer

### QML Template Structure

#### Basic Point Style
```xml
<!DOCTYPE qml>
<qml style="map">
  <layer geometries="Point">
    <symbol>
      <layer>
        <prop k="color" v="red"/>
        <prop k="size" v="3"/>
        <prop k="type" v="circle"/>
      </layer>
    </symbol>
  </layer>
</qml>
```

#### Advanced Line Style
```xml
<!DOCTYPE qml>
<qml style="map">
  <layer geometries="Line">
    <symbol>
      <layer>
        <prop k="color" v="blue"/>
        <prop k="width" v="2"/>
        <prop k="style" v="solid"/>
      </layer>
    </symbol>
  </layer>
</qml>
```

---

## 🔄 Approval Workflow Service

### Overview
The Approval Workflow Service manages multi-level review processes for data changes, ensuring quality control and compliance.

### Features
- **Workflow Templates**: Predefined approval processes
- **Multi-level Review**: Sequential approval steps
- **Role-based Permissions**: Different roles for different approval levels
- **Audit Trail**: Complete history of all approvals

### How to Use

#### 1. Create Workflow
1. Navigate to Approval Workflow Service
2. Click "Create Workflow"
3. Configure workflow:
   ```json
   {
     "name": "Data Upload Approval",
     "description": "Standard approval for new data uploads",
     "workflow_type": "data_upload",
     "steps": [
       {
         "step": 1,
         "name": "Data Validation",
         "role": "data_manager",
         "required": true,
         "conditions": ["data_quality_check", "schema_validation"]
       },
       {
         "step": 2,
         "name": "Technical Review",
         "role": "gis_technician",
         "required": true,
         "conditions": ["coordinate_accuracy", "topology_check"]
       },
       {
         "step": 3,
         "name": "Final Approval",
         "role": "supervisor",
         "required": true,
         "conditions": ["compliance_check"]
       }
     ]
   }
   ```
4. Click "Create Workflow"

#### 2. Submit for Approval
1. Select the data to approve
2. Choose appropriate workflow
3. Add supporting documents
4. Submit for review

#### 3. Review Process
- Reviewers receive notifications
- Each step must be completed sequentially
- Comments and attachments can be added
- Approvals or rejections with reasons

#### 4. Track Progress
- Real-time status updates
- Current reviewer assignment
- Completion percentage
- Estimated completion time

### Workflow Types

#### Data Upload Workflow
- **Purpose**: Approve new data uploads
- **Steps**: Validation → Technical Review → Final Approval
- **Roles**: Data Manager → GIS Technician → Supervisor

#### Style Change Workflow
- **Purpose**: Approve style template changes
- **Steps**: Style Review → Impact Assessment → Approval
- **Roles**: Style Manager → GIS Analyst → Admin

#### Batch Process Workflow
- **Purpose**: Approve large-scale data operations
- **Steps**: Risk Assessment → Technical Review → Management Approval
- **Roles**: Risk Analyst → Technical Lead → Manager

---

## ⚡ Batch Processing Service

### Overview
The Batch Processing Service handles large-scale data operations, providing queue management and progress tracking.

### Features
- **Queue Management**: Organized job processing
- **Progress Tracking**: Real-time status updates
- **Resource Management**: CPU and memory optimization
- **Error Handling**: Comprehensive error reporting

### How to Use

#### 1. Create Batch Job
1. Go to Batch Processing Service
2. Click "Create Batch Job"
3. Configure job parameters:
   ```json
   {
     "job_type": "bulk_import",
     "config": {
       "source_files": ["file1.shp", "file2.shp"],
       "target_schema": "production",
       "validation_rules": ["geometry_check", "attribute_validation"],
       "parallel_processing": true,
       "batch_size": 1000
     }
   }
   ```
4. Set priority level (low, medium, high, critical)
5. Schedule job (immediate or scheduled)
6. Click "Create Job"

#### 2. Monitor Progress
- **Queue Position**: Where your job is in the queue
- **Processing Status**: Current operation
- **Progress Percentage**: Completion rate
- **Estimated Time**: Time remaining

#### 3. Manage Jobs
- **Pause/Resume**: Control job execution
- **Cancel**: Stop running jobs
- **Retry**: Re-run failed jobs
- **Prioritize**: Change job priority

### Job Types

#### Bulk Import
- Import multiple files simultaneously
- Automatic format detection
- Progress tracking per file
- Error reporting and recovery

#### Bulk Export
- Export large datasets
- Multiple format support
- Compression options
- Download management

#### Data Cleaning
- Apply cleaning rules to multiple datasets
- Parallel processing for speed
- Quality metrics reporting
- Before/after comparisons

#### Style Application
- Apply styles to multiple layers
- Batch style validation
- Preview before application
- Rollback capabilities

---

## 🔒 Security Features

### Overview
Phase 2 includes comprehensive security features to protect your data and system.

### Security Features

#### Rate Limiting
- **Auth Endpoints**: 5 requests per 15 minutes
- **API Endpoints**: 100 requests per 15 minutes
- **Upload Endpoints**: 10 uploads per hour

#### Input Sanitization
- **SQL Injection Prevention**: Automatic query sanitization
- **XSS Protection**: Script tag removal
- **Path Traversal Prevention**: Directory access control
- **File Upload Security**: Type and size validation

#### Audit Logging
- **Security Events**: All security-related actions logged
- **User Activity**: Complete audit trail
- **IP Tracking**: Source IP monitoring
- **Suspicious Activity**: Automatic detection and alerting

#### Access Control
- **Role-based Permissions**: Different access levels
- **JWT Authentication**: Secure token-based auth
- **Session Management**: Automatic timeout
- **Multi-factor Support**: Optional 2FA

### Security Best Practices

#### For Administrators
1. **Regular Password Changes**: Update passwords every 90 days
2. **Monitor Audit Logs**: Review security events daily
3. **IP Whitelisting**: Restrict access to known IPs
4. **Backup Security**: Secure backup storage and access

#### For Users
1. **Strong Passwords**: Use complex, unique passwords
2. **Session Management**: Log out when finished
3. **Report Issues**: Report suspicious activity immediately
4. **Data Protection**: Don't share credentials

---

## 🔧 Troubleshooting

### Common Issues

#### Job Failures
**Problem**: Data cleaning job fails to start
**Solution**:
1. Check job configuration
2. Verify data source accessibility
3. Review system resources
4. Check error logs for details

#### QML Validation Errors
**Problem**: QML template fails validation
**Solution**:
1. Check XML syntax
2. Verify required properties
3. Test with simpler QML first
4. Use QGIS to validate

#### Workflow Stuck
**Problem**: Approval workflow not progressing
**Solution**:
1. Check reviewer assignments
2. Verify user permissions
3. Review workflow configuration
4. Contact assigned reviewers

#### Performance Issues
**Problem**: System running slowly
**Solution**:
1. Check system resources
2. Review active batch jobs
3. Monitor database performance
4. Consider job prioritization

### Error Messages

#### Authentication Errors
- `401 Unauthorized`: Check login credentials
- `403 Forbidden`: Verify user permissions
- `Token Expired`: Re-authenticate

#### API Errors
- `400 Bad Request`: Check request format
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Contact administrator

#### Job Errors
- `Validation Failed`: Check job configuration
- `Resource Limit`: System resources exhausted
- `Data Error`: Source data issues

---

## 📈 Best Practices

### Data Management
1. **Regular Backups**: Schedule automated backups
2. **Data Validation**: Validate before processing
3. **Version Control**: Track data changes
4. **Quality Checks**: Implement quality assurance

### Job Management
1. **Batch Processing**: Group similar operations
2. **Off-hours Processing**: Schedule large jobs for low-usage times
3. **Resource Monitoring**: Track system performance
4. **Error Handling**: Implement retry logic

### Security
1. **Regular Updates**: Keep system updated
2. **Access Review**: Periodically review user permissions
3. **Security Training**: Educate users on security best practices
4. **Incident Response**: Have a security incident plan

### Performance
1. **Optimize Queries**: Use database indexes effectively
2. **Cache Results**: Cache frequently accessed data
3. **Monitor Resources**: Track CPU, memory, and disk usage
4. **Load Testing**: Test system under load

---

## 📞 Support

### Getting Help
- **Documentation**: Check this manual first
- **Admin Dashboard**: Use the built-in help system
- **Error Logs**: Review system error logs
- **Contact**: Reach out to system administrator

### Reporting Issues
When reporting issues, include:
1. **Error Message**: Exact error text
2. **Steps to Reproduce**: What you were doing
3. **System Information**: Browser, OS, time
4. **Screenshots**: Visual evidence if possible

### Training Resources
- **Video Tutorials**: Available in the training portal
- **Webinars**: Weekly training sessions
- **Documentation**: Comprehensive online docs
- **Community**: User forums and discussion groups

---

## 🎉 Conclusion

The Phase 2 Admin System provides powerful tools for spatial data management with a focus on automation, quality, and security. By following this manual and implementing the best practices outlined, you can maximize the system's capabilities and ensure reliable, efficient data processing operations.

For additional support or questions, don't hesitate to reach out to the system administrator or consult the extended documentation available in the system.

**Happy data processing!** 🚀
> Note: The current frontend now includes a broader portal than the original Phase 2 admin scope. For an updated portal-wide document that covers the public GIS portal, development applications, planner tools, E.O. workspace, admin tools, land-use management, QGIS integration, and security monitoring, see [Vungu_RDC_GIS_System_Documentation.md](Vungu_RDC_GIS_System_Documentation.md).
