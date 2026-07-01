<template>
  <div class="trends-page">
    <div class="page-header">
      <div>
        <h1>🔥 Trend Engine</h1>
        <p class="subtitle">Top 10 platform trends with view count — updated every 2 hours</p>
      </div>
      <button class="btn-refresh" @click="handleRefresh" :disabled="store.isLoading">
        {{ store.isLoading ? 'Refreshing...' : '🔄 Refresh' }}
      </button>
    </div>

    <div v-if="store.error" class="error-banner">
      {{ store.error }}
    </div>

    <div class="filters-card">
      <div class="filter-group">
        <label for="platform-filter">Platform</label>
        <select id="platform-filter" :value="store.platformFilter" @change="handlePlatformFilter">
          <option value="tiktok">TikTok</option>
          <option value="facebook">Facebook</option>
          <option value="youtube">YouTube</option>
          <option value="instagram">Instagram</option>
          <option value="shopee">Shopee</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="region-filter">Region</label>
        <select id="region-filter" :value="store.regionFilter" @change="handleRegionFilter">
          <option value="vn">Vietnam</option>
          <option value="global">Global</option>
          <option value="us">United States</option>
          <option value="uk">United Kingdom</option>
        </select>
      </div>
    </div>

    <div v-if="store.isLoading && store.trends.length === 0" class="loading-state">
      <div class="spinner"></div>
      <p>Loading trends...</p>
    </div>

    <div v-if="store.trends.length > 0" class="trend-summary">
      <span class="platform-badge" :class="`platform-${store.platformFilter}`">
        {{ platformLabel(store.platformFilter) }}
      </span>
      <span>Top {{ store.trends.length }} · {{ regionLabel(store.regionFilter) }}</span>
    </div>

    <div v-if="store.trends.length > 0" class="trend-grid">
      <div
        v-for="(trend, index) in store.trends"
        :key="trend.id"
        class="trend-card"
        :class="{ 'trend-card--hot': trend.views >= 800000 }"
      >
        <div class="trend-rank" :class="getRankClass(index)">#{{ index + 1 }}</div>
        <div class="trend-info">
          <div class="trend-title">
            {{ trend.title }}
            <span v-if="trend.views >= 800000" class="hot-badge">HOT</span>
          </div>
          <div class="trend-meta">
            <span>{{ formatViews(trend.views) }} views</span>
            <span>·</span>
            <span>{{ regionLabel(trend.region) }}</span>
            <span>·</span>
            <span>{{ formatDate(trend.crawled_at) }}</span>
          </div>
        </div>
        <div class="trend-bar">
          <div
            class="trend-bar-fill"
            :class="`bar-${trend.platform}`"
            :style="{ width: barWidth(trend.views) + '%' }"
          ></div>
        </div>
      </div>
    </div>

    <div v-if="!store.isLoading && store.trends.length === 0 && !store.error" class="empty-state">
      <div class="empty-icon">📊</div>
      <p>No trend data yet</p>
      <p class="empty-hint">Try another platform/region or wait for next AI Worker crawl.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useTrendStore, type TrendPlatform, type TrendRegion } from '@/stores/trend.store';

const store = useTrendStore();

const maxViews = computed(() => Math.max(...store.trends.map((trend) => trend.views), 1));

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    tiktok: 'TikTok',
    facebook: 'Facebook',
    youtube: 'YouTube',
    instagram: 'Instagram',
    shopee: 'Shopee',
  };
  return labels[platform] || platform;
}

function regionLabel(region: string): string {
  const labels: Record<string, string> = {
    vn: 'Vietnam',
    global: 'Global',
    us: 'United States',
    uk: 'United Kingdom',
  };
  return labels[region] || region.toUpperCase();
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return (views / 1_000_000).toFixed(1) + 'M';
  if (views >= 1_000) return (views / 1_000).toFixed(1) + 'K';
  return views.toString();
}

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function getRankClass(index: number): string {
  if (index === 0) return 'rank-1';
  if (index === 1) return 'rank-2';
  if (index === 2) return 'rank-3';
  return '';
}

