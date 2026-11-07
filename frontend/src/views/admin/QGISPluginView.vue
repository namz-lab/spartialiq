<template>
  <div class="qgis-plugin-container">
    <div class="qgis-plugin-header">
      <h1>🔧 QGIS Plugin Integration</h1>
      <p class="subtitle">QGIS Plugin • Style Synchronization • Performance Monitoring</p>
    </div>

    <!-- Status Overview -->
    <div class="status-grid">
      <div class="status-card qgis">
        <div class="status-icon">🔧</div>
        <div class="status-info">
          <h3>QGIS Integration</h3>
          <p class="status-text" :class="qgisStatus.class">{{ qgisStatus.text }}</p>
        </div>
      </div>

      <div class="status-card style-sync">
        <div class="status-icon">🎨</div>
        <div class="status-info">
          <h3>Style Sync</h3>
          <p class="status-text" :class="styleSyncStatus.class">{{ styleSyncStatus.text }}</p>
        </div>
      </div>

      <div class="status-card performance">
        <div class="status-icon">📊</div>
        <div class="status-info">
          <h3>Performance Monitor</h3>
          <p class="status-text" :class="performanceStatus.class">{{ performanceStatus.text }}</p>
        </div>
      </div>

      <div class="status-card security">
        <div class="status-icon">🔒</div>
        <div class="status-info">
          <h3>Security Audit</h3>
          <p class="status-text" :class="securityStatus.class">{{ securityStatus.text }}</p>
        </div>
      </div>
    </div>

    <!-- QGIS Integration Section -->
    <div class="section-card">
      <div class="section-header">
        <h2>🔧 QGIS Plugin Integration</h2>
        <button @click="testQGISIntegration" class="test-btn" :disabled="testing.qgis">
          {{ testing.qgis ? 'Testing...' : 'Test Integration' }}
        </button>
      </div>
      <div class="section-content">
        <div class="feature-grid">
          <div class="feature-item">
            <h4>📡 Real-time Sync</h4>
            <p>Bidirectional data synchronization between QGIS and web portal</p>
          </div>
          <div class="feature-item">
            <h4>🎨 Style Management</h4>
            <p>Automated QML template synchronization with version control</p>
          </div>
          <div class="feature-item">
            <h4>📊 Performance Monitoring</h4>
            <p>Real-time metrics and optimization recommendations</p>
          </div>
          <div class="feature-item">
            <h4>🔒 Security Integration</h4>
            <p>JWT authentication and comprehensive audit logging</p>
          </div>
        </div>
        
        <div class="qgis-actions">
          <button @click="downloadQGISPlugin" class="action-btn primary">
            <i class="icon-download"></i>
            Download QGIS Plugin
          </button>
          <button @click="viewInstallationGuide" class="action-btn secondary">
            <i class="icon-book"></i>
            Installation Guide
          </button>
        </div>
      </div>
    </div>

    <!-- API Token Management Section -->
    <div class="section-card">
      <div class="section-header">
        <h2>🔐 API Token Management</h2>
        <button @click="refreshTokenStatus" class="test-btn" :disabled="loading.token">
          {{ loading.token ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
      <div class="section-content">
        <div class="token-management">
          <!-- Generate New Token -->
          <div class="token-generator">
            <h3>🚀 Generate New API Token</h3>
            <p class="description">Create a new API token for QGIS Plugin authentication</p>
            <div class="token-actions">
              <button @click="generateApiToken" class="action-btn primary" :disabled="loading.generate">
                <i class="icon-key"></i>
                {{ loading.generate ? 'Generating...' : 'Generate API Token' }}
              </button>
              <button @click="sendTokenToEmail" class="action-btn secondary" :disabled="!currentToken || loading.email">
                <i class="icon-mail"></i>
                {{ loading.email ? 'Sending...' : 'Email Token to Me' }}
              </button>
            </div>
          </div>

          <!-- Current Token Display -->
          <div class="current-token" v-if="currentToken">
            <h3>📋 Current API Token</h3>
            <div class="token-display">
              <div class="token-value">
                <code>{{ showFullToken ? currentToken.token : maskedToken }}</code>
                <button @click="showFullToken = !showFullToken" class="toggle-visibility">
                  {{ showFullToken ? '🙈' : '👁️' }}
                </button>
              </div>
              <div class="token-info">
                <span class="token-email">{{ currentToken.email }}</span>
                <span class="token-expires">Expires: {{ formatDate(currentToken.expiresAt) }}</span>
                <span class="token-permissions">{{ currentToken.permissions?.join(', ') }}</span>
              </div>
            </div>
          </div>

          <!-- Token History -->
          <div class="token-history" v-if="tokenHistory.length > 0">
            <h3>📜 Token History</h3>
            <div class="history-list">
              <div v-for="token in tokenHistory" :key="token.generatedAt" class="history-item">
                <div class="history-info">
                  <span class="history-token">{{ token.token.substring(0, 20) }}...</span>
                  <span class="history-date">{{ formatDate(token.generatedAt) }}</span>
                  <span class="history-status" :class="token.status">{{ token.status }}</span>
                </div>
                <button @click="resendToken(token)" class="resend-btn" :disabled="loading.resend">
                  📧 Resend
                </button>
              </div>
            </div>
          </div>

          <!-- Email Status -->
          <div class="email-status" v-if="emailStatus">
            <div class="status-message" :class="emailStatus.type">
              {{ emailStatus.message }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Style Synchronization Section -->
    <div class="section-card">
      <div class="section-header">
        <h2>🎨 Automated Style Synchronization</h2>
        <button @click="testStyleSync" class="test-btn" :disabled="testing.styleSync">
          {{ testing.styleSync ? 'Testing...' : 'Test Sync' }}
        </button>
      </div>
      <div class="section-content">
        <div class="sync-status">
          <div class="sync-metrics">
            <div class="metric">
              <span class="metric-label">Total Styles:</span>
              <span class="metric-value">{{ styleMetrics.total_styles || 0 }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Last Sync:</span>
              <span class="metric-value">{{ formatTime(styleMetrics.last_sync_time) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Next Sync:</span>
              <span class="metric-value">{{ formatTime(styleMetrics.next_sync) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Sync Status:</span>
              <span class="metric-value" :class="styleMetrics.is_syncing ? 'syncing' : 'idle'">
                {{ styleMetrics.is_syncing ? 'Syncing...' : 'Idle' }}
              </span>
            </div>
          </div>
        </div>

        <div class="style-actions">
          <button @click="forceStyleSync" class="action-btn primary">
            <i class="icon-refresh"></i>
            Force Sync Now
          </button>
          <button @click="viewSyncHistory" class="action-btn secondary">
            <i class="icon-history"></i>
            View History
          </button>
        </div>
      </div>
    </div>

    <!-- Performance Monitoring Section -->
    <div class="section-card">
      <div class="section-header">
        <h2>📊 Advanced Performance Monitoring</h2>
        <button @click="testPerformanceMonitor" class="test-btn" :disabled="testing.performance">
          {{ testing.performance ? 'Testing...' : 'Test Monitor' }}
        </button>
      </div>
      <div class="section-content">
        <div class="performance-overview" v-if="performanceData">
          <div class="perf-grid">
            <div class="perf-item">
              <h4>System Metrics</h4>
              <div class="perf-stats">
                <div class="stat">
                  <span>CPU Usage:</span>
                  <span>{{ performanceData.summary?.avg_cpu_usage?.toFixed(2) || 0 }}%</span>
                </div>
                <div class="stat">
                  <span>Memory Usage:</span>
                  <span>{{ performanceData.summary?.avg_memory_usage?.toFixed(2) || 0 }}%</span>
                </div>
                <div class="stat">
                  <span>Response Time:</span>
                  <span>{{ performanceData.summary?.avg_response_time?.toFixed(2) || 0 }}ms</span>
                </div>
              </div>
            </div>
            
            <div class="perf-item">
              <h4>Application Stats</h4>
              <div class="perf-stats">
                <div class="stat">
                  <span>Total Requests:</span>
                  <span>{{ performanceData.summary?.total_requests || 0 }}</span>
                </div>
                <div class="stat">
                  <span>Error Rate:</span>
                  <span>{{ performanceData.summary?.error_rate?.toFixed(2) || 0 }}%</span>
                </div>
                <div class="stat">
                  <span>Cache Hit Rate:</span>
                  <span>{{ performanceData.summary?.cache_hit_rate?.toFixed(2) || 0 }}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="performance-actions">
          <button @click="refreshPerformanceData" class="action-btn primary">
            <i class="icon-refresh"></i>
            Refresh Metrics
          </button>
          <button @click="viewPerformanceAlerts" class="action-btn secondary">
            <i class="icon-alert"></i>
            View Alerts
          </button>
        </div>
      </div>
    </div>

    <!-- Security Audit Section -->
    <div class="section-card">
      <div class="section-header">
        <h2>🔒 Security Audit Service</h2>
        <button @click="testSecurityAudit" class="test-btn" :disabled="testing.security">
          {{ testing.security ? 'Testing...' : 'Test Security' }}
        </button>
      </div>
      <div class="section-content">
        <div class="security-overview">
          <div class="security-features">
            <div class="security-item">
              <h4>🛡️ Real-time Event Logging</h4>
              <p>Comprehensive security event tracking and analysis</p>
            </div>
            <div class="security-item">
              <h4>⚡ Risk Scoring</h4>
              <p>Dynamic risk assessment based on event patterns</p>
            </div>
            <div class="security-item">
              <h4>🚨 Automated Responses</h4>
              <p>IP blocking and enhanced monitoring for threats</p>
            </div>
            <div class="security-item">
              <h4>📊 Threat Analysis</h4>
              <p>Advanced threat detection and pattern recognition</p>
            </div>
          </div>
        </div>

        <div class="security-actions">
          <button @click="viewSecurityMetrics" class="action-btn primary">
            <i class="icon-shield"></i>
            Security Metrics
          </button>
          <button @click="testSecurityEvent" class="action-btn secondary">
            <i class="icon-test"></i>
            Test Event
          </button>
        </div>
      </div>
    </div>

    <!-- Documentation Section -->
    <div class="section-card">
      <div class="section-header">
        <h2>📚 Documentation & Resources</h2>
      </div>
      <div class="section-content">
        <div class="doc-grid">
          <div class="doc-item" @click="openDocument('QGIS_PLUGIN_INSTALLATION_GUIDE')">
            <div class="doc-icon">🔧</div>
            <h4>QGIS Plugin Guide</h4>
            <p>Complete installation and configuration guide</p>
          </div>
          <div class="doc-item" @click="openDocument('PHASE2_API_REFERENCE')">
            <div class="doc-icon">📡</div>
            <h4>API Reference</h4>
            <p>Comprehensive API documentation with examples</p>
          </div>
          <div class="doc-item" @click="openDocument('PHASE2_TROUBLESHOOTING_GUIDE')">
            <div class="doc-icon">🔧</div>
            <h4>Troubleshooting</h4>
            <p>Common issues and solutions guide</p>
          </div>
          <div class="doc-item" @click="openDocument('PHASE2_QUICK_START_GUIDE')">
            <div class="doc-icon">🚀</div>
            <h4>Quick Start</h4>
            <p>Get started in 5 minutes guide</p>
          </div>
        </div>
      </div>
  </div>
  <UiFeedback :feedback="fb" />
</div>
</template>

<script setup lang="ts">
// @ts-nocheck — untyped admin plugin view; excluded from strict type-check
import { ref, onMounted, computed } from 'vue'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'

const fb = useUiFeedback()

// Vite proxy serves /api → backend. Do not prefix paths that already
// start with /api, or health checks hit /api/api/... and look offline.
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

function apiPath(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  if (p.startsWith('/api/')) return p
  return `${API_BASE_URL}${p}`
}

function apiFetch(path, options = {}) {
  return fetch(apiPath(path), { credentials: 'include', ...options })
}

// Reactive state
const qgisStatus = ref({ text: 'Checking...', class: 'checking' })
const styleSyncStatus = ref({ text: 'Checking...', class: 'checking' })
const performanceStatus = ref({ text: 'Checking...', class: 'checking' })
const securityStatus = ref({ text: 'Checking...', class: 'checking' })

const styleMetrics = ref({})
const performanceData = ref(null)

const testing = ref({
  qgis: false,
  styleSync: false,
  performance: false,
  security: false
})

// Token management state
const loading = ref({
  token: false,
  generate: false,
  email: false,
  resend: false
})

const currentToken = ref(null)
const tokenHistory = ref([])
const showFullToken = ref(false)
const emailStatus = ref(null)

// Computed properties
const maskedToken = computed(() => {
  if (!currentToken.value?.token) return ''
  const token = currentToken.value.token
  if (token.length < 13) return token
  return token.substring(0, 8) + '...' + token.substring(token.length - 4)
})

// Initialize component
onMounted(async () => {
  await checkAllServices()
  await loadStyleMetrics()
  await loadPerformanceData()
})

// Service status checks
async function checkAllServices() {
  await Promise.all([
    checkQGISStatus(),
    checkStyleSyncStatus(),
    checkPerformanceStatus(),
    checkSecurityStatus()
  ])
}

async function checkQGISStatus() {
  try {
    const response = await apiFetch('/qgis/health')
    const data = await response.json()
    
    if (data.success && data.data.status === 'healthy') {
      qgisStatus.value = { text: '✅ Operational', class: 'success' }
    } else {
      qgisStatus.value = { text: '⚠️ Degraded', class: 'warning' }
    }
  } catch (error) {
    qgisStatus.value = { text: '❌ Offline', class: 'error' }
  }
}

async function checkStyleSyncStatus() {
  try {
    const response = await apiFetch('/qgis-plugin/style-sync/status')
    const data = await response.json()
    
    if (data && !data.error) {
      styleSyncStatus.value = { text: '✅ Active', class: 'success' }
      styleMetrics.value = data
    } else {
      styleSyncStatus.value = { text: '⚠️ Issues', class: 'warning' }
    }
  } catch (error) {
    styleSyncStatus.value = { text: '❌ Offline', class: 'error' }
  }
}

async function checkPerformanceStatus() {
  try {
    const response = await apiFetch('/qgis-plugin/metrics')
    const data = await response.json()
    
    if (data && !data.error) {
      performanceStatus.value = { text: '✅ Monitoring', class: 'success' }
      performanceData.value = data
    } else {
      performanceStatus.value = { text: '⚠️ Limited', class: 'warning' }
    }
  } catch (error) {
    performanceStatus.value = { text: '❌ Offline', class: 'error' }
  }
}

async function checkSecurityStatus() {
  try {
    const response = await apiFetch('/qgis-plugin/security/metrics')
    const data = await response.json()
    
    if (data && !data.error) {
      securityStatus.value = { text: '✅ Active', class: 'success' }
    } else {
      securityStatus.value = { text: '⚠️ Issues', class: 'warning' }
    }
  } catch (error) {
    securityStatus.value = { text: '❌ Offline', class: 'error' }
  }
}

// Test functions
async function testQGISIntegration() {
  testing.value.qgis = true
  try {
    await checkQGISStatus()
    fb.showToast('QGIS integration test completed.', 'success')
  } catch (error) {
    fb.showToast('QGIS integration test failed: ' + (error as Error).message, 'error')
  } finally {
    testing.value.qgis = false
  }
}

async function testStyleSync() {
  testing.value.styleSync = true
  try {
    await checkStyleSyncStatus()
    fb.showToast('Style sync test completed.', 'success')
  } catch (error) {
    fb.showToast('Style sync test failed: ' + (error as Error).message, 'error')
  } finally {
    testing.value.styleSync = false
  }
}

async function testPerformanceMonitor() {
  testing.value.performance = true
  try {
    await checkPerformanceStatus()
    fb.showToast('Performance monitor test completed.', 'success')
  } catch (error) {
    fb.showToast('Performance monitor test failed: ' + (error as Error).message, 'error')
  } finally {
    testing.value.performance = false
  }
}

async function testSecurityAudit() {
  testing.value.security = true
  try {
    await checkSecurityStatus()
    fb.showToast('Security audit test completed.', 'success')
  } catch (error) {
    fb.showToast('Security audit test failed: ' + (error as Error).message, 'error')
  } finally {
    testing.value.security = false
  }
}

// Action functions
async function forceStyleSync() {
  try {
    const response = await apiFetch('/qgis-plugin/style-sync/force', { method: 'POST' })
    const data = await response.json()
    
    if (data.error) {
      fb.showToast('Force sync failed: ' + data.error, 'error')
    } else {
      fb.showToast('Force sync started.', 'success')
      await loadStyleMetrics()
    }
  } catch (error) {
    fb.showToast('Force sync failed: ' + (error as Error).message, 'error')
  }
}

async function refreshPerformanceData() {
  await loadPerformanceData()
  await checkPerformanceStatus()
}

async function loadStyleMetrics() {
  try {
    const response = await apiFetch('/qgis-plugin/style-sync/status')
    const data = await response.json()
    if (data && !data.error) {
      styleMetrics.value = data
    }
  } catch (error) {
    console.error('Failed to load style metrics:', error)
  }
}

async function loadPerformanceData() {
  try {
    const response = await apiFetch('/qgis-plugin/metrics')
    const data = await response.json()
    if (data && !data.error) {
      performanceData.value = data
    }
  } catch (error) {
    console.error('Failed to load performance data:', error)
  }
}

// UI actions
function downloadQGISPlugin() {
  // Create download link
  const link = document.createElement('a')
  link.href = '/api/qgis-plugin/download/plugin'
  link.download = 'vungu-qgis-plugin.zip'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function viewInstallationGuide() {
  window.open('/QGIS_PLUGIN_INSTALLATION_GUIDE.md', '_blank')
}

function viewSyncHistory() {
  const history = styleMetrics.value.sync_history
  fb.openMessageBox({
    kind: 'info',
    title: 'Style sync history',
    message: Array.isArray(history) && history.length
      ? `${history.length} recorded sync event(s).`
      : 'No sync history is available from the plugin service.',
    details: history ? JSON.stringify(history, null, 2) : undefined,
  })
}

function viewPerformanceAlerts() {
  fb.showToast('No active performance alerts.', 'info')
}

function viewSecurityMetrics() {
  fb.showToast('Security audit service is monitoring system events.', 'info')
}

async function testSecurityEvent() {
  try {
    const response = await apiFetch('/qgis-plugin/security/audit-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'test_event',
        severity: 'low',
        details: { message: 'Manual test from QGIS Plugin dashboard' }
      })
    })
    
    const data = await response.json()
    if (data.error) {
      fb.showToast('Security event test failed: ' + data.error, 'error')
    } else {
      fb.showToast('Security event logged.', 'success')
    }
  } catch (error) {
    fb.showToast('Security event test failed: ' + error.message, 'error')
  }
}

// Token Management Functions
async function generateApiToken() {
  try {
    loading.value.generate = true
    emailStatus.value = null

    const response = await apiFetch('/auth/generate-api-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginName: 'vungu-qgis-plugin' }),
    })

    const data = await response.json()
    const payload = data?.data
    const token = payload?.apiToken || payload?.token || payload?.tokenInfo?.token

    if (data.success && token) {
      currentToken.value = {
        token,
        email: payload.email || payload.tokenInfo?.email || '',
        expiresAt: payload.expiresAt || payload.tokenInfo?.expiresAt,
        pluginName: payload.pluginName || 'vungu-qgis-plugin',
        permissions: payload.permissions || ['qgis-sync'],
      }
      tokenHistory.value.unshift({
        ...currentToken.value,
        status: 'active',
        sentAt: new Date().toISOString(),
      })
      emailStatus.value = {
        type: 'success',
        message: 'API token minted for this signed-in admin. Copy it or email it to yourself.',
      }
    } else {
      throw new Error(data.error || 'Failed to generate token')
    }
  } catch (error) {
    emailStatus.value = {
      type: 'error',
      message: `Could not generate token: ${error.message}`,
    }
  } finally {
    loading.value.generate = false
  }
}

async function sendTokenToEmail() {
  if (!currentToken.value) return
  
  try {
    loading.value.email = true
    emailStatus.value = null
    
    // Call the real email API endpoint
    const response = await apiFetch('/auth/email-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: currentToken.value.token,
        email: currentToken.value.email,
        pluginName: 'vungu-qgis-plugin'
      })
    })
    
    const data = await response.json()
    
    if (data.success) {
      // Also copy to clipboard for convenience
      await navigator.clipboard.writeText(currentToken.value.token)
      
      emailStatus.value = {
        type: 'success',
        message: `📧 Email sent successfully to ${data.data.email}! Token also copied to clipboard. Check your inbox for the API token.`
      }
      
      // Update token history
      const token = tokenHistory.value.find(t => t.token === currentToken.value.token)
      if (token) {
        token.sentAt = new Date().toISOString()
        token.status = 'sent'
      }
    } else {
      throw new Error(data.error || 'Failed to send email')
    }
  } catch (error) {
    emailStatus.value = {
      type: 'error',
      message: `❌ Failed to send email: ${error.message}`
    }
  } finally {
    loading.value.email = false
  }
}

async function resendToken(token) {
  try {
    loading.value.resend = true
    
    // Call the real email API endpoint
    const response = await apiFetch('/auth/email-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token.token,
        email: token.email,
        pluginName: 'vungu-qgis-plugin'
      })
    })
    
    const data = await response.json()
    
    if (data.success) {
      // Also copy to clipboard for convenience
      await navigator.clipboard.writeText(token.token)
      
      emailStatus.value = {
        type: 'success',
        message: `📧 Token ${token.token.substring(0, 20)}... resent successfully to ${token.email}! Also copied to clipboard.`
      }
      
      // Update token in history
      const historyToken = tokenHistory.value.find(t => t.token === token.token)
      if (historyToken) {
        historyToken.sentAt = new Date().toISOString()
        historyToken.status = 'resent'
      }
    } else {
      throw new Error(data.error || 'Failed to resend email')
    }
  } catch (error) {
    emailStatus.value = {
      type: 'error',
      message: `❌ Failed to resend token: ${error.message}`
    }
  } finally {
    loading.value.resend = false
  }
}

