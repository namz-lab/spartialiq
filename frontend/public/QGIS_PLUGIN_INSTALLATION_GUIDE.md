# QGIS Plugin Installation Guide
## Vungu Spatial Integration Plugin

This guide provides step-by-step instructions for installing and configuring the Vungu Spatial Integration plugin for QGIS.

---

## 🎯 **OVERVIEW**

The **Vungu Spatial Integration Plugin** provides direct integration between QGIS and the Vungu Spatial Data Portal, enabling:

- **Real-time data synchronization** between QGIS layers and web portal
- **Automated style synchronization** with version control
- **Bidirectional data sync** (QGIS ↔ Portal)
- **Performance monitoring** and optimization
- **Security audit logging** for all operations

---

## 📋 **PREREQUISITES**

### **System Requirements:**
- **QGIS Version**: 3.10 or later
- **Python**: 3.6 or later (included with QGIS)
- **Operating System**: Windows 10/11, macOS 10.14+, Ubuntu 18.04+
- **Network**: Internet connection for portal access
- **Memory**: Minimum 4GB RAM (8GB recommended)

### **Software Dependencies:**
```bash
# Required Python packages (install via QGIS Python console)
pip install requests
pip install PyQt5
pip install chokidar  # For file watching (optional)
```

---

## 🚀 **INSTALLATION METHODS**

### **METHOD 1: AUTOMATIC INSTALLATION (RECOMMENDED)**

#### **Step 1: Download Plugin**
1. Download the plugin ZIP file from:
   - **GitHub**: `https://github.com/vungu/qgis-plugin/releases`
   - **Portal**: `https://vungu.gov.zw/downloads/qgis-plugin.zip`

#### **Step 2: Install via QGIS Plugin Manager**
1. **Open QGIS**
2. **Navigate**: `Plugins` → `Manage and Install Plugins...`
3. **Click**: `Install from ZIP` tab
4. **Select**: Downloaded `vungu-qgis-plugin.zip`
5. **Click**: `Install Plugin`
6. **Restart QGIS** when prompted

#### **Step 3: Verify Installation**
1. **Check**: `Plugins` → `Vungu Integration` should appear in menu
2. **Look for**: Vungu Integration dock widget on right side
3. **Test**: Plugin should load without errors

---

### **METHOD 2: MANUAL INSTALLATION**

#### **Step 1: Extract Plugin Files**
```bash
# Extract ZIP to QGIS plugins directory
# Windows: %APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\
# macOS: ~/Library/Application Support/QGIS/QGIS3/profiles/default/python/plugins/
# Linux: ~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/
```

#### **Step 2: Copy Plugin Files**
```bash
# Copy plugin directory to plugins folder
cp -r vungu-integration ~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/
```

#### **Step 3: Enable Plugin**
1. **Open QGIS**
2. **Navigate**: `Plugins` → `Manage and Install Plugins...`
3. **Search**: "Vungu Integration"
4. **Check**: Enable plugin checkbox
5. **Restart QGIS**

---

### **METHOD 3: DEVELOPER INSTALLATION**

#### **Step 1: Clone Repository**
```bash
git clone https://github.com/vungu/qgis-plugin.git
cd qgis-plugin
```

#### **Step 2: Create Symbolic Link**
```bash
# Create symbolic link in plugins directory
ln -s /path/to/qgis-plugin ~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/vungu-integration
```

#### **Step 3: Install Dependencies**
```bash
# Install in QGIS Python environment
python -m pip install -r requirements.txt
```

---

## ⚙️ **CONFIGURATION**

### **Step 1: Open Plugin Interface**
1. **Launch QGIS**
2. **Navigate**: `Plugins` → `Vungu Integration`
3. **Dock Widget**: Opens on right side of QGIS window

### **Step 2: Configure Connection**
1. **Click**: "Connection" tab
2. **Enter API URL**:
   ```
   Development: http://localhost:3001/api
   Production: https://api.vungu.gov.zw
   ```
3. **Enter API Token**:
   - Get token from portal admin interface
   - Navigate to `Profile` → `API Tokens`
   - Copy token to clipboard
4. **Click**: "Test Connection"
5. **Verify**: "✅ Connected" status appears
6. **Click**: "Save Settings"

### **Step 3: Configure Sync Settings**
1. **Click**: "Sync" tab
2. **Select Layer**: Choose layer to synchronize
3. **Enable Auto-sync**: Check for automatic synchronization
4. **Configure Options**:
   - **Bidirectional Sync**: Sync both ways
   - **Conflict Resolution**: Choose conflict handling
   - **Sync Interval**: Set automatic sync frequency

---

## 🔄 **SYNCHRONIZATION WORKFLOW**

### **Initial Setup**
1. **Create Layer** in QGIS with features
2. **Add Fields** with proper naming conventions
3. **Set CRS** to match portal (EPSG:4326 recommended)
4. **Save Project** before syncing

### **Sync to Portal**
1. **Select Layer** in dropdown
2. **Click**: "Sync Layer to Portal"
3. **Monitor**: Progress bar and log messages
4. **Verify**: Features appear in web portal

### **Sync from Portal**
1. **Select Layer** to receive data
2. **Click**: "Sync from Portal"
3. **Confirm**: Data overwrite warning
4. **Monitor**: Download progress
5. **Verify**: Features appear in QGIS

### **Full Bidirectional Sync**
1. **Click**: "Full Sync (Both Ways)"
2. **Monitor**: Two-way sync process
3. **Resolve**: Any conflicts that arise
4. **Verify**: Data consistency

---

## 🎨 **STYLE SYNCHRONIZATION**

