# Phase 2 Admin System - Troubleshooting Guide

## 🔧 Common Issues and Solutions

This guide helps you resolve common issues with the Phase 2 Admin System.

---

## 🔐 Authentication Issues

### **Issue: "Invalid credentials" error**

**Symptoms:**
- Login page shows "Invalid credentials"
- Can't access admin dashboard

**Causes:**
- Incorrect email or password
- Account locked due to failed attempts
- Session expired

**Solutions:**
1. **Check credentials**:
   - Email: `admin@vungu.gov.zw`
   - Password: `admin123`
2. **Wait 30 minutes** if account locked (5 failed attempts)
3. **Clear browser cache** and cookies
4. **Try incognito/private browsing**

**Prevention:**
- Use password manager
- Enable 2FA when available
- Don't share credentials

---

### **Issue: "Access denied" error**

**Symptoms:**
- Logged in but can't access certain features
- "Permission denied" messages

**Causes:**
- Insufficient user role
- Feature not enabled for your account
- Session corruption

**Solutions:**
1. **Check user role** in profile settings
2. **Contact administrator** for permission upgrade
3. **Log out and log back in** to refresh session
4. **Clear browser cache**

---

## 🧹 Data Cleaning Issues

### **Issue: Job fails to start**

**Symptoms:**
- "Create Cleaning Job" button doesn't respond
- Job shows "Failed" status immediately

**Causes:**
- Invalid file format
- File too large (>100MB)
- Server busy
- Network connectivity issues

**Solutions:**
1. **Check file format**: Supported formats are CSV, GeoJSON, SHP, KML, GPKG
2. **Reduce file size**: Split large files into smaller chunks
3. **Wait and retry**: Server might be busy
4. **Check internet connection**
5. **Refresh page** and try again

**File Format Requirements:**
```
✅ CSV: Comma-separated values with headers
✅ GeoJSON: Valid GeoJSON format
✅ SHP: Complete shapefile (.shp, .shx, .dbf)
✅ KML: Valid KML format
✅ GPKG: GeoPackage format
❌ XLSX: Not supported (convert to CSV)
❌ ZIP: Not supported (extract first)
```

### **Issue: Job stuck in "Running" status**

**Symptoms:**
- Job shows "Running" for hours
- Progress bar not moving
- No status updates

**Causes:**
- Large dataset processing
- Server resource constraints
- Database connection issues
- Infinite loop in cleaning logic

**Solutions:**
1. **Wait longer**: Large files can take hours
2. **Check job size**: Files >50MB take significant time
3. **Monitor server resources**: CPU and memory usage
4. **Cancel and retry** with smaller file
5. **Contact administrator** if stuck >24 hours

---

## 🎨 QML Template Issues

### **Issue: "Invalid QML syntax" error**

**Symptoms:**
- QML validation fails
- "Syntax error" messages
- Template not accepted

**Causes:**
- Invalid XML structure
- Missing required elements
- Incorrect property names
- Encoding issues

**Solutions:**
1. **Validate XML structure**:
   ```xml
   <!-- Correct structure -->
   <qgis style="...">
     <symbols>
       <symbol name="..." type="...">
         <layer pass="0" class="...">
           <prop k="color" v="..."/>
         </layer>
       </symbol>
     </symbols>
   </qgis>
   ```
2. **Check required properties**: color, size, style
3. **Use QGIS to export** valid QML files
4. **Test with simple template** first

### **Issue: Styles not applying**

**Symptoms:**
- Template loads but styles don't show
- Default styling used instead
- No visual changes

**Causes:**
- Incorrect geometry type
- Missing symbol references
- Property name mismatches
- Scale-dependent visibility

**Solutions:**
1. **Check geometry type**: Point vs Line vs Polygon
2. **Verify symbol names** match layer fields
3. **Check scale dependencies**: Visibility at current zoom
4. **Test with different zoom levels**

---

## 🔄 Workflow Issues

### **Issue: Workflow not progressing**

**Symptoms:**
- Workflow stuck at "Pending" stage
- No notifications sent
- Approvers can't access workflow

**Causes:**
- Incorrect user permissions
- Missing approvers in workflow
- Notification system failure
- Database connection issues

**Solutions:**
1. **Check user permissions**: Ensure approvers have correct roles
2. **Verify workflow configuration**: All stages have assigned users
3. **Test notifications**: Send test notification to approvers
4. **Check email settings**: SMTP configuration
5. **Manual advance**: Admin can manually advance workflow