function barWidth(views: number): number {
  return Math.max(4, Math.round((views / maxViews.value) * 100));
}

async function handleRefresh() {
  await store.fetchLatestTrends();
}

function handlePlatformFilter(event: Event) {
  store.setPlatformFilter((event.target as HTMLSelectElement).value as TrendPlatform);
}

function handleRegionFilter(event: Event) {
  store.setRegionFilter((event.target as HTMLSelectElement).value as TrendRegion);
}

onMounted(() => {
  store.fetchLatestTrends({ limit: 10 });
});
</script>

<style scoped>
.trends-page {
  max-width: 1100px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.page-header h1 {
  color: #f1f5f9;
  font-size: 24px;
  margin: 0 0 4px 0;
}

.subtitle {
  color: #64748b;
  font-size: 14px;
  margin: 0;
}

.btn-refresh {
  padding: 10px 20px;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-refresh:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.2);
  transform: translateY(-1px);
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-banner {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}

.filters-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.08);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-group label {
  color: #cbd5e1;
  font-size: 13px;
}

.filter-group select {
  padding: 8px 12px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 8px;
  color: #f1f5f9;
}

.filter-group select option {
  background: #1e293b;
  color: #f1f5f9;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
  color: #94a3b8;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(148, 163, 184, 0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.trend-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #94a3b8;
  font-size: 13px;
  margin-bottom: 16px;
}

.platform-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.platform-tiktok { background: rgba(0, 0, 0, 0.4); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); }
.platform-facebook { background: rgba(24, 119, 242, 0.15); color: #1877F2; border: 1px solid rgba(24, 119, 242, 0.3); }
.platform-youtube { background: rgba(255, 0, 0, 0.1); color: #FF0000; border: 1px solid rgba(255, 0, 0, 0.25); }
.platform-instagram { background: rgba(225, 48, 108, 0.12); color: #E1306C; border: 1px solid rgba(225, 48, 108, 0.3); }
.platform-shopee { background: rgba(238, 77, 45, 0.12); color: #EE4D2D; border: 1px solid rgba(238, 77, 45, 0.3); }

.trend-grid {
  display: grid;
  gap: 12px;
}

.trend-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.06);
  border-radius: 10px;
  transition: all 0.15s;
}

.trend-card:hover {
  background: rgba(30, 41, 59, 0.7);
  border-color: rgba(148, 163, 184, 0.12);
}

.trend-card--hot {
  border-left: 3px solid #ef4444;
  background: rgba(30, 41, 59, 0.6);
}

.trend-rank {
  font-size: 14px;
  font-weight: 700;
  color: #64748b;
  min-width: 32px;
  text-align: center;
  flex-shrink: 0;
}

.rank-1 { color: #fbbf24; }
.rank-2 { color: #94a3b8; }
.rank-3 { color: #d97706; }

.trend-info {
  flex: 1;
  min-width: 0;
}

.trend-title {
  color: #e2e8f0;
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}

.hot-badge {
  padding: 2px 8px;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  font-size: 10px;
  font-weight: 700;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.trend-meta {
  color: #64748b;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
}

.trend-bar {
  width: 120px;
  height: 6px;
  background: rgba(148, 163, 184, 0.08);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}

.trend-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.bar-tiktok { background: linear-gradient(90deg, #fff, #94a3b8); }
.bar-facebook { background: linear-gradient(90deg, #1877F2, #60a5fa); }
.bar-youtube { background: linear-gradient(90deg, #FF0000, #f87171); }
.bar-instagram { background: linear-gradient(90deg, #E1306C, #f472b6); }
.bar-shopee { background: linear-gradient(90deg, #EE4D2D, #fb923c); }

.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.empty-state p {
  color: #94a3b8;
  font-size: 15px;
  margin: 4px 0;
}

.empty-hint {
  font-size: 13px !important;
  color: #64748b !important;
}

@media (max-width: 720px) {
  .page-header,
  .filters-card,
  .trend-card {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-group {
    align-items: stretch;
    flex-direction: column;
  }

  .trend-bar {
    width: 100%;
  }
}
</style>