### **Automatic Style Sync**
1. **Enable**: "Auto-sync Styles on Change"
2. **Modify**: Layer styles in QGIS
3. **Auto-upload**: Changes sync to portal automatically
4. **Version Control**: Each change creates new version

### **Manual Style Sync**
1. **Click**: "Upload Styles to Portal"
2. **Select**: Styles to upload
3. **Monitor**: Upload progress
4. **Verify**: Styles appear in portal

### **Download Styles**
1. **Click**: "Download Styles from Portal"
2. **Select**: Styles to download
3. **Apply**: Styles to matching layers
4. **Verify**: Visual consistency

---

## 📊 **PERFORMANCE MONITORING**

### **Real-time Metrics**
1. **Click**: "Monitor" tab
2. **View**: Live performance metrics
3. **Monitor**:
   - API response times
   - Sync status
   - Error counts
   - Layer statistics

### **Performance Optimization**
1. **Click**: "Refresh Metrics"
2. **Review**: Performance recommendations
3. **Implement**: Suggested optimizations
4. **Monitor**: Improvements over time

---

## 🔒 **SECURITY FEATURES**

### **Audit Logging**
- All sync operations are logged
- User actions tracked
- Security events monitored
- Audit trail maintained

### **Authentication**
- API token-based authentication
- Secure connection (HTTPS)
- Token expiration handling
- Permission validation

---

## 🛠️ **TROUBLESHOOTING**

### **Common Issues**

#### **❌ "Connection Failed"**
**Causes:**
- Incorrect API URL
- Invalid API token
- Network connectivity issues
- Portal server down

**Solutions:**
1. **Verify API URL**: Check spelling and protocol
2. **Test Token**: Generate new token from portal
3. **Check Network**: Ping portal server
4. **Verify Portal**: Check portal status page

#### **❌ "Sync Failed"**
**Causes:**
- Layer geometry issues
- Field name conflicts
- CRS mismatch
- Large dataset timeout

**Solutions:**
1. **Validate Geometry**: Check for invalid geometries
2. **Standardize Fields**: Use consistent field names
3. **Match CRS**: Ensure same coordinate system
4. **Reduce Size**: Sync in smaller batches

#### **❌ "Style Sync Failed"**
**Causes:**
- Invalid QML syntax
- Missing symbol references
- File permission issues
- Network timeout

**Solutions:**
1. **Validate QML**: Test in QGIS first
2. **Check Symbols**: Ensure all symbols exist
3. **Fix Permissions**: Check file access rights
4. **Retry**: Try sync again

#### **❌ "Plugin Not Loading"**
**Causes:**
- Installation incomplete
- Dependencies missing
- QGIS version incompatible
- Python path issues

**Solutions:**
1. **Reinstall**: Use automatic installation
2. **Install Dependencies**: Install required packages
3. **Check Version**: Ensure QGIS 3.10+
4. **Restart QGIS**: Fresh restart

### **Debug Mode**
Enable debug logging:
1. **Open QGIS Python Console**
2. **Run**: `import vungu_integration; vungu_integration.set_debug(True)`
3. **Monitor**: Console output for detailed logs

---

## 📚 **ADVANCED FEATURES**

### **Custom Sync Rules**
```python
# Example: Custom field mapping
field_mapping = {
    'id': 'feature_id',
    'name': 'display_name',
    'geometry': 'geom'
}
```

### **Batch Operations**
- Sync multiple layers simultaneously
- Bulk style updates
- Mass data imports/exports

### **Automation Scripts**
```python
# Example: Auto-sync script
import vungu_integration

# Initialize plugin
plugin = vungu_integration.VunguIntegration(iface)

# Auto-sync all layers
for layer in QgsProject.instance().mapLayers().values():
    if isinstance(layer, QgsVectorLayer):
        plugin.sync_layer_to_portal(layer)
```

---

## 🔄 **UPDATES AND MAINTENANCE**

### **Automatic Updates**
1. **Check**: `Plugins` → `Manage and Install Plugins`
2. **Look for**: Updates to Vungu Integration
3. **Click**: "Upgrade Plugin"
4. **Restart QGIS**

### **Manual Updates**
1. **Download**: Latest version from GitHub
2. **Uninstall**: Current plugin version
3. **Install**: New version using Method 1
4. **Configure**: Connection settings again

### **Maintenance Tasks**
- **Weekly**: Check for plugin updates
- **Monthly**: Review sync logs
- **Quarterly**: Clean up old versions
- **Annually**: Review and optimize sync rules

---

## 📞 **SUPPORT AND RESOURCES**

### **Getting Help**
- **Documentation**: `https://docs.vungu.gov.zw/qgis-plugin`
- **Issues**: `https://github.com/vungu/qgis-plugin/issues`
- **Community**: `https://community.vungu.gov.zw`
- **Email**: `support@vungu.gov.zw`

### **Training Resources**
- **Video Tutorials**: Available on portal
- **User Guide**: Complete documentation
- **Best Practices**: Optimization tips
- **API Reference**: Developer documentation

### **System Requirements**
- **Minimum**: QGIS 3.10, 4GB RAM
- **Recommended**: QGIS 3.28+, 8GB RAM, SSD
- **Enterprise**: QGIS LTR, 16GB RAM, dedicated server

---

## 🎉 **SUCCESS CRITERIA**

### **Installation Success:**
- ✅ Plugin appears in QGIS menu
- ✅ Dock widget loads without errors
- ✅ Connection test passes
- ✅ Sync operations complete successfully

### **Operational Success:**
- ✅ Data syncs bidirectionally
- ✅ Styles synchronize automatically
- ✅ Performance metrics display correctly
- ✅ Security audit logs capture events

---

*Last updated: January 21, 2026*  
*Version: 1.0.0*  
*For the latest version, visit the GitHub repository.*