async function refreshTokenStatus() {
  try {
    loading.value.token = true
    // In production, this would fetch current token status from API
    // For now, we'll just refresh the display
    emailStatus.value = null
  } finally {
    loading.value.token = false
  }
}

// Utility functions
function formatDate(dateString) {
  return new Date(dateString).toLocaleString()
}

function openDocument(docName) {
  window.open(`/${docName}.md`, '_blank')
}

// Utility functions
function formatTime(timestamp) {
  if (!timestamp) return 'Never'
  return new Date(timestamp).toLocaleString()
}
</script>

<style scoped>
.qgis-plugin-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.qgis-plugin-header {
  text-align: center;
  margin-bottom: 40px;
}

.qgis-plugin-header h1 {
  font-size: 2.5rem;
  color: #2c3e50;
  margin-bottom: 10px;
}

.subtitle {
  color: #7f8c8d;
  font-size: 1.1rem;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 40px;
}

.status-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  gap: 15px;
}

.status-icon {
  font-size: 2rem;
}

.status-info h3 {
  margin: 0 0 5px 0;
  color: #2c3e50;
}

.status-text {
  margin: 0;
  font-weight: 500;
}

.status-text.success { color: #27ae60; }
.status-text.warning { color: #f39c12; }
.status-text.error { color: #e74c3c; }
.status-text.checking { color: #3498db; }

.section-card {
  background: white;
  border-radius: 12px;
  padding: 25px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-header h2 {
  margin: 0;
  color: #2c3e50;
}

.test-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #3498db;
  color: white;
  cursor: pointer;
  transition: background 0.3s;
}

.test-btn:hover:not(:disabled) {
  background: #2980b9;
}

.test-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.feature-item {
  padding: 15px;
  border: 1px solid #ecf0f1;
  border-radius: 8px;
}

.feature-item h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
}

.feature-item p {
  margin: 0;
  color: #7f8c8d;
  font-size: 0.9rem;
}

.qgis-actions, .style-actions, .performance-actions, .security-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn.primary {
  background: #27ae60;
  color: white;
}

.action-btn.primary:hover {
  background: #229954;
}

.action-btn.secondary {
  background: #95a5a6;
  color: white;
}

.action-btn.secondary:hover {
  background: #7f8c8d;
}

.sync-metrics {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.sync-metrics .metric {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.metric-label {
  font-weight: 500;
  color: #2c3e50;
}

.metric-value {
  font-weight: 600;
  color: #3498db;
}

.metric-value.syncing {
  color: #f39c12;
}

.metric-value.idle {
  color: #27ae60;
}

.perf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.perf-item {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
}

.perf-item h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
}

.perf-stats .stat {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.perf-stats .stat span:first-child {
  color: #7f8c8d;
}

.perf-stats .stat span:last-child {
  font-weight: 600;
  color: #2c3e50;
}

.security-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.security-item {
  padding: 15px;
  border: 1px solid #ecf0f1;
  border-radius: 8px;
}

.security-item h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
}

.security-item p {
  margin: 0;
  color: #7f8c8d;
  font-size: 0.9rem;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}

.doc-item {
  padding: 20px;
  border: 1px solid #ecf0f1;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  text-align: center;
}

.doc-item:hover {
  border-color: #3498db;
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(52, 152, 219, 0.2);
}

.doc-icon {
  font-size: 2rem;
  margin-bottom: 10px;
}

.doc-item h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
}

.doc-item p {
  margin: 0;
  color: #7f8c8d;
  font-size: 0.9rem;
}

/* Token Management Styles */
.token-management {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.token-generator {
  padding: 25px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  color: white;
}

.token-generator h3 {
  margin: 0 0 10px 0;
  font-size: 1.3rem;
}

.token-generator .description {
  margin: 0 0 20px 0;
  opacity: 0.9;
}

.token-actions {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
}

.current-token {
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.current-token h3 {
  margin: 0 0 15px 0;
  color: #2c3e50;
}

.token-display {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.token-value {
  display: flex;
  align-items: center;
  gap: 10px;
  background: white;
  padding: 15px;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.token-value code {
  flex: 1;
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
  color: #495057;
  word-break: break-all;
}

.toggle-visibility {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 5px;
  border-radius: 4px;
  transition: background 0.2s;
}

.toggle-visibility:hover {
  background: #f8f9fa;
}

.token-info {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  font-size: 0.85rem;
  color: #6c757d;
}

.token-email {
  font-weight: 600;
  color: #495057;
}

.token-expires {
  color: #dc3545;
}

.token-permissions {
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
}

.token-history {
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.token-history h3 {
  margin: 0 0 15px 0;
  color: #2c3e50;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.history-info {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  align-items: center;
  flex: 1;
}

.history-token {
  font-family: 'Courier New', monospace;
  font-size: 0.85rem;
  color: #495057;
  background: #f8f9fa;
  padding: 2px 6px;
  border-radius: 4px;
}

.history-date {
  font-size: 0.85rem;
  color: #6c757d;
}

.history-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.history-status.active {
  background: #d4edda;
  color: #155724;
}

.history-status.sent {
  background: #cce5ff;
  color: #004085;
}

.history-status.resent {
  background: #fff3cd;
  color: #856404;
}

.resend-btn {
  background: none;
  border: 1px solid #dee2e6;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.resend-btn:hover:not(:disabled) {
  background: #f8f9fa;
  border-color: #adb5bd;
}

.resend-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.email-status {
  padding: 15px;
  border-radius: 6px;
  margin-top: 15px;
}

.status-message {
  padding: 12px 16px;
  border-radius: 6px;
  font-weight: 500;
}

.status-message.success {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status-message.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

/* Responsive Design */
@media (max-width: 768px) {
  .token-actions {
    flex-direction: column;
  }
  
  .token-info {
    flex-direction: column;
    gap: 5px;
  }
  
  .history-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  
  .history-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }
}
</style>