### **Issue: "No approvers available" error**

**Symptoms:**
- Workflow creation fails
- "No approvers available" message
- Can't assign approval steps

**Causes:**
- No users with approver roles
- All approvers on vacation
- Role configuration issues
- User account issues

**Solutions:**
1. **Create approver accounts**: Add users with approver permissions
2. **Check user status**: Ensure accounts are active
3. **Configure roles**: Set up approval hierarchy
4. **Assign backup approvers**: Multiple approvers per stage

---

## ⚡ Batch Processing Issues

### **Issue: Batch job timeout**

**Symptoms:**
- Job fails after 2 hours
- "Timeout error" message
- Partial completion

**Causes:**
- Large dataset processing
- Resource constraints
- Infinite loops
- Database locks

**Solutions:**
1. **Reduce batch size**: Split into smaller jobs
2. **Optimize processing**: Remove unnecessary operations
3. **Increase timeout**: Configure longer timeout periods
4. **Monitor resources**: Check CPU and memory usage
5. **Use incremental processing**: Process in chunks

### **Issue: Memory exhaustion**

**Symptoms:**
- Job fails with "Out of memory"
- Server becomes unresponsive
- Error logs show memory issues

**Causes:**
- Processing too much data at once
- Memory leaks in processing code
- Insufficient server memory
- Concurrent job overload

**Solutions:**
1. **Reduce job size**: Process smaller batches
2. **Monitor memory usage**: Check during processing
3. **Restart services**: Clear memory leaks
4. **Upgrade server resources**: Add more RAM
5. **Limit concurrent jobs**: Queue management

---

## 🔒 Security Issues

### **Issue: Rate limiting blocking legitimate users**

**Symptoms:**
- "Too many requests" errors
- Users getting blocked
- 429 HTTP status codes

**Causes:**
- Aggressive rate limiting
- Shared IP addresses
- Automated tools
- Bot traffic

**Solutions:**
1. **Adjust rate limits**: Increase thresholds for legitimate use
2. **Whitelist IPs**: Add trusted IP addresses
3. **User authentication**: Require login for API access
4. **Monitor patterns**: Distinguish bots from users
5. **Implement CAPTCHA**: For suspicious activity

### **Issue: Security alerts not working**

**Symptoms:**
- No security notifications
- Alerts not configured
- Missing audit logs

**Causes:**
- Notification system disabled
- Incorrect email settings
- Log rotation issues
- Configuration errors

**Solutions:**
1. **Check notification settings**: Enable security alerts
2. **Configure email**: Set up SMTP settings
3. **Verify log storage**: Check disk space
4. **Test alerts**: Send test security alert
5. **Review configuration**: Security settings

---

## 🌐 Network and Connectivity Issues

### **Issue: "Connection refused" errors**

**Symptoms:**
- Can't connect to server
- "Connection refused" messages
- API calls failing

**Causes:**
- Server not running
- Firewall blocking ports
- Network configuration issues
- DNS problems

**Solutions:**
1. **Check server status**: Verify backend is running
2. **Verify port accessibility**: Check firewall settings
3. **Test network connectivity**: Ping server
4. **Check DNS resolution**: Verify domain names
5. **Restart services**: Backend and frontend

### **Issue: Slow performance**

**Symptoms:**
- Pages loading slowly
- API calls timing out
- Poor user experience

**Causes:**
- High server load
- Database performance issues
- Network latency
- Large data transfers

**Solutions:**
1. **Monitor server resources**: CPU, memory, disk usage
2. **Optimize database**: Add indexes, tune queries
3. **Enable caching**: Redis or application caching
4. **Compress responses**: Enable gzip compression
5. **Use CDN**: For static assets

---

## 📱 Browser Issues

### **Issue: Features not working in specific browser**

**Symptoms:**
- Buttons not responding
- Layout problems
- JavaScript errors

**Causes:**
- Browser compatibility
- JavaScript disabled
- Outdated browser version
- Extension conflicts

**Solutions:**
1. **Try different browser**: Chrome, Firefox, Safari, Edge
2. **Update browser**: Use latest version
3. **Disable extensions**: Temporarily disable all extensions
4. **Clear cache**: Browser data and cookies
5. **Enable JavaScript**: Check browser settings

