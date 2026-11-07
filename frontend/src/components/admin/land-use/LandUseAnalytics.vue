<template>
  <div class="land-use-analytics">
    <div class="coming-soon">
      <i class="icon-chart"></i>
      <h3>Land Use Analytics</h3>
      <p>Comprehensive analytics and reporting dashboard will be available here.</p>
      <div class="features-preview">
        <h4>Planned Features:</h4>
        <ul>
          <li>Land use distribution charts and graphs</li>
          <li>Development application trends</li>
          <li>Zone utilization analysis</li>
          <li>Compliance monitoring dashboards</li>
          <li>Exportable reports and insights</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  groups: any[]
  zones: any[]
}>()
</script>

<style scoped>
.land-use-analytics {
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  padding: 3rem 2rem;
}

.coming-soon {
  text-align: center;
  color: #6b7280;
}

.coming-soon i {
  font-size: 4rem;
  margin-bottom: 1rem;
  color: #d1d5db;
}

.coming-soon h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #374151;
}

.coming-soon p {
  margin: 0 0 2rem 0;
  font-size: 1rem;
}

.features-preview {
  max-width: 500px;
  margin: 0 auto;
  text-align: left;
}

.features-preview h4 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: #374151;
  text-align: center;
}

.features-preview ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.features-preview li {
  padding: 0.5rem 0;
  padding-left: 1.5rem;
  position: relative;
}

.features-preview li::before {
  content: '📊';
  position: absolute;
  left: 0;
}
</style>