### **Issue: Mobile responsiveness problems**

**Symptoms:**
- Poor mobile layout
- Touch issues
- Small text

**Causes:**
- Viewport configuration
- CSS media queries
- Touch event handling
- Font sizing

**Solutions:**
1. **Check viewport**: Meta viewport tag configured
2. **Test responsive design**: Different screen sizes
3. **Enable touch events**: Proper touch handling
4. **Adjust font sizes**: Mobile-friendly typography
5. **Test on devices**: Real mobile testing

---

## 🗄️ Database Issues

### **Issue: Database connection errors**

**Symptoms:**
- "Database connection failed"
- Service unavailable
- Data not loading

**Causes:**
- Database server down
- Connection pool exhausted
- Network issues
- Authentication problems

**Solutions:**
1. **Check database status**: Verify PostgreSQL is running
2. **Check connection pool**: Increase pool size
3. **Verify credentials**: Database username/password
4. **Test connectivity**: Network access to database
5. **Restart database**: Service restart

### **Issue: Slow database queries**

**Symptoms:**
- Pages loading slowly
- Timeouts on data loading
- High database CPU

**Causes:**
- Missing indexes
- Inefficient queries
- Large datasets
- Lock contention

**Solutions:**
1. **Add indexes**: On frequently queried columns
2. **Optimize queries**: Use EXPLAIN ANALYZE
3. **Implement pagination**: Limit result sets
4. **Cache results**: Application-level caching
5. **Monitor performance**: Database metrics

---

## 📊 Performance Monitoring

### **Key Metrics to Monitor:**

**System Metrics:**
- CPU usage (<80% normal)
- Memory usage (<85% normal)
- Disk space (>20% free)
- Network latency (<200ms)

**Application Metrics:**
- Response time (<500ms average)
- Error rate (<1%)
- Throughput (requests/second)
- Active users

**Database Metrics:**
- Connection count (<80% of max)
- Query time (<100ms average)
- Index usage (>90% hit rate)
- Lock waits (<10ms)

### **Alert Thresholds:**

**Critical Alerts:**
- CPU > 90% for 5 minutes
- Memory > 95%
- Disk space < 10%
- Error rate > 5%

**Warning Alerts:**
- CPU > 80% for 15 minutes
- Memory > 85%
- Response time > 1 second
- Error rate > 1%

---

## 🆘 Getting Help

### **Before Contacting Support:**

1. **Check this guide** first
2. **Review error messages** in browser console (F12)
3. **Gather information**:
   - Browser version and type
   - Operating system
   - Steps to reproduce
   - Screenshots of errors
   - Time of occurrence
   - User account affected

### **Contact Information:**

**Technical Support:**
- Email: support@vungu.gov.zw
- Phone: +263 123 456 789
- Hours: 8:00 AM - 5:00 PM weekdays

**Security Issues:**
- Email: security@vungu.gov.zw
- Phone: +263 987 654 321
- 24/7 availability

**System Administrator:**
- Email: admin@vungu.gov.zw
- Emergency: +263 555 123 456

### **Support Process:**

1. **Initial Response**: Within 2 hours during business hours
2. **Investigation**: Technical team reviews issue
3. **Resolution**: Fix implemented and tested
4. **Follow-up**: Verify solution works
5. **Documentation**: Issue added to knowledge base

---

## 📚 Additional Resources

### **Documentation:**
- [User Manual](PHASE2_USER_MANUAL.md) - Complete system guide
- [Admin Guide](PHASE2_ADMIN_GUIDE.md) - Administration manual
- [Quick Start Guide](PHASE2_QUICK_START_GUIDE.md) - 5-minute setup
- [API Documentation](docs/api/) - Developer reference

### **Training Materials:**
- [Video Tutorials](PHASE2_VIDEO_TUTORIALS.md) - Video training
- [Workshop Materials](docs/workshop/) - Hands-on exercises
- [Best Practices](docs/best-practices/) - Usage guidelines

### **Community:**
- [User Forum](https://community.vungu.gov.zw) - Peer support
- [Knowledge Base](https://kb.vungu.gov.zw) - Articles and FAQs
- [Blog](https://blog.vungu.gov.zw) - Tips and updates

---

*Last updated: January 21, 2026*  
*Version: 1.0*  
*For the latest version, visit the online knowledge base.*
